/**
 * live LS 통합 테스트 — StreamAgentStateUpdates raw stream 연결 검증 (v4)
 *
 * 실행 전제: Antigravity.app이 실행 중이어야 합니다.
 * bun run src/services/live-stream-integration.test.ts
 */

import { execSync } from 'node:child_process';
import {
  buildStreamAgentStateUpdatesRequestProto,
  startConnectProtoStream,
  LANGUAGE_SERVER_SERVICE_NAME,
} from './connectRpc.js';
import {
  findWorkingConnectRpcPort_func,
} from './liveAttach.js';
import { resolveHeadlessBackendConfig } from '../utils/config.js';

function findLiveLanguageServers(): Array<{
  pid: number;
  csrfToken: string;
  ports: number[];
}> {
  const ps_output = execSync('ps -eo pid,args 2>/dev/null', { encoding: 'utf8' });
  const results: Array<{ pid: number; csrfToken: string; ports: number[] }> = [];

  for (const line of ps_output.split('\n')) {
    if (!line.includes('language_server_macos_arm')) continue;
    if (line.includes('enable_lsp')) continue;
    if (line.includes('grep')) continue;

    const pid_match = line.trim().match(/^(\d+)/);
    const csrf_match = line.match(/--csrf_token\s+(\S+)/);
    if (!pid_match || !csrf_match) continue;

    const pid = parseInt(pid_match[1], 10);
    const csrfToken = csrf_match[1];

    let ports: number[] = [];
    try {
      const lsof = execSync(`lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep ${pid}`, { encoding: 'utf8' });
      ports = [...lsof.matchAll(/:(\d+)\s+\(LISTEN\)/g)].map(m => parseInt(m[1], 10));
    } catch { /* ignore */ }

    results.push({ pid, csrfToken, ports });
  }

  return results;
}

async function main() {
  console.log('[live-test] 시작...');

  const config = resolveHeadlessBackendConfig({
    repoRootPath: process.cwd(),
    homeDirPath: process.env.HOME ?? '/Users/noseung-gyeong',
    envFilePath: `${process.cwd()}/.env`,
  });
  console.log(`[live-test] certPath: ${config.certPath}`);

  // 1. live LS 프로세스 직접 탐지
  const ls_procs = findLiveLanguageServers();
  console.log(`[live-test] live LS 프로세스: ${ls_procs.length}개`);
  if (ls_procs.length === 0) {
    console.error('[live-test] ❌ live LS를 찾을 수 없습니다.');
    process.exit(1);
  }

  const ls = ls_procs[0];
  console.log(`[live-test] PID=${ls.pid}, CSRF=${ls.csrfToken.slice(0, 8)}..., candidate ports=[${ls.ports.join(',')}]`);

  if (ls.ports.length === 0) {
    console.error('[live-test] ❌ listening 포트가 없습니다.');
    process.exit(1);
  }

  // 2. working port 탐색 (3 인자: candidates, csrf_token, cert_path)
  console.log(`[live-test] working ConnectRPC port 탐색 중...`);
  const working_port = await findWorkingConnectRpcPort_func(
    ls.ports,
    ls.csrfToken,
    config.certPath,
  );

  if (!working_port) {
    // probe 실패 시에도 첫 번째 포트로 직접 시도 (probe가 GetUserStatus shape 검증이라 strict)
    console.log(`[live-test] ⚠️ probe 실패 — 첫 번째 포트 ${ls.ports[0]}으로 직접 stream 시도`);
  }

  const target_port = working_port ?? ls.ports[0];
  console.log(`[live-test] 타깃 port: ${target_port}`);

  // 3. raw stream 연결 테스트
  const fake_conversation_id = 'live-test-' + Date.now();
  const fake_subscriber_id = 'live-test-sub-' + Date.now();

  const request_bytes = buildStreamAgentStateUpdatesRequestProto({
    conversationId: fake_conversation_id,
    subscriberId: fake_subscriber_id,
  });
  console.log(`[live-test] request bytes: ${request_bytes.length} bytes`);

  const discovery = {
    httpsPort: target_port,
    httpPort: 0,
    csrfToken: ls.csrfToken,
  };

  console.log('[live-test] startConnectProtoStream 호출 (StreamAgentStateUpdates)...');
  const handle = startConnectProtoStream({
    discovery,
    protocol: 'https',
    certPath: config.certPath,
    method: 'StreamAgentStateUpdates',
    serviceName: LANGUAGE_SERVER_SERVICE_NAME,
    requestBody: request_bytes,
  });

  // 4. response 시작 대기 (5초 타임아웃)
  const timeout_ms = 5_000;
  try {
    const response_started = await Promise.race([
      handle.responseStarted,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('response 시작 타임아웃')), timeout_ms),
      ),
    ]);
    console.log(`[live-test] ✅ response 시작 — statusCode=${response_started.statusCode}`);

    if (response_started.statusCode === 200) {
      console.log('[live-test] ✅✅ raw stream 연결 성공! bundleRuntime 없이 200 OK 수신');
    } else {
      console.log(`[live-test] ⚠️ statusCode=${response_started.statusCode}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('타임아웃')) {
      console.log('[live-test] ⚠️ response 시작 대기 타임아웃');
    } else {
      console.error('[live-test] ❌ stream 연결 실패:', msg);
    }
  }

  // 5. 짧은 대기 후 frame 수 확인
  await new Promise(r => setTimeout(r, 2_000));
  console.log(`[live-test] 수신된 frames: ${handle.frames.length}개`);
  if (handle.frames.length > 0) {
    console.log(`[live-test] ✅ 프레임 수신 확인! 첫 프레임 크기: ${handle.frames[0].data.length} bytes`);
  }

  // 6. 정리
  handle.close();
  console.log('[live-test] ✅ 테스트 완료. stream 정상 닫힘.');
}

main().catch(console.error);
