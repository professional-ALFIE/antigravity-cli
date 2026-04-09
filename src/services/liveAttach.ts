/**
 * Live LS Discovery — 실행 중인 IDE의 Language Server에 직접 연결
 *
 * 설계 근거: integration-plan-opus.md §3
 *
 * 전체 흐름:
 *  1. `ps` → workspace_id가 일치하는 LS 프로세스 찾기
 *  2. 해당 프로세스에서 PID, CSRF token, extension_server_port 추출
 *  3. `lsof` → 해당 PID의 LISTEN 포트 중 ConnectRPC 포트 후보 필터링
 *  4. 각 후보 포트에 GetUserStatus probe → 작동하는 포트 확인
 *  5. DiscoveryInfo 호환 객체 반환
 *
 * 비파괴 원칙: GetUserStatus probe만 사용하며, 실패 시 null 반환 (fallback 가능)
 */

import { execSync } from 'node:child_process';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import type { DiscoveryInfo } from './connectRpc.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface LiveLsConnection {
  pid: number;
  port: number;
  csrfToken: string;
  workspaceId: string;
  /** DiscoveryInfo-compatible object usable by callConnectRpc */
  discovery: DiscoveryInfo;
}

export interface LiveLsProcessInfo {
  pid: number;
  csrfToken: string;
  extensionServerPort: number;
  lspPort: number;
  workspaceId: string;
}

// ─────────────────────────────────────────────────────────────
// workspace_id 생성: v0.1.x ls-process-match.ts 이관
//
// IDE는 sanitizeFileName(workspaceFolder.uri.toString())으로 만든다.
// 예: file:///Users/xxx/project → 'file____Users_xxx_project'
// v0.1.x에서는 'file' + path.replace(/[^a-zA-Z0-9]/g, '_')로 근사했다.
// 이 CLI에서는 config.ts의 sanitizeFileName_func와 동일한
// pathToFileURL(path).href를 full regex로 치환하는 방식을 쓴다.
// 하지만 ps에서 매칭하려면 v0.1.x 방식도 지원해야 한다.
// ─────────────────────────────────────────────────────────────

/** v0.1.x 호환 workspace_id (ps 매칭용) */
export function createWorkspaceIdForPsMatch_func(workspace_path_var: string): string {
  return 'file' + workspace_path_var.replace(/[^a-zA-Z0-9]/g, '_');
}

// ─────────────────────────────────────────────────────────────
// ps 파싱
// ─────────────────────────────────────────────────────────────

function extractArgValue_func(line_var: string, arg_name_var: string): string | null {
  // --arg_name=value 형식
  const equals_pattern_var = new RegExp(`--${arg_name_var}=([^\\s"]+)`);
  const equals_match_var = line_var.match(equals_pattern_var);
  if (equals_match_var) {
    return equals_match_var[1];
  }

  // --arg_name value 형식
  const spaced_pattern_var = new RegExp(`--${arg_name_var}\\s+([^\\s"]+)`);
  const spaced_match_var = line_var.match(spaced_pattern_var);
  if (spaced_match_var) {
    return spaced_match_var[1];
  }

  return null;
}

export function extractLiveDiscoveryInfo_func(process_line_var: string): LiveLsProcessInfo | null {
  // PID 추출 (ps 출력의 첫 숫자)
  const pid_match_var = process_line_var.trim().match(/^(\d+)/);
  if (!pid_match_var) {
    return null;
  }

  const csrf_token_var = extractArgValue_func(process_line_var, 'csrf_token');
  if (!csrf_token_var) {
    return null;
  }

  const workspace_id_var = extractArgValue_func(process_line_var, 'workspace_id');
  if (!workspace_id_var) {
    return null;
  }

  const ext_port_str_var = extractArgValue_func(process_line_var, 'extension_server_port');
  const lsp_port_str_var = extractArgValue_func(process_line_var, 'lsp_port');

  return {
    pid: parseInt(pid_match_var[1], 10),
    csrfToken: csrf_token_var,
    extensionServerPort: ext_port_str_var ? parseInt(ext_port_str_var, 10) : 0,
    lspPort: lsp_port_str_var ? parseInt(lsp_port_str_var, 10) : 0,
    workspaceId: workspace_id_var,
  };
}

/**
 * ps → workspace_id가 일치하는 LS 프로세스 찾기
 *
 * v0.1.x extension.ts:fixLsConnection Phase 1과 동일한 로직.
 */
