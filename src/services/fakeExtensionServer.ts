import http from 'node:http';

import {
  StateDbReader,
  TOPIC_STORAGE_KEYS,
  createUnifiedStateUpdateEnvelope,
  decodeUnifiedStateUpdateRequestBytes_func,
  type UnifiedStateUpdateRequestLike,
} from './stateVscdb.js';

export interface FakeExtensionServerOptions {
  stateDbPath: string;
  // antigravity-cli 구현용 주석:
  // offline LS가 PushUnifiedStateSyncUpdate(topic=trajectorySummaries)를 보낼 때,
  // 그 summary가 어느 workspace 아래 surfaced되어야 하는지 local DB에 함께 남기기 위한 힌트다.
  //
  // standalone/offline 경로에서는 IDE의 sidecar sync가 없으므로,
  // summary row만 저장하면 cold-start UI에서 orphan summary가 될 수 있다.
  // workspaceRootUri가 주어지면 fake server가 summary push를 받을 때
  // matching sidebarWorkspaces row도 같이 보강한다.
  workspaceRootUri?: string;
  host?: string;
  port?: number;
}

export interface FakeExtensionServerRequest {
  path: string;
  headers: http.IncomingHttpHeaders;
  bodyHex: string;
  topicName?: keyof typeof TOPIC_STORAGE_KEYS;
  unifiedStateTopicName?: string;
  createdAt: string;
}

function decodeVarint_func(buffer_var: Buffer, offset_var: number): { value_var: number; nextOffset_var: number } {
  let value_var = 0;
  let shift_var = 0;
  let index_var = offset_var;

  while (index_var < buffer_var.length) {
    const byte_var = buffer_var[index_var];
    value_var |= (byte_var & 0x7f) << shift_var;
    index_var += 1;
    if ((byte_var & 0x80) === 0) {
      return { value_var, nextOffset_var: index_var };
    }
    shift_var += 7;
  }

  throw new Error('unterminated varint');
}

function parseConnectProtoMessage_func(body_var: Buffer): Buffer {
  if (body_var.length < 5) {
    return Buffer.alloc(0);
  }
  const flags_var = body_var.readUInt8(0);
  if (flags_var !== 0) {
    throw new Error(`unexpected request flags: ${flags_var}`);
  }
  const length_var = body_var.readUInt32BE(1);
  return body_var.subarray(5, 5 + length_var);
}

function parseTopicName_func(body_var: Buffer): keyof typeof TOPIC_STORAGE_KEYS | undefined {
  const message_var = parseConnectProtoMessage_func(body_var);
  if (message_var.length === 0 || message_var[0] !== 0x0a) {
    return undefined;
  }

  const { value_var: length_var, nextOffset_var } = decodeVarint_func(message_var, 1);
  const topic_name_var = message_var.subarray(nextOffset_var, nextOffset_var + length_var).toString('utf8');
  return topic_name_var in TOPIC_STORAGE_KEYS
    ? topic_name_var as keyof typeof TOPIC_STORAGE_KEYS
    : undefined;
}

function normalizeHeaderValue_func(header_value_var: string | string[] | undefined): string {
  if (Array.isArray(header_value_var)) {
    return header_value_var[0] ?? '';
  }
  return header_value_var ?? '';
}

function frameConnectMessage_func(frame_body_var: Buffer): Buffer {
  const header_var = Buffer.alloc(5);
  header_var.writeUInt8(0, 0);
  header_var.writeUInt32BE(frame_body_var.length, 1);
  return Buffer.concat([header_var, frame_body_var]);
}

function readRequestBodyBackground_func(
  request_var: http.IncomingMessage,
  request_log_var: FakeExtensionServerRequest,
): Promise<Buffer> {
  return new Promise((resolve_var, reject_var) => {
    const chunks_var: Buffer[] = [];
    request_var.on('data', (chunk_var) => {
      const buffer_var = Buffer.isBuffer(chunk_var) ? chunk_var : Buffer.from(chunk_var);
      chunks_var.push(buffer_var);
      request_log_var.bodyHex = Buffer.concat(chunks_var).toString('hex');
    });
    request_var.on('end', () => {
      resolve_var(Buffer.concat(chunks_var));
    });
    request_var.on('error', reject_var);
  });
}

