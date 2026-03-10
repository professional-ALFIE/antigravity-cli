import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { documented_models_var } from '../src/model-resolver.js';

interface StubRequest {
  method_var: string;
  url_var: string;
  body_var: unknown;
}

interface StubServer {
  port_var: number;
  server_var: http.Server;
  requests_var: StubRequest[];
}

const test_file_var = fileURLToPath(import.meta.url);
const test_dir_var = path.dirname(test_file_var);
const cli_path_var = path.resolve(test_dir_var, '../bin/antigravity-cli.ts');
const require_var = createRequire(import.meta.url);
const tsx_loader_path_var = require_var.resolve('tsx');

function createTempRoot_func(): string {
  return mkdtempSync(path.join(tmpdir(), 'ag-cli-help-'));
}

function createWorkspace_func(root_dir_var: string, name_var: string): string {
  const workspace_dir_var = path.join(root_dir_var, name_var);
  mkdirSync(workspace_dir_var, { recursive: true });
  return workspace_dir_var;
}

function writeInstances_func(
  home_dir_var: string,
  entries_var: Array<{ port: number; workspace: string; pid: number }>,
): void {
  const config_dir_var = path.join(home_dir_var, '.antigravity-cli');
  mkdirSync(config_dir_var, { recursive: true });
  writeFileSync(
    path.join(config_dir_var, 'instances.json'),
    JSON.stringify(entries_var, null, 2),
    'utf-8',
  );
}

async function startStubServer_func(
  handler_var: (request_var: StubRequest, response_var: http.ServerResponse) => void | Promise<void>,
): Promise<StubServer> {
  const requests_var: StubRequest[] = [];
  const server_var = http.createServer(async (req_var, res_var) => {
    const chunks_var: Buffer[] = [];
    for await (const chunk_var of req_var) {
      chunks_var.push(Buffer.isBuffer(chunk_var) ? chunk_var : Buffer.from(chunk_var));
    }

    const raw_body_var = Buffer.concat(chunks_var).toString('utf-8');
    let body_var: unknown = undefined;
    if (raw_body_var) {
      body_var = JSON.parse(raw_body_var);
    }

    const request_var: StubRequest = {
      method_var: req_var.method ?? 'GET',
      url_var: req_var.url ?? '/',
      body_var,
    };
    requests_var.push(request_var);
    await handler_var(request_var, res_var);
  });

  server_var.listen(0, '127.0.0.1');
  await once(server_var, 'listening');
  const address_var = server_var.address();
  if (!address_var || typeof address_var === 'string') {
    throw new Error('stub server listen failed');
  }

  return {
    port_var: address_var.port,
    server_var,
    requests_var,
  };
}

