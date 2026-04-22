import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

export interface DiscoveryInfo {
  pid?: number;
  httpsPort?: number;
  httpPort?: number;
  lspPort?: number;
  lsVersion?: string;
  csrfToken?: string;
}

export interface ConnectRpcCallOptions {
  discovery?: DiscoveryInfo;
  discoveryPath?: string;
  protocol?: 'http' | 'https';
  certPath?: string;
  serviceName?: string;
  method: string;
  payload: unknown;
  outputDirPath?: string;
  timeoutMs?: number;
}

export interface ConnectRpcCallResult {
  discovery: DiscoveryInfo;
  url: string;
  requestHeaders: Record<string, string | number>;
  requestBody: string;
  responseStatusCode: number;
  responseHeaders: http.IncomingHttpHeaders;
  rawResponseBody: string;
  responseBody: unknown;
}

export interface ModelSelectionChoice {
  kind: 'model' | 'alias';
  value: number;
}

export interface CascadeConfigProtoOptions {
  planModel: number;
  requestedModel?: ModelSelectionChoice;
  agenticMode?: boolean;
}

export interface StartCascadeProtoOptions {
  source?: number;
  trajectoryType?: number;
  cascadeId?: string;
  workspaceUris: string[];
}

export interface SendUserCascadeMessageProtoOptions {
  cascadeId: string;
  text: string;
  cascadeConfig: CascadeConfigProtoOptions;
  clientType?: number;
  messageOrigin?: number;
  propagateError?: boolean;
}

export interface SendAllQueuedMessagesProtoOptions {
  cascadeId: string;
  cascadeConfig: CascadeConfigProtoOptions;
}

export interface SignalExecutableIdleProtoOptions {
  conversationId: string;
}

export interface StartChatClientRequestStreamProtoOptions {
  clientType?: number;
}

export interface ConnectProtoRpcCallOptions {
  discovery?: DiscoveryInfo;
  discoveryPath?: string;
  protocol?: 'http' | 'https';
  certPath?: string;
  serviceName?: string;
  method: string;
  requestBody: Buffer;
  outputDirPath?: string;
  timeoutMs?: number;
  responseDecoder?: (body_var: Buffer) => unknown;
}

export interface ConnectProtoRpcCallResult {
  discovery: DiscoveryInfo;
  url: string;
  requestHeaders: Record<string, string | number>;
  requestBody: Buffer;
  responseStatusCode: number;
  responseHeaders: http.IncomingHttpHeaders;
  rawResponseBody: Buffer;
  responseBody: unknown;
}

export interface ConnectProtoFrame {
  flags: number;
  data: Buffer;
}

export interface ConnectProtoStreamOptions {
  discovery?: DiscoveryInfo;
  discoveryPath?: string;
  protocol?: 'http' | 'https';
  certPath?: string;
  serviceName?: string;
  method: string;
  requestBody: Buffer;
  timeoutMs?: number;
  onFrame?: (frame_var: ConnectProtoFrame) => void;
}

export interface ConnectProtoStreamHandle {
  url: string;
  requestHeaders: Record<string, string | number>;
  frames: ConnectProtoFrame[];
  firstFrame: Promise<ConnectProtoFrame>;
  responseStarted: Promise<{ statusCode: number; headers: http.IncomingHttpHeaders }>;
  completed: Promise<void>;
  close: () => void;
}

export const LANGUAGE_SERVER_SERVICE_NAME = 'exa.language_server_pb.LanguageServerService';
export const CHAT_CLIENT_SERVER_SERVICE_NAME = 'exa.chat_client_server_pb.ChatClientServerService';

export const CASCADE_CLIENT = 1;
export const CHAT_CLIENT_TYPE_IDE = 1;
export const MESSAGE_ORIGIN_SDK_EXECUTABLE = 2;
export const CASCADE_RUN_STATUS_IDLE = 1;
export const CLIENT_TRAJECTORY_VERBOSITY_PROD_UI = 2;

function parseJsonMaybe_func(raw_body_var: string): unknown {
  if (!raw_body_var) {
    return null;
  }
  try {
    return JSON.parse(raw_body_var);
  } catch {
    return raw_body_var;
  }
}

function choosePort_func(discovery_var: DiscoveryInfo, protocol_var: 'http' | 'https'): number {
  const port_var = protocol_var === 'https'
    ? discovery_var.httpsPort
    : discovery_var.httpPort;

  if (!port_var) {
    throw new Error(`Discovery is missing ${protocol_var.toUpperCase()} port.`);
  }
  return port_var;
}

