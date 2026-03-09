import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import type * as http from 'node:http';
import type { AntigravitySDK } from 'antigravity-sdk';
import { handleLs } from '../src/server/routes/ls.ts';

type MockResponse = http.ServerResponse & {
  body_var: string;
  status_code_var: number;
};

function createJsonRequest_func(method_var: string, body_var: unknown): http.IncomingMessage {
  const req_var = new PassThrough() as unknown as http.IncomingMessage;
  req_var.method = method_var;

  process.nextTick(() => {
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

test('/api/ls/create 는 문자열 model 을 그대로 sdk.ls.createCascade 에 전달한다', async () => {
  let received_options_var: unknown;

  const sdk_var = {
    ls: {
      async createCascade(options_var: unknown) {
        received_options_var = options_var;
        return 'cascade-id';
      },
    },
  } as AntigravitySDK;

  const req_var = createJsonRequest_func('POST', {
    text: 'hello',
    model: 'MODEL_PLACEHOLDER_M26',
  });
  const res_var = createResponse_func();

  await handleLs(req_var, res_var, sdk_var, ['create']);

  assert.deepEqual(received_options_var, {
    text: 'hello',
    model: 'MODEL_PLACEHOLDER_M26',
  });
  assert.equal(res_var.status_code_var, 200);
});

test('/api/ls/send/:id 는 문자열 model 을 그대로 sdk.ls.sendMessage 에 전달한다', async () => {
  let received_options_var: unknown;

  const sdk_var = {
    ls: {
      async sendMessage(options_var: unknown) {
        received_options_var = options_var;
        return true;
      },
    },
  } as AntigravitySDK;

  const req_var = createJsonRequest_func('POST', {
    text: 'hello',
    model: 'MODEL_PLACEHOLDER_M35',
  });
  const res_var = createResponse_func();

  await handleLs(req_var, res_var, sdk_var, ['send', 'cascade-id']);

  assert.deepEqual(received_options_var, {
    cascadeId: 'cascade-id',
    text: 'hello',
    model: 'MODEL_PLACEHOLDER_M35',
  });
  assert.equal(res_var.status_code_var, 200);
});