async function runCli_func(args_var: string[], cwd_dir_var?: string, home_dir_var?: string): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  const child_var = spawn(
    process.execPath,
    ['--import', tsx_loader_path_var, cli_path_var, ...args_var],
    {
      cwd: cwd_dir_var ?? test_dir_var,
      env: {
        ...process.env,
        HOME: home_dir_var ?? process.env.HOME,
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let stdout_var = '';
  let stderr_var = '';

  child_var.stdout.on('data', (chunk_var: Buffer | string) => {
    stdout_var += chunk_var.toString();
  });

  child_var.stderr.on('data', (chunk_var: Buffer | string) => {
    stderr_var += chunk_var.toString();
  });

  const [exit_code_var] = await once(child_var, 'close') as [number | null];
  return {
    status: exit_code_var,
    stdout: stdout_var,
    stderr: stderr_var,
  };
}

function closeServer_func(server_var: http.Server): Promise<void> {
  return new Promise((resolve_var, reject_var) => {
    server_var.close((error_var) => {
      if (error_var) {
        reject_var(error_var);
        return;
      }
      resolve_var();
    });
  });
}

function sendJson_func(response_var: http.ServerResponse, payload_var: unknown): void {
  response_var.writeHead(200, { 'Content-Type': 'application/json' });
  response_var.end(JSON.stringify(payload_var));
}

function buildRootHelpExpected_func(): string {
  const model_lines_var = documented_models_var
    .map((model_var, index_var) => (
      `                        ${model_var.cliName}${index_var === 0 ? ' (default)' : ''}`
    ))
    .join('\n');

  return [
    'Usage: antigravity-cli [options] [message]',
    '',
    '현재 작업영역 Bridge를 외부에서 제어하는 헤드리스 CLI',
    '',
    'Options:',
    '  -m, --model <model>   대화 모델 설정',
    model_lines_var,
    '  -r, --resume          세션 조회',
    '      --resume [uuid]   해당 세션에 이어쓰기',
    '  -a, --async           응답 대기 없이 지시 후 즉시 종료',
    '  -j, --json            JSON 형식으로 출력',
    '  -p, --port <port>     Bridge 서버 포트 수동 지정',
    '  -v, --version         output the version number',
    '  -h, --help            display help for command',
    '',
    'Commands:',
    '  server                IDE 서버 관리 (status/prefs/diag/monitor/state/reload/restart/auto-run)',
    '  agent                 워크플로우/규칙 관리',
    '  commands              Antigravity 내부 명령어 조회/직접 실행',
    '',
    'Examples:',
    '  $ antigravity-cli "코드 리뷰해줘"                       새 대화 생성',
    '  $ antigravity-cli -r                                   현재 작업영역 대화 목록',
    '  $ antigravity-cli -r SESSION_UUID "이어서 진행해"       기존 대화에 메시지 전송',
    '  $ antigravity-cli -a "빠르게 답해"                      응답 대기 없이 즉시 종료',
    '  $ antigravity-cli server status                        서버 + 유저 상태',
    '  $ antigravity-cli server auto-run status               auto-run 패치 상태 확인',
    '',
    'Root Mode:',
    '  - 새 대화 / 이어쓰기 모두 백그라운드 UI 반영을 명시 실행합니다',
    '  - 현재 보고 있는 메인 대화 화면은 절대 바꾸지 않습니다',
    '  - 현재 작업영역 Bridge가 없고 Antigravity가 이미 실행 중이면, 새 작업영역 창만 생성 직후 최소화한 뒤 연결합니다',
    '  - --resume 목록도 현재 작업영역 대화만, 전체 UUID로 출력합니다',
    '  - 메시지는 하나의 positional 인자로만 받습니다. 공백이 있으면 반드시 따옴표로 감싸세요',
    '  - exec, resume, --no-wait 는 제거되었습니다',
  ].join('\n');
}

const expected_server_help_var = [
  'Usage: antigravity-cli server [options] [command]',
  '',
  'IDE 서버 관리 (status/prefs/diag/monitor/state/reload/restart/auto-run)',
  '',
  'Options:',
  '  -h, --help           display help for command',
  '',
  'Commands:',
  '  status               서버 연결 + 유저 상태',
  '  prefs                에이전트 설정 조회',
  '  diag                 시스템 진단 정보',
  '  monitor              실시간 이벤트 스트림 (Ctrl+C로 종료)',
  '  state [key]          내부 저장소 조회',
  '  reload               IDE 창 리로드',
  '  restart              언어 서버 재시작',
  '  auto-run             Always Proceed auto-run 패치 관리',
  '  help [command]       display help for command',
].join('\n');

const expected_auto_run_help_var = [
  'Usage: antigravity-cli server auto-run [options] [command]',
  '',
  'Always Proceed auto-run 패치 관리',
  '',
  'Options:',
  '  -h, --help           display help for command',
  '',
  'Commands:',
  '  status               패치 적용 상태 확인',
  '  apply                수동으로 패치 적용',
  '  revert               패치 원본 복원 (.ba-backup에서)',
  '  help [command]       display help for command',
].join('\n');

test('루트 help 출력이 공개 명세와 정확히 일치한다', async () => {
  const result_var = await runCli_func(['--help']);

  assert.equal(result_var.status, 0);
  assert.equal(result_var.stdout, buildRootHelpExpected_func());
  assert.equal(result_var.stderr, '');
});

test('server help 출력이 공개 명세와 정확히 일치한다', async () => {
  const result_var = await runCli_func(['server', '--help']);

  assert.equal(result_var.status, 0);
  assert.equal(result_var.stdout, expected_server_help_var);
  assert.equal(result_var.stderr, '');
});

test('server auto-run help 출력이 공개 명세와 정확히 일치한다', async () => {
  const result_var = await runCli_func(['server', 'auto-run', '--help']);

  assert.equal(result_var.status, 0);
  assert.equal(result_var.stdout, expected_auto_run_help_var);
  assert.equal(result_var.stderr, '');
});

test('루트 help에는 숨김 명령과 숨김 옵션이 노출되지 않는다', async () => {
  const result_var = await runCli_func(['--help']);

  assert.equal(result_var.status, 0);
  assert.doesNotMatch(result_var.stdout, /^  accept\s/m);
  assert.doesNotMatch(result_var.stdout, /^  reject\s/m);
  assert.doesNotMatch(result_var.stdout, /^  run\s/m);
  assert.doesNotMatch(result_var.stdout, /^  ui\s/m);
  assert.doesNotMatch(result_var.stdout, /^  auto-run\s/m);
  assert.doesNotMatch(result_var.stdout, /--idle-timeout/);
});

test('루트 help 모델 목록 순서는 documented_models_var 순서를 따른다', async () => {
  const result_var = await runCli_func(['--help']);

  assert.equal(result_var.status, 0);
  const model_lines_var = result_var.stdout
    .split('\n')
    .filter((line_var) => line_var.startsWith('                        '));

  assert.deepEqual(
    model_lines_var,
    documented_models_var.map((model_var, index_var) => (
      `                        ${model_var.cliName}${index_var === 0 ? ' (default)' : ''}`
    )),
  );
});

test('짧은 옵션 -a 는 --async 와 같은 create -> track 흐름을 탄다', async () => {
  const root_dir_var = createTempRoot_func();
  const home_dir_var = path.join(root_dir_var, 'home');
  const workspace_dir_var = createWorkspace_func(root_dir_var, 'workspace');

  const stub_var = await startStubServer_func((request_var, response_var) => {
    if (request_var.method_var === 'POST' && request_var.url_var === '/api/ls/create') {
      sendJson_func(response_var, { success: true, data: '12345678-aaaa-bbbb-cccc-1234567890ab' });
      return;
    }
    if (request_var.method_var === 'POST' && request_var.url_var === '/api/ls/track/12345678-aaaa-bbbb-cccc-1234567890ab') {
      sendJson_func(response_var, { success: true });
      return;
    }

    response_var.writeHead(404);
    response_var.end();
  });

  try {
    mkdirSync(home_dir_var, { recursive: true });
    writeInstances_func(home_dir_var, [
      { port: stub_var.port_var, workspace: workspace_dir_var, pid: 1 },
    ]);

    const result_var = await runCli_func(
      ['--json', '-a', '--model', 'flash', 'short async message'],
      workspace_dir_var,
      home_dir_var,
    );

    assert.equal(result_var.status, 0, result_var.stderr);
    assert.deepEqual(JSON.parse(result_var.stdout), {
      cascadeId: '12345678-aaaa-bbbb-cccc-1234567890ab',
    });
    assert.equal(stub_var.requests_var.length, 2);
    assert.equal(stub_var.requests_var[0].url_var, '/api/ls/create');
    assert.deepEqual(stub_var.requests_var[0].body_var, {
      text: 'short async message',
      model: 'MODEL_PLACEHOLDER_M18',
    });
    assert.equal(stub_var.requests_var[1].url_var, '/api/ls/track/12345678-aaaa-bbbb-cccc-1234567890ab');
  } finally {
    await closeServer_func(stub_var.server_var);
    rmSync(root_dir_var, { recursive: true, force: true });
  }
});

test('짧은 옵션 -j --resume 은 JSON 목록 구조를 출력한다', async () => {
  const root_dir_var = createTempRoot_func();
  const home_dir_var = path.join(root_dir_var, 'home');
  const workspace_dir_var = createWorkspace_func(root_dir_var, 'workspace');
  const other_workspace_var = createWorkspace_func(root_dir_var, 'other-workspace');
  const workspace_uri_var = pathToFileURL(workspace_dir_var).href;
  const other_workspace_uri_var = pathToFileURL(other_workspace_var).href;

  const list_payload_var = {
    'aaaa1111-aaaa-bbbb-cccc-1234567890ab': {
      summary: 'Keep me',
      lastModifiedTime: '2026-03-10T02:00:00.000Z',
      createdTime: '2026-03-10T01:00:00.000Z',
      workspaces: [{ workspaceFolderAbsoluteUri: workspace_uri_var }],
    },
    'bbbb2222-aaaa-bbbb-cccc-1234567890ab': {
      summary: 'Drop me',
      lastModifiedTime: '2026-03-10T03:00:00.000Z',
      createdTime: '2026-03-10T02:00:00.000Z',
      workspaces: [{ workspaceFolderAbsoluteUri: other_workspace_uri_var }],
    },
  };

  const stub_var = await startStubServer_func((request_var, response_var) => {
    if (request_var.method_var === 'GET' && request_var.url_var === '/api/ls/list') {
      sendJson_func(response_var, { success: true, data: list_payload_var });
      return;
    }

    response_var.writeHead(404);
    response_var.end();
  });

  try {
    mkdirSync(home_dir_var, { recursive: true });
    writeInstances_func(home_dir_var, [
      { port: stub_var.port_var, workspace: workspace_dir_var, pid: 1 },
    ]);

    const result_var = await runCli_func(['-j', '--resume'], workspace_dir_var, home_dir_var);

    assert.equal(result_var.status, 0, result_var.stderr);
    assert.deepEqual(JSON.parse(result_var.stdout), {
      'aaaa1111-aaaa-bbbb-cccc-1234567890ab': list_payload_var['aaaa1111-aaaa-bbbb-cccc-1234567890ab'],
    });
  } finally {
    await closeServer_func(stub_var.server_var);
    rmSync(root_dir_var, { recursive: true, force: true });
  }
});

test('짧은 버전 옵션 -v 는 버전만 출력하고 종료한다', async () => {
  const result_var = await runCli_func(['-v']);

  assert.equal(result_var.status, 0);
  assert.equal(result_var.stdout, '0.1.0\n');
  assert.equal(result_var.stderr, '');
});

test('top-level auto-run 호출은 server auto-run 경로를 안내하는 오류를 낸다', async () => {
  const root_dir_var = createTempRoot_func();
  const home_dir_var = path.join(root_dir_var, 'home');
  const workspace_dir_var = createWorkspace_func(root_dir_var, 'workspace');

  try {
    mkdirSync(home_dir_var, { recursive: true });
    writeInstances_func(home_dir_var, []);

    const result_var = await runCli_func(['auto-run', 'status'], workspace_dir_var, home_dir_var);

    assert.equal(result_var.status, 1);
    assert.equal(result_var.stdout, '');
    assert.match(result_var.stderr, /`auto-run`은 `server auto-run`으로 이동했습니다/u);
  } finally {
    rmSync(root_dir_var, { recursive: true, force: true });
  }
});

test('server auto-run status 는 기존 auto-run/status API 경로를 그대로 호출한다', async () => {
  const root_dir_var = createTempRoot_func();
  const home_dir_var = path.join(root_dir_var, 'home');
  const workspace_dir_var = createWorkspace_func(root_dir_var, 'workspace');

  const stub_var = await startStubServer_func((request_var, response_var) => {
    if (request_var.method_var === 'GET' && request_var.url_var === '/api/auto-run/status') {
      sendJson_func(response_var, {
        success: true,
        data: {
          dir: '/tmp/workbench',
          files: [],
        },
      });
      return;
    }

    response_var.writeHead(404);
    response_var.end();
  });

  try {
    mkdirSync(home_dir_var, { recursive: true });
    writeInstances_func(home_dir_var, [
      { port: stub_var.port_var, workspace: workspace_dir_var, pid: 1 },
    ]);

    const result_var = await runCli_func(
      ['--json', 'server', 'auto-run', 'status'],
      workspace_dir_var,
      home_dir_var,
    );

    assert.equal(result_var.status, 0, result_var.stderr);
    assert.equal(stub_var.requests_var.length, 1);
    assert.equal(stub_var.requests_var[0].method_var, 'GET');
    assert.equal(stub_var.requests_var[0].url_var, '/api/auto-run/status');
    assert.deepEqual(JSON.parse(result_var.stdout), {
      dir: '/tmp/workbench',
      files: [],
    });
  } finally {
    await closeServer_func(stub_var.server_var);
    rmSync(root_dir_var, { recursive: true, force: true });
  }
});
