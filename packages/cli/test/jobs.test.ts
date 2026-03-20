import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

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
  return mkdtempSync(path.join(tmpdir(), 'ag-cli-jobs-'));
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

function getJobsDir_func(home_dir_var: string): string {
  return path.join(home_dir_var, '.antigravity-cli', 'jobs');
}

function readSingleJob_func(home_dir_var: string): Record<string, unknown> {
  const jobs_dir_var = getJobsDir_func(home_dir_var);
  const entries_var = readdirSync(jobs_dir_var);
  assert.equal(entries_var.length, 1);
  return JSON.parse(readFileSync(path.join(jobs_dir_var, entries_var[0]), 'utf-8')) as Record<string, unknown>;
}

async function startStubServer_func(
  handler_var: (request_var: StubRequest, response_var: http.ServerResponse, raw_req_var: http.IncomingMessage) => void | Promise<void>,
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
    await handler_var(request_var, res_var, req_var);
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

function sendSseConnected_func(response_var: http.ServerResponse, request_var: http.IncomingMessage): void {
  response_var.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  response_var.write('event: connected\ndata: {"message":"Monitor connected"}\n\n');
  request_var.on('close', () => {
    response_var.end();
  });
}

function buildConversation_func(status_var: string, response_var = ''): Record<string, unknown> {
  return {
    status: status_var,
    numTotalSteps: response_var ? 6 : 3,
    trajectory: {
      steps: [
        {
          type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
          status: response_var ? 'CORTEX_STEP_STATUS_DONE' : 'CORTEX_STEP_STATUS_GENERATING',
          plannerResponse: response_var
            ? { response: response_var, modifiedResponse: response_var }
            : {},
          metadata: {
            createdAt: '2026-03-20T04:00:00.000Z',
            completedAt: response_var ? '2026-03-20T04:00:05.000Z' : undefined,
          },
        },
      ],
    },
  };
}

test('waited root run persists a completed job record and auto policy drives progress', async () => {
  const root_dir_var = createTempRoot_func();
  const home_dir_var = path.join(root_dir_var, 'home');
  const workspace_dir_var = createWorkspace_func(root_dir_var, 'workspace');
  let drive_requests_var = 0;
  let conversation_requests_var = 0;

  const stub_var = await startStubServer_func((request_var, response_var, raw_req_var) => {
    if (request_var.method_var === 'GET' && request_var.url_var === '/api/health') {
      sendJson_func(response_var, { success: true, uptime: 1 });
      return;
    }
    if (request_var.method_var === 'POST' && request_var.url_var === '/api/ls/create') {
      sendJson_func(response_var, { success: true, data: 'wait-job-cascade-id' });
      return;
    }
    if (request_var.method_var === 'POST' && request_var.url_var === '/api/ls/track/wait-job-cascade-id') {
      sendJson_func(response_var, { success: true });
      return;
    }
    if (request_var.method_var === 'POST' && request_var.url_var === '/api/cascade/drive') {
      drive_requests_var += 1;
      sendJson_func(response_var, { success: true, data: { performed: false, action: null, via: null, command: null } });
      return;
    }
    if (request_var.method_var === 'GET' && request_var.url_var === '/api/monitor/events') {
      sendSseConnected_func(response_var, raw_req_var);
      return;
    }
    if (request_var.method_var === 'GET' && request_var.url_var === '/api/ls/conversation/wait-job-cascade-id') {
      conversation_requests_var += 1;
      sendJson_func(response_var, {
        success: true,
        data: conversation_requests_var >= 2
          ? buildConversation_func('CASCADE_RUN_STATUS_DONE', 'Auto wait finished')
          : buildConversation_func('CASCADE_RUN_STATUS_RUNNING'),
      });
      return;
    }
    if (request_var.method_var === 'GET' && request_var.url_var === '/api/ls/list') {
      sendJson_func(response_var, {
        success: true,
        data: {
          'wait-job-cascade-id': {
            summary: 'Waited job',
            stepCount: conversation_requests_var >= 2 ? 6 : 3,
            lastModifiedTime: '2026-03-20T04:00:06.000Z',
          },
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
      ['waited root run'],
      workspace_dir_var,
      home_dir_var,
    );

    assert.equal(result_var.status, 0, result_var.stderr);
    assert.match(result_var.stdout, /Auto wait finished/u);
    assert.ok(drive_requests_var >= 2, `expected repeated drive calls, got ${drive_requests_var}`);

    const job_var = readSingleJob_func(home_dir_var);
    assert.equal(job_var['cascadeId'], 'wait-job-cascade-id');
    assert.equal(job_var['status'], 'completed');
    assert.equal(job_var['approvalPolicy'], 'auto');
    assert.equal(typeof job_var['jobId'], 'string');
    assert.equal(
      ((job_var['result'] as Record<string, unknown>)['responseText']),
      'Auto wait finished',
    );
  } finally {
    await closeServer_func(stub_var.server_var);
    rmSync(root_dir_var, { recursive: true, force: true });
  }
});

test('approval-policy manual never calls cascade/drive during waited runs', async () => {
  const root_dir_var = createTempRoot_func();
  const home_dir_var = path.join(root_dir_var, 'home');
  const workspace_dir_var = createWorkspace_func(root_dir_var, 'workspace');
  let drive_requests_var = 0;

  const stub_var = await startStubServer_func((request_var, response_var, raw_req_var) => {
    if (request_var.method_var === 'GET' && request_var.url_var === '/api/health') {
      sendJson_func(response_var, { success: true, uptime: 1 });
      return;
    }
    if (request_var.method_var === 'POST' && request_var.url_var === '/api/ls/create') {
      sendJson_func(response_var, { success: true, data: 'manual-cascade-id' });
      return;
    }
    if (request_var.method_var === 'POST' && request_var.url_var === '/api/ls/track/manual-cascade-id') {
      sendJson_func(response_var, { success: true });
      return;
    }
    if (request_var.method_var === 'POST' && request_var.url_var === '/api/cascade/drive') {
      drive_requests_var += 1;
      sendJson_func(response_var, { success: true, data: { performed: false } });
      return;
    }
    if (request_var.method_var === 'GET' && request_var.url_var === '/api/monitor/events') {
      sendSseConnected_func(response_var, raw_req_var);
      return;
    }
    if (request_var.method_var === 'GET' && request_var.url_var === '/api/ls/conversation/manual-cascade-id') {
      sendJson_func(response_var, {
        success: true,
        data: buildConversation_func('CASCADE_RUN_STATUS_DONE', 'Manual wait finished'),
      });
      return;
    }
    if (request_var.method_var === 'GET' && request_var.url_var === '/api/ls/list') {
      sendJson_func(response_var, {
        success: true,
        data: {
          'manual-cascade-id': {
            summary: 'Manual waited job',
            stepCount: 5,
            lastModifiedTime: '2026-03-20T04:00:06.000Z',
          },
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
      ['--approval-policy', 'manual', 'manual wait run'],
      workspace_dir_var,
      home_dir_var,
    );

    assert.equal(result_var.status, 0, result_var.stderr);
    assert.equal(drive_requests_var, 0);
  } finally {
    await closeServer_func(stub_var.server_var);
    rmSync(root_dir_var, { recursive: true, force: true });
  }
});

test('jobs status, jobs wait, and jobs result operate on the same persisted job record', async () => {
  const root_dir_var = createTempRoot_func();
  const home_dir_var = path.join(root_dir_var, 'home');
  const workspace_dir_var = createWorkspace_func(root_dir_var, 'workspace');
  const job_id_var = 'job-record-1234';
  const created_at_var = new Date(Date.now() - 2000).toISOString();
  let file_written_var = false;

  const stub_var = await startStubServer_func((request_var, response_var, raw_req_var) => {
    if (request_var.method_var === 'GET' && request_var.url_var === '/api/health') {
      sendJson_func(response_var, { success: true, uptime: 1 });
      return;
    }
    if (request_var.method_var === 'GET' && request_var.url_var === '/api/monitor/events') {
      sendSseConnected_func(response_var, raw_req_var);
      return;
    }
    if (request_var.method_var === 'POST' && request_var.url_var === '/api/cascade/drive') {
      sendJson_func(response_var, { success: true, data: { performed: false } });
      return;
    }
    if (request_var.method_var === 'GET' && request_var.url_var === '/api/ls/conversation/job-record-cascade') {
      if (!file_written_var) {
        writeFileSync(path.join(workspace_dir_var, 'index.html'), '<!doctype html>', 'utf-8');
        file_written_var = true;
      }
      sendJson_func(response_var, {
        success: true,
        data: buildConversation_func('CASCADE_RUN_STATUS_DONE', 'Wait command finished'),
      });
      return;
    }
    if (request_var.method_var === 'GET' && request_var.url_var === '/api/ls/list') {
      sendJson_func(response_var, {
        success: true,
        data: {
          'job-record-cascade': {
            summary: 'Persisted job',
            stepCount: 8,
            lastModifiedTime: '2026-03-20T04:00:08.000Z',
          },
        },
      });
      return;
    }

    response_var.writeHead(404);
    response_var.end();
  });

  try {
    mkdirSync(getJobsDir_func(home_dir_var), { recursive: true });
    writeInstances_func(home_dir_var, [
      { port: stub_var.port_var, workspace: workspace_dir_var, pid: 1 },
    ]);
    writeFileSync(
      path.join(getJobsDir_func(home_dir_var), `${job_id_var}.json`),
      JSON.stringify({
        jobId: job_id_var,
        cascadeId: 'job-record-cascade',
        workspace: workspace_dir_var,
        prompt: 'persisted prompt',
        createdAt: created_at_var,
        updatedAt: created_at_var,
        status: 'running',
        approvalPolicy: 'auto',
        lastStepCount: 0,
        lastModifiedTime: created_at_var,
        result: null,
      }, null, 2),
      'utf-8',
    );

    const status_result_var = await runCli_func(
      ['--json', 'jobs', 'status', job_id_var],
      workspace_dir_var,
      home_dir_var,
    );
    assert.equal(status_result_var.status, 0, status_result_var.stderr);
    assert.equal((JSON.parse(status_result_var.stdout) as Record<string, unknown>)['status'], 'running');

    const wait_result_var = await runCli_func(
      ['--json', 'jobs', 'wait', job_id_var],
      workspace_dir_var,
      home_dir_var,
    );
    assert.equal(wait_result_var.status, 0, wait_result_var.stderr);
    const waited_result_var = JSON.parse(wait_result_var.stdout) as Record<string, unknown>;
    assert.equal(waited_result_var['responseText'], 'Wait command finished');

    const result_result_var = await runCli_func(
      ['--json', 'jobs', 'result', job_id_var],
      workspace_dir_var,
      home_dir_var,
    );
    assert.equal(result_result_var.status, 0, result_result_var.stderr);
    const stored_result_var = JSON.parse(result_result_var.stdout) as Record<string, unknown>;
    assert.equal(stored_result_var['responseText'], 'Wait command finished');
    assert.deepEqual(stored_result_var['changedFiles'], ['index.html']);

    const persisted_job_var = JSON.parse(
      readFileSync(path.join(getJobsDir_func(home_dir_var), `${job_id_var}.json`), 'utf-8'),
    ) as Record<string, unknown>;
    assert.equal(persisted_job_var['status'], 'completed');
    assert.equal(
      ((persisted_job_var['result'] as Record<string, unknown>)['responseText']),
      'Wait command finished',
    );
  } finally {
    await closeServer_func(stub_var.server_var);
    rmSync(root_dir_var, { recursive: true, force: true });
  }
});

test('wait timeout marks the persisted job as timed_out and preserves cascadeId', async () => {
  const root_dir_var = createTempRoot_func();
  const home_dir_var = path.join(root_dir_var, 'home');
  const workspace_dir_var = createWorkspace_func(root_dir_var, 'workspace');
  let conversation_requests_var = 0;

  const stub_var = await startStubServer_func((request_var, response_var, raw_req_var) => {
    if (request_var.method_var === 'GET' && request_var.url_var === '/api/health') {
      sendJson_func(response_var, { success: true, uptime: 1 });
      return;
    }
    if (request_var.method_var === 'POST' && request_var.url_var === '/api/ls/create') {
      sendJson_func(response_var, { success: true, data: 'timeout-cascade-id' });
      return;
    }
    if (request_var.method_var === 'POST' && request_var.url_var === '/api/ls/track/timeout-cascade-id') {
      sendJson_func(response_var, { success: true });
      return;
    }
    if (request_var.method_var === 'POST' && request_var.url_var === '/api/cascade/drive') {
      sendJson_func(response_var, { success: true, data: { performed: false } });
      return;
    }
    if (request_var.method_var === 'GET' && request_var.url_var === '/api/monitor/events') {
      sendSseConnected_func(response_var, raw_req_var);
      return;
    }
    if (request_var.method_var === 'GET' && request_var.url_var === '/api/ls/conversation/timeout-cascade-id') {
      conversation_requests_var += 1;
      sendJson_func(response_var, {
        success: true,
        data: {
          status: 'CASCADE_RUN_STATUS_RUNNING',
          numTotalSteps: conversation_requests_var,
          trajectory: {
            steps: [
              {
                type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
                status: 'CORTEX_STEP_STATUS_GENERATING',
                metadata: {
                  createdAt: `2026-03-20T04:00:0${conversation_requests_var}.000Z`,
                },
              },
            ],
          },
        },
      });
      return;
    }
    if (request_var.method_var === 'GET' && request_var.url_var === '/api/ls/list') {
      sendJson_func(response_var, {
        success: true,
        data: {
          'timeout-cascade-id': {
            summary: 'Timeout job',
            stepCount: conversation_requests_var,
            lastModifiedTime: `2026-03-20T04:00:0${conversation_requests_var}.000Z`,
          },
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
      ['--idle-timeout', '50', 'timeout root run'],
      workspace_dir_var,
      home_dir_var,
      {
        ANTIGRAVITY_CLI_MAX_WAIT_MS: '900',
      },
    );

    assert.equal(result_var.status, 124, result_var.stderr);
    const job_var = readSingleJob_func(home_dir_var);
    assert.equal(job_var['status'], 'timed_out');
    assert.equal(job_var['cascadeId'], 'timeout-cascade-id');
  } finally {
    await closeServer_func(stub_var.server_var);
    rmSync(root_dir_var, { recursive: true, force: true });
  }
});
