import * as vscode from 'vscode';
import { AntigravitySDK } from 'antigravity-sdk';
import { execSync } from 'node:child_process';
import { HttpServer } from './server/http-server';
import { PortFile } from './port-file';
import { autoApply } from './auto-run';
import {
  createWorkspaceId_func,
  findMatchingLanguageServerLine_func,
} from './ls-process-match';

let server: HttpServer | undefined;
let sdk: AntigravitySDK | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * 현재 워크스페이스에 해당하는 LS 프로세스를 찾아서
 * sdk.ls.setConnection()으로 올바른 CSRF 토큰을 설정한다.
 *
 * SDK 자동 탐색은 여러 Antigravity 인스턴스 중 첫 번째를 선택하는 버그가 있어서,
 * 다른 워크스페이스의 토큰을 가져올 수 있다 (→ 403 Invalid CSRF token).
 */
function fixLsConnection(sdkInstance: AntigravitySDK, workspacePath: string, output: vscode.OutputChannel): void {
  try {
    // --- Phase 1: ps 로 PID, csrf_token, extension_server_port 획득 ---
    const workspaceId = createWorkspaceId_func(workspacePath);

    const raw = execSync(
      'ps -eo pid,args 2>/dev/null | grep language_server | grep csrf_token | grep -v grep',
      { encoding: 'utf-8', timeout: 5000 },
    );

    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    const matched = findMatchingLanguageServerLine_func(lines, workspaceId);

    if (!matched) {
      output.appendLine(`[Bridge] LS fix: no process matched workspace_id "${workspaceId}"`);
      return;
    }

    const csrfMatch = matched.match(/--csrf_token\s+([^\s"]+)/);
    const pidMatch = matched.trim().match(/^(\d+)/);
    const extPortMatch = matched.match(/--extension_server_port\s+(\d+)/);
    const lspPortMatch = matched.match(/--lsp_port\s+(\d+)/);

    if (!csrfMatch || !pidMatch) {
      output.appendLine('[Bridge] LS fix: could not parse PID or csrf_token');
      return;
    }

    const csrfToken = csrfMatch[1];
    const pid = pidMatch[1];
    const extPort = extPortMatch ? parseInt(extPortMatch[1], 10) : 0;
    const lspPort = lspPortMatch ? parseInt(lspPortMatch[1], 10) : 0;

    // server_port가 명시적으로 있으면 바로 사용 (랜덤이 아닌 경우)
    const serverPortMatch = matched.match(/--server_port\s+(\d+)/);
    if (serverPortMatch) {
      const serverPort = parseInt(serverPortMatch[1], 10);
      sdkInstance.ls.setConnection(serverPort, csrfToken, true);
      output.appendLine(`[Bridge] LS fix: reconnected via server_port (port=${serverPort}, tls=true, csrf=ok)`);
      return;
    }

    // --- Phase 2: lsof 로 ConnectRPC 포트 탐색 (--random_port 사용 시) ---
    const lsofRaw = execSync(
      `lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | grep ${pid}`,
      { encoding: 'utf-8', timeout: 5000 },
    );

    const portSet = new Set<number>();
    for (const m of lsofRaw.matchAll(/127\.0\.0\.1:(\d+)/g)) {
      const p = parseInt(m[1], 10);
      // extension_server_port 와 lsp_port 제외
      if (p !== extPort && p !== lspPort) {
        portSet.add(p);
      }
    }

    const candidates = [...portSet];
    if (candidates.length === 0) {
      output.appendLine('[Bridge] LS fix: no ConnectRPC port candidates found');
      return;
    }

    // HTTPS(TLS) 포트 우선 시도 — SDK와 동일한 방식
    // 여러 후보 중 첫 번째를 사용 (보통 httpsPort가 먼저 바인딩됨)
    const connectPort = candidates[0];
    sdkInstance.ls.setConnection(connectPort, csrfToken, true);
    output.appendLine(`[Bridge] LS fix: reconnected via lsof (port=${connectPort}, tls=true, csrf=ok, candidates=[${candidates.join(',')}])`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    output.appendLine(`[Bridge] LS fix skipped: ${msg}`);
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel('Antigravity Bridge');
  outputChannel.appendLine('[Bridge] Activating...');

  try {
    // 0. Auto-Run Fix — "Always Proceed" 정책이 실제로 동작하도록 workbench JS 패치
    autoApply().then(results => {
      for (const r of results) {
        const detail_parts: string[] = [];
        if (r.bytesAdded) detail_parts.push(`+${r.bytesAdded}b`);
        if (r.error) detail_parts.push(`error: ${r.error}`);
        const detail_str = detail_parts.length > 0 ? ` (${detail_parts.join(', ')})` : '';
        outputChannel.appendLine(
          `[Bridge] [auto-run] ${r.label}: ${r.success ? '✓' : '✗'} ${r.status}${detail_str}`,
        );
      }
    });

    // 1. SDK 초기화
    sdk = new AntigravitySDK(context);
    await sdk.initialize();
    outputChannel.appendLine('[Bridge] SDK initialized');

    // 1.5. LS 연결 수정 (멀티 인스턴스 환경에서 CSRF 토큰 불일치 방지)
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    fixLsConnection(sdk, workspacePath, outputChannel);

    // 2. HTTP 서버 시작 (127.0.0.1, 랜덤 포트)
    server = new HttpServer(sdk, outputChannel);
    const port = await server.start();
    outputChannel.appendLine(`[Bridge] Server listening on 127.0.0.1:${port}`);

    // 3. 포트 파일에 등록 (CLI가 발견하도록)
    await PortFile.register(port, workspacePath);
    outputChannel.appendLine(`[Bridge] Registered in instances.json (workspace: ${workspacePath})`);

    // 4. StatusBar에 포트 표시
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = `$(radio-tower) Bridge :${port}`;
    statusBarItem.tooltip = `Antigravity Bridge running on 127.0.0.1:${port}`;
    statusBarItem.show();

    // dispose 등록
    context.subscriptions.push(
      { dispose: () => server?.stop() },
      { dispose: () => PortFile.unregister(port) },
      statusBarItem,
      outputChannel,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[Bridge] Activation failed: ${message}`);
    vscode.window.showErrorMessage(`Antigravity Bridge: ${message}`);
  }
}

export function deactivate(): void {
  server?.stop();
  sdk?.dispose();
}
