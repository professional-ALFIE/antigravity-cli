import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import type * as http from 'node:http';
import type { AntigravitySDK } from 'antigravity-sdk';
import { handleCascade } from '../src/server/routes/cascade.ts';
import { resetCascadeCapabilitiesForTesting_func } from '../src/server/cascade-driver.ts';

type MockResponse = http.ServerResponse & {
  body_var: string;
  status_code_var: number;
};

function createJsonRequest_func(method_var: string, body_var?: unknown): http.IncomingMessage {
  const req_var = new PassThrough() as unknown as http.IncomingMessage;
  req_var.method = method_var;

  process.nextTick(() => {
    if (body_var === undefined) {
      (req_var as unknown as PassThrough).end();
      return;
    }

    const payload_var = JSON.stringify(body_var);
    (req_var as unknown as PassThrough).end(payload_var);
  });

  return req_var;
}

function createResponse_func(): MockResponse {
  return {
    body_var: '',
    status_code_var: 0,
    writeHead(status_code_var: number) {
      this.status_code_var = status_code_var;
      return this;
    },
    end(chunk_var?: string | Buffer) {
      if (chunk_var) {
        this.body_var += Buffer.isBuffer(chunk_var) ? chunk_var.toString('utf8') : chunk_var;
      }
      return this;
    },
  } as MockResponse;
}

test.afterEach(() => {
  resetCascadeCapabilitiesForTesting_func();
});

test('/api/cascade/capabilities 는 현재 빌드에서 감지된 command 매핑을 반환한다', async () => {
  const sdk_var = {
    commands: {
      async getAntigravityCommands() {
        return [
          'antigravity.prioritized.agentAcceptAllInFile',
          'antigravity.command.accept',
          'antigravity.terminalCommand.accept',
        ];
      },
    },
  } as AntigravitySDK;

  const req_var = createJsonRequest_func('GET');
  const res_var = createResponse_func();

  await handleCascade(req_var, res_var, sdk_var, ['capabilities']);

  const payload_var = JSON.parse(res_var.body_var) as Record<string, unknown>;
  const data_var = payload_var['data'] as Record<string, unknown>;
  assert.equal(res_var.status_code_var, 200);
  assert.equal(data_var['editAcceptCommand'], 'antigravity.prioritized.agentAcceptAllInFile');
  assert.equal(data_var['commandAcceptCommand'], 'antigravity.command.accept');
  assert.equal(data_var['terminalRunCommand'], 'antigravity.terminalCommand.accept');
});

test('/api/cascade/drive 는 SDK accept-step 경로가 가능하면 그것을 우선 사용한다', async () => {
  let accept_step_calls_var = 0;

  const sdk_var = {
    cascade: {
      async acceptStep() {
        accept_step_calls_var += 1;
      },
      async acceptCommand() {
        throw new Error('should not run');
      },
      async runTerminalCommand() {
        throw new Error('should not run');
      },
    },
    commands: {
      async getAntigravityCommands() {
        return [];
      },
      async execute() {
        throw new Error('should not run');
      },
    },
  } as unknown as AntigravitySDK;

  const req_var = createJsonRequest_func('POST', {});
  const res_var = createResponse_func();
  await handleCascade(req_var, res_var, sdk_var, ['drive']);

  const payload_var = JSON.parse(res_var.body_var) as Record<string, unknown>;
  const data_var = payload_var['data'] as Record<string, unknown>;
  assert.equal(res_var.status_code_var, 200);
  assert.equal(accept_step_calls_var, 1);
  assert.equal(data_var['performed'], true);
  assert.equal(data_var['action'], 'accept-edit');
  assert.equal(data_var['via'], 'sdk');
});

test('/api/cascade/drive 는 SDK accept-step 실패 시 감지된 fallback command 로 복구한다', async () => {
  const executed_commands_var: string[] = [];

  const sdk_var = {
    cascade: {
      async acceptStep() {
        throw new Error('sdk accept failed');
      },
      async acceptCommand() {
        throw new Error('sdk command failed');
      },
      async runTerminalCommand() {
        throw new Error('sdk terminal failed');
      },
    },
    commands: {
      async getAntigravityCommands() {
        return ['antigravity.prioritized.agentAcceptAllInFile'];
      },
      async execute(command_var: string) {
        executed_commands_var.push(command_var);
      },
    },
  } as unknown as AntigravitySDK;

  const req_var = createJsonRequest_func('POST', {});
  const res_var = createResponse_func();
  await handleCascade(req_var, res_var, sdk_var, ['drive']);

  const payload_var = JSON.parse(res_var.body_var) as Record<string, unknown>;
  const data_var = payload_var['data'] as Record<string, unknown>;
  assert.equal(res_var.status_code_var, 200);
  assert.deepEqual(executed_commands_var, ['antigravity.prioritized.agentAcceptAllInFile']);
  assert.equal(data_var['performed'], true);
  assert.equal(data_var['action'], 'accept-edit');
  assert.equal(data_var['via'], 'command');
  assert.equal(data_var['command'], 'antigravity.prioritized.agentAcceptAllInFile');
});

test('/api/cascade/drive 는 pending step 이 없을 때 안전하게 no-op 한다', async () => {
  const sdk_var = {
    cascade: {
      async acceptStep() {
        throw new Error('no pending edit');
      },
      async acceptCommand() {
        throw new Error('no pending command');
      },
      async runTerminalCommand() {
        throw new Error('no pending terminal');
      },
    },
    commands: {
      async getAntigravityCommands() {
        return [];
      },
      async execute() {
        throw new Error('no commands available');
      },
    },
  } as unknown as AntigravitySDK;

  const req_var = createJsonRequest_func('POST', {});
  const res_var = createResponse_func();
  await handleCascade(req_var, res_var, sdk_var, ['drive']);

  const payload_var = JSON.parse(res_var.body_var) as Record<string, unknown>;
  const data_var = payload_var['data'] as Record<string, unknown>;
  assert.equal(res_var.status_code_var, 200);
  assert.equal(data_var['performed'], false);
  assert.equal(data_var['action'], null);
});