export function findLiveLanguageServerProcess_func(
  workspace_id_var: string,
): LiveLsProcessInfo | null {
  try {
    const ps_output_var = execSync(
      'ps -eo pid,args 2>/dev/null | grep language_server | grep csrf_token | grep -v grep',
      { encoding: 'utf-8', timeout: 5000 },
    );

    const lines_var = ps_output_var.split('\n').filter((line_var) => line_var.trim().length > 0);

    for (const line_var of lines_var) {
      const info_var = extractLiveDiscoveryInfo_func(line_var);
      if (!info_var) {
        continue;
      }

      if (info_var.workspaceId === workspace_id_var) {
        return info_var;
      }
    }

    return null;
  } catch {
    // ps 실행 실패 또는 매칭 없음 → null (fallback safe)
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// lsof 기반 포트 탐색
// ─────────────────────────────────────────────────────────────

/**
 * lsof → PID의 LISTEN 포트 중 extension_server_port/lsp_port를 제외한 후보 반환
 *
 * v0.1.x extension.ts:fixLsConnection Phase 2와 동일한 로직.
 */
export function findConnectRpcPortCandidates_func(
  pid_var: number,
  exclude_ports_var: number[],
): number[] {
  try {
    const lsof_output_var = execSync(
      `lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | grep ${pid_var}`,
      { encoding: 'utf-8', timeout: 5000 },
    );

    const port_set_var = new Set<number>();
    for (const match_var of lsof_output_var.matchAll(/127\.0\.0\.1:(\d+)/g)) {
      const port_var = parseInt(match_var[1], 10);
      if (!exclude_ports_var.includes(port_var)) {
        port_set_var.add(port_var);
      }
    }

    return [...port_set_var];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// GetUserStatus probe
// ─────────────────────────────────────────────────────────────

/**
 * HTTPS GetUserStatus probe → 포트가 ConnectRPC를 서빙하는지 확인
 *
 * v0.1.x ls-bridge.ts:_probePort와 동일한 판정:
 * - 200: 인증 성공
 * - 401: CSRF는 미달이지만 올바른 엔드포인트
 * - ECONNREFUSED/timeout: 이 포트가 아님
 */
async function probeConnectRpcPort_func(
  port_var: number,
  csrf_token_var: string,
  cert_path_var: string,
  timeout_ms_var: number = 3000,
): Promise<boolean> {
  return new Promise<boolean>((resolve_var) => {
    const url_var = `https://127.0.0.1:${port_var}/exa.language_server_pb.LanguageServerService/GetUserStatus`;

    const request_var = https.request(
      url_var,
      {
        method: 'POST',
        headers: {
          'Connect-Protocol-Version': '1',
          'Content-Type': 'application/json',
          'x-codeium-csrf-token': csrf_token_var,
        },
        rejectUnauthorized: false,
        ca: cert_path_var ? (() => { try { return readFileSync(cert_path_var); } catch { return undefined; } })() : undefined,
        timeout: timeout_ms_var,
      },
      (response_var) => {
        // 200 또는 401은 올바른 ConnectRPC 엔드포인트
        const status_var = response_var.statusCode ?? 0;
        response_var.resume(); // body 소비
        resolve_var(status_var >= 200 && status_var < 500);
      },
    );

    request_var.on('error', () => resolve_var(false));
    request_var.on('timeout', () => {
      request_var.destroy();
      resolve_var(false);
    });

    request_var.write('{}');
    request_var.end();
  });
}

/**
 * 후보 포트 중 첫 번째로 probe 성공한 포트 반환
 */
export async function findWorkingConnectRpcPort_func(
  candidates_var: number[],
  csrf_token_var: string,
  cert_path_var: string,
): Promise<number | null> {
  for (const port_var of candidates_var) {
    const works_var = await probeConnectRpcPort_func(port_var, csrf_token_var, cert_path_var);
    if (works_var) {
      return port_var;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// 오케스트레이터: discoverLiveLanguageServer_func
// ─────────────────────────────────────────────────────────────

/**
 * Live LS 탐색 오케스트레이터.
 *
 * plan §3.2의 판정 기준을 모두 통과해야 LiveLsConnection을 반환:
 * 1. workspace_id 정확 매칭
 * 2. CSRF token 추출 성공
 * 3. ConnectRPC port 확인
 * 4. 비파괴 probe (GetUserStatus) 성공
 *
 * 하나라도 실패 → null (offline fallback safe)
 */
export async function discoverLiveLanguageServer_func(
  workspace_path_var: string,
  config_var: {
    certPath: string;
    workspaceId: string;
  },
): Promise<LiveLsConnection | null> {
  // Step 1: ps → workspace_id 매칭
  // config.ts의 workspaceId와 v0.1.x 호환 ID 둘 다 시도
  const workspace_ids_to_try_var = [
    config_var.workspaceId,
    createWorkspaceIdForPsMatch_func(workspace_path_var),
  ];

  let process_info_var: LiveLsProcessInfo | null = null;
  for (const ws_id_var of workspace_ids_to_try_var) {
    process_info_var = findLiveLanguageServerProcess_func(ws_id_var);
    if (process_info_var) {
      break;
    }
  }

  if (!process_info_var) {
    return null;
  }

  // Step 2: lsof → ConnectRPC 포트 후보
  const exclude_ports_var = [
    process_info_var.extensionServerPort,
    process_info_var.lspPort,
  ].filter((p) => p > 0);

  const candidates_var = findConnectRpcPortCandidates_func(
    process_info_var.pid,
    exclude_ports_var,
  );

  if (candidates_var.length === 0) {
    return null;
  }

  // Step 3: probe → 작동하는 포트
  const working_port_var = await findWorkingConnectRpcPort_func(
    candidates_var,
    process_info_var.csrfToken,
    config_var.certPath,
  );

  if (working_port_var == null) {
    return null;
  }

  // Step 4: LiveLsConnection 구성
  const discovery_var: DiscoveryInfo = {
    pid: process_info_var.pid,
    httpsPort: working_port_var,
    csrfToken: process_info_var.csrfToken,
  };

  return {
    pid: process_info_var.pid,
    port: working_port_var,
    csrfToken: process_info_var.csrfToken,
    workspaceId: process_info_var.workspaceId,
    discovery: discovery_var,
  };
}
