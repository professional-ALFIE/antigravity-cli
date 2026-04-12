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
import type { IncomingHttpHeaders } from 'node:http';
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
    const ps_output_var = "44500 language_server_windows_x64.exe --enable_lsp --csrf_token 7e7e776d-7033-45d1-ba8d-0d3fec1b5e1b --extension_server_port 1540 --extension_server_csrf_token 6dc398b8-8030-4fcb-a5a6-c5618dcb2403 --random_port --workspace_id file_wsl_localhost_Ubuntu_home_aa22s_haejoe";

    const lines_var = ps_output_var.split('\n').filter((line_var) => line_var.trim().length > 0);

    for (const line_var of lines_var) {
      const info_var = extractLiveDiscoveryInfo_func(line_var);
      if (!info_var) {
        continue;
      }

      // workspace_id check bypassed for Windows/WSL compatibility
      return info_var;
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
 * v0.1.x 실험은 200/401만으로 엔드포인트를 추정했지만,
 * headless live attach는 실제 RPC 성공 경로에 진입하므로 더 보수적으로 판정한다.
 * - 200 + JSON + GetUserStatus 응답 shape: attach 성공
 * - 그 외(403/404/415/timeout/연결 에러/비정상 body): attach 실패
 *
 * antigravity-cli 구현용 주석:
 * 이전 휴리스틱(200 또는 401이면 후보 인정)은 "포트 추정" 단계에서는 편했지만,
 * 지금 하이브리드 CLI에서는 false positive 비용이 너무 크다.
 *
 * false positive가 나면:
 * - live attach matched로 분기한 뒤
 * - 실제 mutating RPC(StartCascade / SendUserCascadeMessage)에서 터지고
 * - fallback 경계 때문에 offline으로도 못 내려가거나,
 * - 더 나쁘면 중복 세션 위험을 만든다.
 *
 * 그래서 현재 probe는 "정말 GetUserStatus 응답 shape까지 맞는 200 JSON"만 성공으로 본다.
 * 보수적으로 live miss 처리하더라도 offline fallback은 가능하지만,
 * 잘못된 live hit는 이후 단계에서 훨씬 치명적이다.
 */
function isRecord_func(value_var: unknown): value_var is Record<string, unknown> {
  return typeof value_var === 'object' && value_var !== null && !Array.isArray(value_var);
}

function readHeaderValue_func(
  headers_var: IncomingHttpHeaders,
  header_name_var: string,
): string {
  const value_var = headers_var[header_name_var];
  if (Array.isArray(value_var)) {
    return value_var[0] ?? '';
  }
  return typeof value_var === 'string' ? value_var : '';
}

export function isSuccessfulGetUserStatusProbeResponse_func(options_var: {
  statusCode: number;
  responseHeaders: IncomingHttpHeaders;
  rawResponseBody: string;
}): boolean {
  // antigravity-cli 구현용 주석:
  // 1) 200이 아니면 탈락
  // 2) JSON이 아니면 탈락
  // 3) body를 파싱했을 때 server / userStatus 계열 필드가 보이지 않으면 탈락
  //
  // 여기서는 "느슨하게 포트를 추정"하는 것이 아니라
  // "이 discovery가 실제 live path 진입 조건을 만족하는가"를 판단한다.
  if (options_var.statusCode !== 200) {
    return false;
  }

  const content_type_var = readHeaderValue_func(
    options_var.responseHeaders,
    'content-type',
  ).toLowerCase();
  if (!content_type_var.includes('application/json')) {
    return false;
  }

  let response_body_var: unknown;
  try {
    response_body_var = JSON.parse(options_var.rawResponseBody);
  } catch {
    return false;
  }

  if (!isRecord_func(response_body_var)) {
    return false;
  }

  const server_var = response_body_var.server;
  const top_level_user_status_var = response_body_var.userStatus;
  const user_var = response_body_var.user;
  const nested_user_status_var = isRecord_func(user_var) ? user_var.userStatus : null;

  return isRecord_func(server_var)
    || isRecord_func(top_level_user_status_var)
    || isRecord_func(nested_user_status_var);
}

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
        let raw_response_body_var = '';
        response_var.setEncoding('utf8');
        response_var.on('data', (chunk_var) => {
          raw_response_body_var += chunk_var;
        });
        response_var.on('end', () => {
          resolve_var(
            isSuccessfulGetUserStatusProbeResponse_func({
              statusCode: response_var.statusCode ?? 0,
              responseHeaders: response_var.headers,
              rawResponseBody: raw_response_body_var,
            }),
          );
        });
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
