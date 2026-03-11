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
  return mkdtempSync(path.join(tmpdir(), 'ag-cli-phase10-'));
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

async function runCli_func(args_var: string[], cwd_dir_var: string, home_dir_var: string): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}>;
async function runCli_func(
  args_var: string[],
  cwd_dir_var: string,
  home_dir_var: string,
  extra_env_var?: Record<string, string>,
): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  const child_var = spawn(
    process.execPath,
    ['--import', tsx_loader_path_var, cli_path_var, ...args_var],
    {
      cwd: cwd_dir_var,
      env: {
        ...process.env,
        HOME: home_dir_var,
        NO_COLOR: '1',
        ...extra_env_var,
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

function createLaunchScript_func(root_dir_var: string): string {
  const script_path_var = path.join(root_dir_var, 'launch-stub.mjs');
  writeFileSync(
    script_path_var,
    `import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const workspace_var = process.argv[2];
const home_var = process.env.HOME;
const mode_var = process.env.ANTIGRAVITY_CLI_TEST_LAUNCH_MODE ?? 'root';
const delay_ms_var = Number.parseInt(process.env.ANTIGRAVITY_CLI_TEST_LAUNCH_DELAY_MS ?? '0', 10) || 0;
const ttl_ms_var = Number.parseInt(process.env.ANTIGRAVITY_CLI_TEST_LAUNCH_TTL_MS ?? '5000', 10) || 5000;

function writeInstance_func(port_var) {
  const config_dir_var = path.join(home_var, '.antigravity-cli');
  mkdirSync(config_dir_var, { recursive: true });
  writeFileSync(
    path.join(config_dir_var, 'instances.json'),
    JSON.stringify([{ port: port_var, workspace: workspace_var, pid: process.pid }], null, 2),
    'utf-8',
  );
}

function sendJson_func(response_var, payload_var) {
  response_var.writeHead(200, { 'Content-Type': 'application/json' });
  response_var.end(JSON.stringify(payload_var));
}

function startServer_func() {
  const server_var = http.createServer((req_var, res_var) => {
    if (req_var.url === '/api/health') {
      sendJson_func(res_var, { success: true, uptime: 1 });
      return;
    }

    if (mode_var === 'root') {
      if (req_var.url === '/api/ls/create' && req_var.method === 'POST') {
        sendJson_func(res_var, { success: true, data: 'auto-launch-root-aaaa-bbbb-cccc-1234567890ab' });
        return;
      }
      if (req_var.url === '/api/ls/track/auto-launch-root-aaaa-bbbb-cccc-1234567890ab' && req_var.method === 'POST') {
        sendJson_func(res_var, { success: true });
        return;
      }
    }

    if (mode_var === 'commands') {
      if (req_var.url === '/api/commands/list' && req_var.method === 'GET') {
        sendJson_func(res_var, { success: true, data: ['antigravity.reloadWindow'] });
        return;
      }
    }

    res_var.writeHead(404);
    res_var.end();
  });

  server_var.listen(0, '127.0.0.1', () => {
    const address_var = server_var.address();
    if (!address_var || typeof address_var === 'string') {
      process.exit(1);
      return;
    }
    writeInstance_func(address_var.port);
    setTimeout(() => {
      server_var.close(() => process.exit(0));
    }, ttl_ms_var);
  });
}

if (mode_var === 'noop') {
  setTimeout(() => process.exit(0), delay_ms_var);
} else {
  setTimeout(startServer_func, delay_ms_var);
}
`,
    'utf-8',
  );
  return script_path_var;
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

test('현재 작업영역과 일치하는 인스턴스가 없으면 macOS background launch 경로로 복구한다', async () => {
  const root_dir_var = createTempRoot_func();
  try {
    const home_dir_var = path.join(root_dir_var, 'home');
    mkdirSync(home_dir_var, { recursive: true });

    const current_workspace_var = createWorkspace_func(root_dir_var, 'current-workspace');
    const other_workspace_var = createWorkspace_func(root_dir_var, 'other-workspace');
    const launch_script_var = createLaunchScript_func(root_dir_var);
    writeInstances_func(home_dir_var, [
      { port: 65535, workspace: other_workspace_var, pid: 1 },
    ]);

    const result_var = await runCli_func(
      ['--json', '--async', 'auto launch root'],
      current_workspace_var,
      home_dir_var,
      {
        ANTIGRAVITY_CLI_TEST_LAUNCH_SCRIPT: launch_script_var,
      },
    );

    assert.equal(result_var.status, 0, result_var.stderr);
    assert.deepEqual(JSON.parse(result_var.stdout), {
      cascadeId: 'auto-launch-root-aaaa-bbbb-cccc-1234567890ab',
    });
    assert.match(result_var.stderr, /Creating new workspace window \(minimized\)/u);
  } finally {
    rmSync(root_dir_var, { recursive: true, force: true });
  }
});

test('루트 기본 모드에서 --async 는 새 대화 생성 + track 호출로 연결된다', async () => {
  const root_dir_var = createTempRoot_func();
  const home_dir_var = path.join(root_dir_var, 'home');
  const workspace_dir_var = createWorkspace_func(root_dir_var, 'workspace');

  const stub_var = await startStubServer_func((request_var, response_var) => {
    if (request_var.method_var === 'POST' && request_var.url_var === '/api/ls/create') {
      sendJson_func(response_var, { success: true, data: '12345678-aaaa-bbbb-cccc-1234567890ab' });
      return;
    }
    if (request_var.method_var === 'POST' && request_var.url_var?.startsWith('/api/ls/track/')) {
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
      ['--json', '--async', '--model', 'flash', 'phase 10 create'],
      workspace_dir_var,
      home_dir_var,
    );

    assert.equal(result_var.status, 0, result_var.stderr);
    assert.deepEqual(JSON.parse(result_var.stdout), {
      cascadeId: '12345678-aaaa-bbbb-cccc-1234567890ab',
    });
    // create → track 순서 검증
    assert.equal(stub_var.requests_var.length, 2);
    assert.equal(stub_var.requests_var[0].url_var, '/api/ls/create');
    assert.deepEqual(stub_var.requests_var[0].body_var, {
      text: 'phase 10 create',
      model: 'MODEL_PLACEHOLDER_M18',
    });
    assert.equal(stub_var.requests_var[1].url_var, '/api/ls/track/12345678-aaaa-bbbb-cccc-1234567890ab');
  } finally {
    await closeServer_func(stub_var.server_var);
    rmSync(root_dir_var, { recursive: true, force: true });
  }
});

test('루트 기본 모드에서 --resume <id> 는 기존 대화 이어쓰기 + track 호출로 연결된다', async () => {
  const root_dir_var = createTempRoot_func();
  const home_dir_var = path.join(root_dir_var, 'home');
  const workspace_dir_var = createWorkspace_func(root_dir_var, 'workspace');

  const stub_var = await startStubServer_func((request_var, response_var) => {
    if (
      request_var.method_var === 'POST' &&
      request_var.url_var === '/api/ls/send/87654321-aaaa-bbbb-cccc-1234567890ab'
    ) {
      sendJson_func(response_var, { success: true, data: { ok: true } });
      return;
    }
    if (request_var.method_var === 'POST' && request_var.url_var?.startsWith('/api/ls/track/')) {
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
      ['--json', '--resume', '87654321-aaaa-bbbb-cccc-1234567890ab', '--async', 'phase 10 resume'],
      workspace_dir_var,
      home_dir_var,
    );

    assert.equal(result_var.status, 0, result_var.stderr);
    assert.deepEqual(JSON.parse(result_var.stdout), {
      cascadeId: '87654321-aaaa-bbbb-cccc-1234567890ab',
    });
    // send → track 순서 검증
    assert.equal(stub_var.requests_var.length, 2);
    assert.equal(stub_var.requests_var[0].url_var, '/api/ls/send/87654321-aaaa-bbbb-cccc-1234567890ab');
    assert.deepEqual(stub_var.requests_var[0].body_var, {
      text: 'phase 10 resume',
      model: 'MODEL_PLACEHOLDER_M26',
    });
    assert.equal(stub_var.requests_var[1].url_var, '/api/ls/track/87654321-aaaa-bbbb-cccc-1234567890ab');
  } finally {
    await closeServer_func(stub_var.server_var);
    rmSync(root_dir_var, { recursive: true, force: true });
  }
});

test('`--resume` 목록은 현재 작업영역 대화만 간단 포맷으로 출력한다', async () => {
  const root_dir_var = createTempRoot_func();
  const home_dir_var = path.join(root_dir_var, 'home');
  const workspace_dir_var = createWorkspace_func(root_dir_var, 'workspace');
  const other_workspace_var = createWorkspace_func(root_dir_var, 'other-workspace');
  const workspace_uri_var = pathToFileURL(workspace_dir_var).href;
  const other_workspace_uri_var = pathToFileURL(other_workspace_var).href;

  const list_payload_var = {
    '11111111-aaaa-bbbb-cccc-1234567890ab': {
      summary: 'Newest session',
      lastModifiedTime: '2026-03-10T02:00:00.000Z',
      createdTime: '2026-03-10T01:00:00.000Z',
      workspaces: [{ workspaceFolderAbsoluteUri: workspace_uri_var }],
    },
    '22222222-aaaa-bbbb-cccc-1234567890ab': {
      lastModifiedTime: '2026-03-10T01:00:00.000Z',
      createdTime: '2026-03-10T00:30:00.000Z',
      workspaces: [{ gitRootAbsoluteUri: workspace_uri_var }],
    },
    '33333333-aaaa-bbbb-cccc-1234567890ab': {
      summary: 'Other workspace',
      lastModifiedTime: '2026-03-10T03:00:00.000Z',
      createdTime: '2026-03-10T02:00:00.000Z',
      workspaces: [{ workspaceFolderAbsoluteUri: other_workspace_uri_var }],
    },
    '44444444-aaaa-bbbb-cccc-1234567890ab': {
      summary: 'Missing workspace metadata',
      lastModifiedTime: '2026-03-10T04:00:00.000Z',
      createdTime: '2026-03-10T02:00:00.000Z',
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

    const result_var = await runCli_func(['--resume'], workspace_dir_var, home_dir_var);

    assert.equal(result_var.status, 0, result_var.stderr);
    assert.deepEqual(
      result_var.stdout.trim().split('\n'),
      [
        '11111111-aaaa-bbbb-cccc-1234567890ab  Newest session',
        '22222222-aaaa-bbbb-cccc-1234567890ab  (session)',
      ],
    );
  } finally {
    await closeServer_func(stub_var.server_var);
    rmSync(root_dir_var, { recursive: true, force: true });
  }
});

test('`--json --resume` 은 현재 작업영역으로 필터된 raw 구조만 남긴다', async () => {
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

    const result_var = await runCli_func(['--json', '--resume'], workspace_dir_var, home_dir_var);

    assert.equal(result_var.status, 0, result_var.stderr);
    assert.deepEqual(JSON.parse(result_var.stdout), {
      'aaaa1111-aaaa-bbbb-cccc-1234567890ab': list_payload_var['aaaa1111-aaaa-bbbb-cccc-1234567890ab'],
    });
  } finally {
    await closeServer_func(stub_var.server_var);
    rmSync(root_dir_var, { recursive: true, force: true });
  }
});

test('레거시 exec/resume 문법과 메시지 없는 --resume <id> 는 명시적으로 막는다', async () => {
  const root_dir_var = createTempRoot_func();
  try {
    const home_dir_var = path.join(root_dir_var, 'home');
    mkdirSync(home_dir_var, { recursive: true });
    const workspace_dir_var = createWorkspace_func(root_dir_var, 'workspace');
    writeInstances_func(home_dir_var, []);

    const exec_result_var = await runCli_func(['exec', 'hello'], workspace_dir_var, home_dir_var);
    assert.equal(exec_result_var.status, 1);
    assert.match(exec_result_var.stderr, /`exec` subcommand has been removed/u);

    const resume_result_var = await runCli_func(['resume'], workspace_dir_var, home_dir_var);
    assert.equal(resume_result_var.status, 1);
    assert.match(resume_result_var.stderr, /`resume` subcommand has been removed/u);

    const missing_message_result_var = await runCli_func(
      ['--resume', '12345678-aaaa-bbbb-cccc-1234567890ab'],
      workspace_dir_var,
      home_dir_var,
    );
    assert.equal(missing_message_result_var.status, 1);
    assert.match(missing_message_result_var.stderr, /To continue an existing session, pass a message/u);
  } finally {
    rmSync(root_dir_var, { recursive: true, force: true });
  }
});

test('track 실패 시 종료코드 1 + stderr에 UI 반영 실패 메시지', async () => {
  const root_dir_var = createTempRoot_func();
  const home_dir_var = path.join(root_dir_var, 'home');
  const workspace_dir_var = createWorkspace_func(root_dir_var, 'workspace');

  const stub_var = await startStubServer_func((request_var, response_var) => {
    if (request_var.method_var === 'POST' && request_var.url_var === '/api/ls/create') {
      sendJson_func(response_var, { success: true, data: 'track-fail-id-1234' });
      return;
    }
    if (request_var.method_var === 'POST' && request_var.url_var?.startsWith('/api/ls/track/')) {
      sendJson_func(response_var, { success: false, error: 'RPC failed' });
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
      ['--async', 'track fail test'],
      workspace_dir_var,
      home_dir_var,
    );

    assert.equal(result_var.status, 1);
    assert.match(result_var.stderr, /background UI tracking failed/u);
  } finally {
    await closeServer_func(stub_var.server_var);
    rmSync(root_dir_var, { recursive: true, force: true });
  }
});

test('helper 경로(server/commands)도 macOS background launch 경로를 사용한다', async () => {
  const root_dir_var = createTempRoot_func();
  try {
    const home_dir_var = path.join(root_dir_var, 'home');
    mkdirSync(home_dir_var, { recursive: true });

    const current_workspace_var = createWorkspace_func(root_dir_var, 'commands-workspace');
    const launch_script_var = createLaunchScript_func(root_dir_var);

    const result_var = await runCli_func(
      ['commands', 'list'],
      current_workspace_var,
      home_dir_var,
      {
        ANTIGRAVITY_CLI_TEST_LAUNCH_SCRIPT: launch_script_var,
        ANTIGRAVITY_CLI_TEST_LAUNCH_MODE: 'commands',
      },
    );

    assert.equal(result_var.status, 0, result_var.stderr);
    assert.match(result_var.stdout, /antigravity\.reloadWindow/u);
    assert.match(result_var.stderr, /Creating new workspace window \(minimized\)/u);
  } finally {
    rmSync(root_dir_var, { recursive: true, force: true });
  }
});

test('helper 최소화 실패 시 명확한 오류를 낸다', async () => {
  const root_dir_var = createTempRoot_func();
  try {
    const home_dir_var = path.join(root_dir_var, 'home');
    mkdirSync(home_dir_var, { recursive: true });

    const current_workspace_var = createWorkspace_func(root_dir_var, 'timeout-workspace');

    const result_var = await runCli_func(
      ['--json', '--async', 'timeout launch'],
      current_workspace_var,
      home_dir_var,
      {
        ANTIGRAVITY_CLI_TEST_HELPER_EXIT_CODE: '13',
      },
    );

    assert.equal(result_var.status, 1);
    assert.match(result_var.stderr, /New workspace window opened but minimization failed/u);
    assert.match(result_var.stderr, new RegExp(current_workspace_var.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    rmSync(root_dir_var, { recursive: true, force: true });
  }
});

test('helper 접근성 권한 부족 시 새 Bridge 대기 전에 오류를 낸다', async () => {
  const root_dir_var = createTempRoot_func();
  try {
    const home_dir_var = path.join(root_dir_var, 'home');
    mkdirSync(home_dir_var, { recursive: true });

    const current_workspace_var = createWorkspace_func(root_dir_var, 'accessibility-workspace');

    const result_var = await runCli_func(
      ['--json', '--async', 'needs access'],
      current_workspace_var,
      home_dir_var,
      {
        ANTIGRAVITY_CLI_TEST_HELPER_EXIT_CODE: '10',
      },
    );

    assert.equal(result_var.status, 1);
    assert.match(result_var.stderr, /macOS Accessibility permission required/u);
    assert.match(result_var.stderr, /Accessibility/u);
  } finally {
    rmSync(root_dir_var, { recursive: true, force: true });
  }
});

test('루트 실행에서 /api/ls/focus 는 호출되지 않는다', async () => {
  const root_dir_var = createTempRoot_func();
  const home_dir_var = path.join(root_dir_var, 'home');
  const workspace_dir_var = createWorkspace_func(root_dir_var, 'workspace');

  const stub_var = await startStubServer_func((request_var, response_var) => {
    if (request_var.method_var === 'POST' && request_var.url_var === '/api/ls/create') {
      sendJson_func(response_var, { success: true, data: 'focus-check-id-5678' });
      return;
    }
    if (request_var.method_var === 'POST' && request_var.url_var?.startsWith('/api/ls/track/')) {
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
      ['--async', 'focus check test'],
      workspace_dir_var,
      home_dir_var,
    );

    assert.equal(result_var.status, 0, result_var.stderr);
    // focus 라우트가 호출되지 않았는지 검증
    const focus_requests_var = stub_var.requests_var.filter(
      (r_var) => r_var.url_var?.startsWith('/api/ls/focus/'),
    );
    assert.equal(focus_requests_var.length, 0, 'ls/focus 가 호출되면 안 됩니다');
    // create + track 만 호출됨
    assert.equal(stub_var.requests_var.length, 2);
  } finally {
    await closeServer_func(stub_var.server_var);
    rmSync(root_dir_var, { recursive: true, force: true });
  }
});