function buildServiceUrl_func(
  protocol_var: 'http' | 'https',
  port_var: number,
  service_name_var: string,
  method_var: string,
): string {
  return `${protocol_var}://127.0.0.1:${port_var}/${service_name_var}/${method_var}`;
}

function encodeVarint_func(value_var: number | bigint): Buffer {
  let remaining_var = typeof value_var === 'bigint' ? value_var : BigInt(value_var);
  if (remaining_var < 0) {
    throw new Error(`Negative varint values are not supported: ${value_var}`);
  }

  const bytes_var: number[] = [];
  do {
    let byte_var = Number(remaining_var & 0x7fn);
    remaining_var >>= 7n;
    if (remaining_var > 0n) {
      byte_var |= 0x80;
    }
    bytes_var.push(byte_var);
  } while (remaining_var > 0n);

  return Buffer.from(bytes_var);
}

function encodeTag_func(field_number_var: number, wire_type_var: number): Buffer {
  return encodeVarint_func((field_number_var << 3) | wire_type_var);
}

function encodeLengthDelimitedField_func(field_number_var: number, value_buffer_var: Buffer): Buffer {
  return Buffer.concat([
    encodeTag_func(field_number_var, 2),
    encodeVarint_func(value_buffer_var.length),
    value_buffer_var,
  ]);
}

function encodeStringField_func(field_number_var: number, value_var: string): Buffer {
  return encodeLengthDelimitedField_func(field_number_var, Buffer.from(value_var, 'utf8'));
}

function encodeVarintField_func(field_number_var: number, value_var: number | bigint): Buffer {
  return Buffer.concat([
    encodeTag_func(field_number_var, 0),
    encodeVarint_func(value_var),
  ]);
}

function encodeBoolField_func(field_number_var: number, value_var: boolean): Buffer {
  return encodeVarintField_func(field_number_var, value_var ? 1 : 0);
}

function readVarint_func(buffer_var: Buffer, offset_var: number): { value_var: bigint; nextOffset_var: number } {
  let value_var = 0n;
  let shift_var = 0n;
  let index_var = offset_var;

  while (index_var < buffer_var.length) {
    const byte_var = BigInt(buffer_var[index_var]);
    value_var |= (byte_var & 0x7fn) << shift_var;
    index_var += 1;
    if ((byte_var & 0x80n) === 0n) {
      return { value_var, nextOffset_var: index_var };
    }
    shift_var += 7n;
  }

  throw new Error('unterminated varint');
}

function skipField_func(buffer_var: Buffer, offset_var: number, wire_type_var: number): number {
  if (wire_type_var === 0) {
    return readVarint_func(buffer_var, offset_var).nextOffset_var;
  }
  if (wire_type_var === 1) {
    return offset_var + 8;
  }
  if (wire_type_var === 2) {
    const { value_var: length_var, nextOffset_var } = readVarint_func(buffer_var, offset_var);
    return nextOffset_var + Number(length_var);
  }
  if (wire_type_var === 5) {
    return offset_var + 4;
  }

  throw new Error(`Unsupported wire type ${wire_type_var}`);
}

function decodeFirstStringField_func(buffer_var: Buffer, field_number_var: number): string | null {
  let offset_var = 0;

  while (offset_var < buffer_var.length) {
    const { value_var: tag_var, nextOffset_var } = readVarint_func(buffer_var, offset_var);
    const current_field_number_var = Number(tag_var >> 3n);
    const wire_type_var = Number(tag_var & 0x07n);
    offset_var = nextOffset_var;

    if (current_field_number_var === field_number_var && wire_type_var === 2) {
      const { value_var: length_var, nextOffset_var: after_length_var } = readVarint_func(buffer_var, offset_var);
      return buffer_var
        .subarray(after_length_var, after_length_var + Number(length_var))
        .toString('utf8');
    }

    offset_var = skipField_func(buffer_var, offset_var, wire_type_var);
  }

  return null;
}

function decodeFirstBoolField_func(buffer_var: Buffer, field_number_var: number): boolean | null {
  let offset_var = 0;

  while (offset_var < buffer_var.length) {
    const { value_var: tag_var, nextOffset_var } = readVarint_func(buffer_var, offset_var);
    const current_field_number_var = Number(tag_var >> 3n);
    const wire_type_var = Number(tag_var & 0x07n);
    offset_var = nextOffset_var;

    if (current_field_number_var === field_number_var && wire_type_var === 0) {
      return readVarint_func(buffer_var, offset_var).value_var !== 0n;
    }

    offset_var = skipField_func(buffer_var, offset_var, wire_type_var);
  }

  return null;
}