function sendProtoResponse_func(response_var: http.ServerResponse, payload_var: Buffer = Buffer.alloc(0)): void {
  response_var.writeHead(200, {
    'Content-Type': 'application/proto',
    'Connect-Protocol-Version': '1',
    'Content-Length': String(payload_var.length),
  });
  response_var.end(payload_var);
}

function sendConnectProtoResponse_func(
  response_var: http.ServerResponse,
  payload_var: Buffer = Buffer.alloc(0),
): void {
  const framed_payload_var = frameConnectMessage_func(payload_var);
  response_var.writeHead(200, {
    'Content-Type': 'application/connect+proto',
    'Connect-Protocol-Version': '1',
    'Content-Length': String(framed_payload_var.length),
  });
  response_var.end(framed_payload_var);
}

function extractUnifiedStateUpdateTarget_func(parsed_update_var: UnifiedStateUpdateRequestLike): {
  key_var: string | null;
  new_row_var: { value: string; eTag: bigint } | null;
  deleted_var: boolean;
} {
  return {
    key_var: parsed_update_var.appliedUpdate?.key ?? parsed_update_var.key,
    new_row_var: parsed_update_var.appliedUpdate?.newRow ?? parsed_update_var.row,
    deleted_var: parsed_update_var.appliedUpdate?.deleted ?? false,
  };
}

export class FakeExtensionServer {
  readonly requests: FakeExtensionServerRequest[] = [];

  private readonly _stateDbReader_var: StateDbReader;
  private readonly _openStreams_var = new Set<http.ServerResponse>();
  private _server_var: http.Server | null = null;
  private _port_var = 0;

  constructor(private readonly options: FakeExtensionServerOptions) {
    this._stateDbReader_var = new StateDbReader(options.stateDbPath);
  }

  get port(): number {
    return this._port_var;
  }

  private async _applyUnifiedStateUpdate_func(
    body_var: Buffer,
    parsed_update_var: UnifiedStateUpdateRequestLike,
  ): Promise<void> {
    const { workspaceRootUri } = this.options;
    const {
      key_var,
      new_row_var,
      deleted_var,
    } = extractUnifiedStateUpdateTarget_func(parsed_update_var);

    if (
      workspaceRootUri
      && parsed_update_var.topicName === 'trajectorySummaries'
      && key_var
      && new_row_var
      && !deleted_var
    ) {
      // antigravity-cli 구현용 주석:
      // 실측상 standalone LS는 trajectorySummaries push를 보내는 경우가 있었지만,
      // 같은 턴에서 sidebarWorkspaces까지 자동 보장해 주지는 않았다.
      //
      // 이 분기는 "summary만 쓰고 workspace row는 빠지는" half-persist를 막기 위한 것.
      // fake extension server가 summary push를 받으면, 동일 transaction 안에서
      // workspaceRootUri용 sidebarWorkspaces row까지 같이 써서
      // later-open Workspaces UI가 최소한 같은 workspace anchor를 갖도록 만든다.
      //
      // 주의: 이것은 live IDE sidecar를 흉내 내는 범용 로직이 아니라
      // offline harness가 놓치기 쉬운 persisted state coupling을 메워 주는 보강 로직이다.
      const sidebar_workspace_row_var =
        await this._stateDbReader_var.createSidebarWorkspaceTopicRowAtomicUpsert_func(workspaceRootUri);
      if (!sidebar_workspace_row_var) {
        throw new Error(`Failed to prepare sidebarWorkspaces row for ${workspaceRootUri}`);
      }

      await this._stateDbReader_var.upsertTopicRowValuesAtomic([
        {
          topicName: 'trajectorySummaries',
          rowKey: key_var,
          rowValue: new_row_var.value,
          eTag: new_row_var.eTag,
        },
        sidebar_workspace_row_var,
      ]);
      return;
    }

    await this._stateDbReader_var.applyUnifiedStateUpdateRequestBytes(body_var);
  }