function writeProtoCaptureFiles_func(
  output_dir_path_var: string,
  method_var: string,
  result_var: ConnectProtoRpcCallResult,
): void {
  mkdirSync(output_dir_path_var, { recursive: true });
  writeFileSync(
    path.join(output_dir_path_var, `${method_var}.request.json`),
    JSON.stringify(
      {
        method: method_var,
        url: result_var.url,
        headers: result_var.requestHeaders,
        bodyHex: result_var.requestBody.toString('hex'),
        bodyBase64: result_var.requestBody.toString('base64'),
      },
      null,
      2,
    ),
    'utf8',
  );
  writeFileSync(
    path.join(output_dir_path_var, `${method_var}.headers.json`),
    JSON.stringify(
      {
        statusCode: result_var.responseStatusCode,
        headers: result_var.responseHeaders,
      },
      null,
      2,
    ),
    'utf8',
  );
  writeFileSync(
    path.join(output_dir_path_var, `${method_var}.response.json`),
    JSON.stringify(
      {
        bodyHex: result_var.rawResponseBody.toString('hex'),
        bodyBase64: result_var.rawResponseBody.toString('base64'),
        decodedBody: result_var.responseBody,
      },
      null,
      2,
    ),
    'utf8',
  );
}

function buildModelOrAliasProto_func(selection_var: ModelSelectionChoice): Buffer {
  return selection_var.kind === 'alias'
    ? encodeVarintField_func(2, selection_var.value)
    : encodeVarintField_func(1, selection_var.value);
}

function buildCascadeConversationalPlannerConfigProto_func(agentic_mode_var: boolean): Buffer {
  return agentic_mode_var ? encodeBoolField_func(14, true) : Buffer.alloc(0);
}

function buildCascadePlannerConfigProto_func(options_var: CascadeConfigProtoOptions): Buffer {
  const requested_model_var = options_var.requestedModel ?? {
    kind: 'model',
    value: options_var.planModel,
  } satisfies ModelSelectionChoice;

  return Buffer.concat([
    encodeVarintField_func(1, options_var.planModel),
    encodeLengthDelimitedField_func(
      2,
      buildCascadeConversationalPlannerConfigProto_func(options_var.agenticMode ?? true),
    ),
    encodeLengthDelimitedField_func(15, buildModelOrAliasProto_func(requested_model_var)),
  ]);
}

export function buildCascadeConfigProto(options_var: CascadeConfigProtoOptions): Buffer {
  return encodeLengthDelimitedField_func(1, buildCascadePlannerConfigProto_func(options_var));
}

export function buildTextOrScopeItemProto(text_var: string): Buffer {
  return encodeStringField_func(1, text_var);
}

export function buildStartCascadeRequestProto(options_var: StartCascadeProtoOptions): Buffer {
  const parts_var: Buffer[] = [
    encodeVarintField_func(4, options_var.source ?? CASCADE_CLIENT),
  ];

  if (options_var.trajectoryType != null) {
    parts_var.push(encodeVarintField_func(5, options_var.trajectoryType));
  }
  if (options_var.cascadeId) {
    parts_var.push(encodeStringField_func(7, options_var.cascadeId));
  }
  for (const workspace_uri_var of options_var.workspaceUris) {
    parts_var.push(encodeStringField_func(8, workspace_uri_var));
  }

  return Buffer.concat(parts_var);
}

export function buildSendUserCascadeMessageRequestProto(options_var: SendUserCascadeMessageProtoOptions): Buffer {
  return Buffer.concat([
    encodeStringField_func(1, options_var.cascadeId),
    encodeLengthDelimitedField_func(2, buildTextOrScopeItemProto(options_var.text)),
    encodeLengthDelimitedField_func(5, buildCascadeConfigProto(options_var.cascadeConfig)),
    encodeVarintField_func(11, options_var.clientType ?? CHAT_CLIENT_TYPE_IDE),
    encodeBoolField_func(16, options_var.propagateError ?? true),
    encodeVarintField_func(18, options_var.messageOrigin ?? MESSAGE_ORIGIN_SDK_EXECUTABLE),
  ]);
}

export function buildSendAllQueuedMessagesRequestProto(options_var: SendAllQueuedMessagesProtoOptions): Buffer {
  return Buffer.concat([
    encodeStringField_func(2, options_var.cascadeId),
    encodeLengthDelimitedField_func(3, buildCascadeConfigProto(options_var.cascadeConfig)),
  ]);
}

export function buildSignalExecutableIdleRequestProto(options_var: SignalExecutableIdleProtoOptions): Buffer {
  return encodeStringField_func(1, options_var.conversationId);
}

export function buildStartChatClientRequestStreamRequestProto(
  options_var: StartChatClientRequestStreamProtoOptions = {},
): Buffer {
  return encodeVarintField_func(1, options_var.clientType ?? CHAT_CLIENT_TYPE_IDE);
}

export function frameConnectMessage(frame_body_var: Buffer, flags_var = 0): Buffer {
  const header_var = Buffer.alloc(5);
  header_var.writeUInt8(flags_var, 0);
  header_var.writeUInt32BE(frame_body_var.length, 1);
  return Buffer.concat([header_var, frame_body_var]);
}

export function parseConnectFrames(buffer_var: Buffer): { frames: ConnectProtoFrame[]; rest: Buffer } {
  const frames_var: ConnectProtoFrame[] = [];
  let offset_var = 0;

  while (offset_var + 5 <= buffer_var.length) {
    const flags_var = buffer_var.readUInt8(offset_var);
    const body_length_var = buffer_var.readUInt32BE(offset_var + 1);
    const frame_end_var = offset_var + 5 + body_length_var;
    if (frame_end_var > buffer_var.length) {
      break;
    }

    frames_var.push({
      flags: flags_var,
      data: buffer_var.subarray(offset_var + 5, frame_end_var),
    });
    offset_var = frame_end_var;
  }

  return {
    frames: frames_var,
    rest: buffer_var.subarray(offset_var),
  };
}

export function decodeStartCascadeResponseProto(response_body_var: Buffer): { cascadeId: string | null } {
  return {
    cascadeId: decodeFirstStringField_func(response_body_var, 1),
  };
}

export function decodeSendUserCascadeMessageResponseProto(response_body_var: Buffer): { queued: boolean } {
  return {
    queued: decodeFirstBoolField_func(response_body_var, 1) ?? false,
  };
}

function writeCaptureFiles_func(
  output_dir_path_var: string,
  method_var: string,
  result_var: ConnectRpcCallResult,
): void {
  mkdirSync(output_dir_path_var, { recursive: true });
  writeFileSync(
    path.join(output_dir_path_var, `${method_var}.request.json`),
    JSON.stringify(
      {
        method: method_var,
        url: result_var.url,
        headers: result_var.requestHeaders,
        body: parseJsonMaybe_func(result_var.requestBody),
      },
      null,
      2,
    ),
    'utf8',
  );
  writeFileSync(
    path.join(output_dir_path_var, `${method_var}.headers.json`),
    JSON.stringify(
      {
        statusCode: result_var.responseStatusCode,
        headers: result_var.responseHeaders,
      },
      null,
      2,
    ),
    'utf8',
  );
  writeFileSync(
    path.join(output_dir_path_var, `${method_var}.response.json`),
    JSON.stringify(result_var.responseBody, null, 2),
    'utf8',
  );
}

export function readDiscoveryFile(discovery_path_var: string): DiscoveryInfo {
  return JSON.parse(readFileSync(discovery_path_var, 'utf8')) as DiscoveryInfo;
}

export function findLatestDiscoveryFile(options_var: {
  daemonDirPath: string;
  pid?: number;
  startTimeMs?: number;
}): { discoveryPath: string; discovery: DiscoveryInfo } | null {
  if (!existsSync(options_var.daemonDirPath)) {
    return null;
  }
  const candidates_var = readdirSync(options_var.daemonDirPath)
    .filter((entry_var) => /^ls_.*\.json$/u.test(entry_var))
    .map((entry_var) => {
      const discovery_path_var = path.join(options_var.daemonDirPath, entry_var);
      const stat_var = statSync(discovery_path_var);
      return {
        discoveryPath: discovery_path_var,
        discovery: readDiscoveryFile(discovery_path_var),
        modifiedMs: stat_var.mtimeMs,
      };
    })
    .filter((entry_var) => (
      (options_var.startTimeMs == null || entry_var.modifiedMs >= options_var.startTimeMs)
      && (options_var.pid == null || entry_var.discovery.pid === options_var.pid)
    ))
    .sort((left_var, right_var) => right_var.modifiedMs - left_var.modifiedMs);

  if (candidates_var.length === 0) {
    return null;
  }

  return {
    discoveryPath: candidates_var[0].discoveryPath,
    discovery: candidates_var[0].discovery,
  };
}