  async start(): Promise<void> {
    if (this._server_var) {
      return;
    }

    this._server_var = http.createServer(async (request_var, response_var) => {
      const request_log_var: FakeExtensionServerRequest = {
        path: request_var.url ?? '/',
        headers: request_var.headers,
        bodyHex: '',
        createdAt: new Date().toISOString(),
      };
      this.requests.push(request_log_var);
      const body_promise_var = readRequestBodyBackground_func(request_var, request_log_var);

      try {
        if (
          request_log_var.path.endsWith('/LanguageServerStarted')
          || request_log_var.path.endsWith('/GetChromeDevtoolsMcpUrl')
          || request_log_var.path.endsWith('/Heartbeat')
        ) {
          sendProtoResponse_func(response_var);
          return;
        }

        if (request_log_var.path.endsWith('/CheckTerminalShellSupport')) {
          const content_type_var = normalizeHeaderValue_func(request_log_var.headers['content-type']);
          const response_payload_var = Buffer.from('080112037a73681a082f62696e2f7a7368', 'hex');

          if (content_type_var.includes('application/connect+proto')) {
            sendConnectProtoResponse_func(response_var, response_payload_var);
            return;
          }

          sendProtoResponse_func(response_var, response_payload_var);
          return;
        }

        const body_var = await body_promise_var;
        if (request_log_var.path.endsWith('/PushUnifiedStateSyncUpdate')) {
          const parsed_update_var = decodeUnifiedStateUpdateRequestBytes_func(body_var);
          request_log_var.unifiedStateTopicName = parsed_update_var.topicName;
          // antigravity-cli 구현용 주석:
          // current harness 재현에서는 StartChatClientRequestStream을 먼저 열어도
          // StreamCascadeSummariesReactiveUpdates RPC는 여전히
          // "reactive state is disabled"로 실패했다.
          //
          // 그런데 같은 런타임에서 PushUnifiedStateSyncUpdate(topic=trajectorySummaries)는
          // 실제로 도착했다. 즉 standalone LS도 summary push 자체는 하고 있다.
          //
          // 따라서 fake server는 더 이상 ACK-only로 버리면 안 되고,
          // state.vscdb의 antigravityUnifiedStateSync.trajectorySummaries 쪽으로
          // 최소한의 local hydration을 반영해야 later IDE surfaced 가능성을 남길 수 있다.
          //
          // 또한 workspaceRootUri가 있으면 summary와 sidebar row를 함께 보강해,
          // "summary는 남았는데 Workspaces에 anchor가 없다"는 상태를 줄인다.
          await this._applyUnifiedStateUpdate_func(body_var, parsed_update_var);
          sendProtoResponse_func(response_var);
          return;
        }

        if (request_log_var.path.endsWith('/SubscribeToUnifiedStateSyncTopic')) {
          const topic_name_var = parseTopicName_func(body_var);
          request_log_var.topicName = topic_name_var;

          const topic_bytes_var = topic_name_var
            ? await this._stateDbReader_var.getTopicBytes(topic_name_var)
            : Buffer.alloc(0);

          response_var.writeHead(200, {
            'Content-Type': 'application/connect+proto',
            'Connect-Protocol-Version': '1',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          // antigravity-cli 구현용 주석:
          // 우리 fake는 이미 long-lived stream 구현이다.
          // response.write() 후 end()를 하지 않고, close 때만 정리한다.
          // 예전에 "단발 응답"이라고 오판했던 부분이라 주석으로 고정한다.
          response_var.write(createUnifiedStateUpdateEnvelope(topic_bytes_var));
          this._openStreams_var.add(response_var);
          response_var.on('close', () => {
            this._openStreams_var.delete(response_var);
          });
          return;
        }

        response_var.writeHead(404, { 'Content-Length': '0' });
        response_var.end();
      } catch (error_var) {
        response_var.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        response_var.end(error_var instanceof Error ? error_var.message : String(error_var));
      }
    });

    await new Promise<void>((resolve_var, reject_var) => {
      this._server_var?.listen(
        this.options.port ?? 0,
        this.options.host ?? '127.0.0.1',
        () => {
          const address_var = this._server_var?.address();
          if (!address_var || typeof address_var === 'string') {
            reject_var(new Error('failed to determine fake extension server port'));
            return;
          }
          this._port_var = address_var.port;
          resolve_var();
        },
      );
      this._server_var?.once('error', reject_var);
    });
  }

  async stop(): Promise<void> {
    for (const stream_var of this._openStreams_var) {
      stream_var.destroy();
    }
    this._openStreams_var.clear();

    await this._stateDbReader_var.close();

    if (!this._server_var) {
      return;
    }

    const server_var = this._server_var;
    this._server_var = null;
    await new Promise<void>((resolve_var, reject_var) => {
      server_var.close((error_var) => {
        if (error_var) {
          reject_var(error_var);
          return;
        }
        resolve_var();
      });
    });
  }
}