export async function waitForDiscoveryFile(options_var: {
  daemonDirPath: string;
  pid?: number;
  startTimeMs?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<{ discoveryPath: string; discovery: DiscoveryInfo }> {
  const timeout_ms_var = options_var.timeoutMs ?? 15000;
  const poll_interval_ms_var = options_var.pollIntervalMs ?? 100;
  const deadline_var = Date.now() + timeout_ms_var;

  while (Date.now() < deadline_var) {
    const discovery_var = findLatestDiscoveryFile(options_var);
    if (discovery_var) {
      return discovery_var;
    }
    await new Promise((resolve_var) => setTimeout(resolve_var, poll_interval_ms_var));
  }

  throw new Error(`Discovery file was not created within ${timeout_ms_var}ms.`);
}

export async function callConnectRpc(options_var: ConnectRpcCallOptions): Promise<ConnectRpcCallResult> {
  const discovery_var = options_var.discovery
    ?? (options_var.discoveryPath ? readDiscoveryFile(options_var.discoveryPath) : null);
  if (!discovery_var) {
    throw new Error('Either discovery or discoveryPath is required.');
  }

  const protocol_var = options_var.protocol ?? 'https';
  const port_var = choosePort_func(discovery_var, protocol_var);
  const request_body_var = JSON.stringify(options_var.payload);
  const request_headers_var: Record<string, string | number> = {
    'Connect-Protocol-Version': '1',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(request_body_var),
  };

  if (discovery_var.csrfToken) {
    request_headers_var['x-codeium-csrf-token'] = discovery_var.csrfToken;
  }

  const module_var = protocol_var === 'https' ? https : http;
  const url_var = buildServiceUrl_func(
    protocol_var,
    port_var,
    options_var.serviceName ?? LANGUAGE_SERVER_SERVICE_NAME,
    options_var.method,
  );

  const result_var = await new Promise<ConnectRpcCallResult>((resolve_var, reject_var) => {
    const request_options_var: https.RequestOptions = {
      method: 'POST',
      headers: request_headers_var,
      timeout: options_var.timeoutMs ?? 10000,
    };

    if (protocol_var === 'https') {
      request_options_var.ca = options_var.certPath ? readFileSync(options_var.certPath) : undefined;
      request_options_var.rejectUnauthorized = false;
    }

    const request_var = module_var.request(url_var, request_options_var, (response_var) => {
      let raw_response_body_var = '';
      response_var.setEncoding('utf8');
      response_var.on('data', (chunk_var) => {
        raw_response_body_var += chunk_var;
      });
      response_var.on('end', () => {
        const response_body_var = parseJsonMaybe_func(raw_response_body_var);
        const response_status_code_var = response_var.statusCode ?? 0;
        const call_result_var: ConnectRpcCallResult = {
          discovery: discovery_var,
          url: url_var,
          requestHeaders: request_headers_var,
          requestBody: request_body_var,
          responseStatusCode: response_status_code_var,
          responseHeaders: response_var.headers,
          rawResponseBody: raw_response_body_var,
          responseBody: response_body_var,
        };

        if (response_status_code_var >= 200 && response_status_code_var < 300) {
          resolve_var(call_result_var);
          return;
        }

        reject_var(new Error(
          `Connect RPC ${options_var.method} failed with ${response_status_code_var}: ${raw_response_body_var.slice(0, 300)}`,
        ));
      });
    });

    request_var.on('error', reject_var);
    request_var.on('timeout', () => {
      request_var.destroy(new Error(`Connect RPC ${options_var.method} timed out.`));
    });
    request_var.write(request_body_var);
    request_var.end();
  });

  if (options_var.outputDirPath) {
    writeCaptureFiles_func(options_var.outputDirPath, options_var.method, result_var);
  }

  return result_var;
}

export async function callConnectProtoRpc(
  options_var: ConnectProtoRpcCallOptions,
): Promise<ConnectProtoRpcCallResult> {
  const discovery_var = options_var.discovery
    ?? (options_var.discoveryPath ? readDiscoveryFile(options_var.discoveryPath) : null);
  if (!discovery_var) {
    throw new Error('Either discovery or discoveryPath is required.');
  }

  const protocol_var = options_var.protocol ?? 'https';
  const port_var = choosePort_func(discovery_var, protocol_var);
  const request_headers_var: Record<string, string | number> = {
    'Connect-Protocol-Version': '1',
    'Content-Type': 'application/proto',
    'Content-Length': options_var.requestBody.length,
  };

  if (discovery_var.csrfToken) {
    request_headers_var['x-codeium-csrf-token'] = discovery_var.csrfToken;
  }

  const module_var = protocol_var === 'https' ? https : http;
  const url_var = buildServiceUrl_func(
    protocol_var,
    port_var,
    options_var.serviceName ?? LANGUAGE_SERVER_SERVICE_NAME,
    options_var.method,
  );

  const result_var = await new Promise<ConnectProtoRpcCallResult>((resolve_var, reject_var) => {
    const request_options_var: https.RequestOptions = {
      method: 'POST',
      headers: request_headers_var,
      timeout: options_var.timeoutMs ?? 10000,
    };

    if (protocol_var === 'https') {
      request_options_var.ca = options_var.certPath ? readFileSync(options_var.certPath) : undefined;
      request_options_var.rejectUnauthorized = false;
    }

    const request_var = module_var.request(url_var, request_options_var, (response_var) => {
      const response_chunks_var: Buffer[] = [];
      response_var.on('data', (chunk_var) => {
        response_chunks_var.push(Buffer.isBuffer(chunk_var) ? chunk_var : Buffer.from(chunk_var));
      });
      response_var.on('end', () => {
        const raw_response_body_var = Buffer.concat(response_chunks_var);
        const response_status_code_var = response_var.statusCode ?? 0;
        const call_result_var: ConnectProtoRpcCallResult = {
          discovery: discovery_var,
          url: url_var,
          requestHeaders: request_headers_var,
          requestBody: options_var.requestBody,
          responseStatusCode: response_status_code_var,
          responseHeaders: response_var.headers,
          rawResponseBody: raw_response_body_var,
          responseBody: options_var.responseDecoder
            ? options_var.responseDecoder(raw_response_body_var)
            : raw_response_body_var,
        };

        if (response_status_code_var >= 200 && response_status_code_var < 300) {
          resolve_var(call_result_var);
          return;
        }

        reject_var(new Error(
          `Connect proto RPC ${options_var.method} failed with ${response_status_code_var}: ${raw_response_body_var.toString('utf8').slice(0, 300)}`,
        ));
      });
    });

    request_var.on('error', reject_var);
    request_var.on('timeout', () => {
      request_var.destroy(new Error(`Connect proto RPC ${options_var.method} timed out.`));
    });
    request_var.write(options_var.requestBody);
    request_var.end();
  });

  if (options_var.outputDirPath) {
    writeProtoCaptureFiles_func(options_var.outputDirPath, options_var.method, result_var);
  }

  return result_var;
}

export function startConnectProtoStream(options_var: ConnectProtoStreamOptions): ConnectProtoStreamHandle {
  const discovery_var = options_var.discovery
    ?? (options_var.discoveryPath ? readDiscoveryFile(options_var.discoveryPath) : null);
  if (!discovery_var) {
    throw new Error('Either discovery or discoveryPath is required.');
  }

  const protocol_var = options_var.protocol ?? 'https';
  const port_var = choosePort_func(discovery_var, protocol_var);
  const request_headers_var: Record<string, string | number> = {
    'Connect-Protocol-Version': '1',
    'Content-Type': 'application/connect+proto',
    'Content-Length': frameConnectMessage(options_var.requestBody).length,
  };

  if (discovery_var.csrfToken) {
    request_headers_var['x-codeium-csrf-token'] = discovery_var.csrfToken;
  }

  const module_var = protocol_var === 'https' ? https : http;
  const url_var = buildServiceUrl_func(
    protocol_var,
    port_var,
    options_var.serviceName ?? CHAT_CLIENT_SERVER_SERVICE_NAME,
    options_var.method,
  );
  const request_payload_var = frameConnectMessage(options_var.requestBody);
  request_headers_var['Content-Length'] = request_payload_var.length;

  const frames_var: ConnectProtoFrame[] = [];
  let request_var: http.ClientRequest | null = null;
  let response_var: http.IncomingMessage | null = null;
  let closed_manually_var = false;
  let first_frame_seen_var = false;
  let buffered_bytes_var = Buffer.alloc(0);

  let resolve_first_frame_var: ((frame_var: ConnectProtoFrame) => void) | null = null;
  let reject_first_frame_var: ((error_var: unknown) => void) | null = null;
  const first_frame_var = new Promise<ConnectProtoFrame>((resolve_var, reject_var) => {
    resolve_first_frame_var = resolve_var;
    reject_first_frame_var = reject_var;
  });

  let resolve_response_started_var: ((value_var: {
    statusCode: number;
    headers: http.IncomingHttpHeaders;
  }) => void) | null = null;
  let reject_response_started_var: ((error_var: unknown) => void) | null = null;
  const response_started_var = new Promise<{ statusCode: number; headers: http.IncomingHttpHeaders }>((resolve_var, reject_var) => {
    resolve_response_started_var = resolve_var;
    reject_response_started_var = reject_var;
  });

  const completed_var = new Promise<void>((resolve_var, reject_var) => {
    const request_options_var: https.RequestOptions = {
      method: 'POST',
      headers: request_headers_var,
    };

    if (protocol_var === 'https') {
      request_options_var.ca = options_var.certPath ? readFileSync(options_var.certPath) : undefined;
      request_options_var.rejectUnauthorized = false;
    }

    request_var = module_var.request(url_var, request_options_var, (incoming_response_var) => {
      response_var = incoming_response_var;
      resolve_response_started_var?.({
        statusCode: incoming_response_var.statusCode ?? 0,
        headers: incoming_response_var.headers,
      });

      if ((incoming_response_var.statusCode ?? 0) < 200 || (incoming_response_var.statusCode ?? 0) >= 300) {
        const error_chunks_var: Buffer[] = [];
        incoming_response_var.on('data', (chunk_var) => {
          error_chunks_var.push(Buffer.isBuffer(chunk_var) ? chunk_var : Buffer.from(chunk_var));
        });
        incoming_response_var.on('end', () => {
          const error_var = new Error(
            `Connect proto stream ${options_var.method} failed with ${incoming_response_var.statusCode ?? 0}: ${Buffer.concat(error_chunks_var).toString('utf8').slice(0, 300)}`,
          );
          reject_first_frame_var?.(error_var);
          reject_var(error_var);
        });
        return;
      }

      incoming_response_var.on('data', (chunk_var) => {
        buffered_bytes_var = Buffer.concat([
          buffered_bytes_var,
          Buffer.isBuffer(chunk_var) ? chunk_var : Buffer.from(chunk_var),
        ]);

        const parsed_var = parseConnectFrames(buffered_bytes_var);
        buffered_bytes_var = parsed_var.rest;

        for (const frame_var of parsed_var.frames) {
          frames_var.push(frame_var);
          options_var.onFrame?.(frame_var);
          if (!first_frame_seen_var) {
            first_frame_seen_var = true;
            resolve_first_frame_var?.(frame_var);
          }
        }
      });

      incoming_response_var.on('end', () => {
        if (!first_frame_seen_var) {
          reject_first_frame_var?.(new Error(`Connect proto stream ${options_var.method} ended before the first frame arrived.`));
        }
        resolve_var();
      });
      incoming_response_var.on('close', () => {
        if (closed_manually_var) {
          resolve_var();
        }
      });
      incoming_response_var.on('error', (error_var) => {
        if (closed_manually_var) {
          if (!first_frame_seen_var) {
            reject_first_frame_var?.(new Error(`Connect proto stream ${options_var.method} was closed before the first frame arrived.`));
          }
          resolve_var();
          return;
        }

        reject_first_frame_var?.(error_var);
        reject_var(error_var);
      });
    });

    request_var.on('error', (error_var) => {
      if (closed_manually_var) {
        resolve_var();
        return;
      }

      reject_response_started_var?.(error_var);
      reject_first_frame_var?.(error_var);
      reject_var(error_var);
    });
    request_var.write(request_payload_var);
    request_var.end();
  });

  return {
    url: url_var,
    requestHeaders: request_headers_var,
    frames: frames_var,
    firstFrame: first_frame_var,
    responseStarted: response_started_var,
    completed: completed_var,
    close: () => {
      closed_manually_var = true;
      response_var?.destroy();
      request_var?.destroy();
    },
  };
}
