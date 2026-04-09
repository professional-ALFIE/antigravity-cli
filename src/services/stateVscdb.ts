/**
 * state.vscdb USS topic bytes 추출.
 *
 * 원본: scripts/headless-backend/state_vscdb.ts (stage20에서 검증됨)
 * Antigravity 고유 모듈. Claude Code에 대응 없음.
 *
 * 이관 방법: 그대로 복사. SQLite 쿼리, base64 디코딩, USS envelope 구조 변경 없음.
 */

import { Database as BunSqliteDatabase } from 'bun:sqlite';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

type TopicName = keyof typeof TOPIC_STORAGE_KEYS;

type SqlJsDatabase = {
  run(sql_var: string, params_var?: unknown[]): void;
  export(): Uint8Array;
  prepare(sql_var: string): {
    bind(params_var: unknown[]): void;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  };
  close(): void;
};

interface UnifiedStateRow {
  value: string;
  eTag: bigint;
}

export interface TopicRowValueAtomicUpsert {
  topicName: string;
  rowKey: string;
  rowValue: string;
  eTag?: bigint;
}

export interface SidebarWorkspaceSeedRowLike {
  rowKey: string;
  rowValue: string;
  eTag?: bigint;
}

export interface SidebarWorkspaceRowValueResolution {
  rowValue: string;
  seedRowKey: string;
  source: 'runtime-target' | 'runtime-seed' | 'golden-seed';
}

interface UnifiedStateAppliedUpdate {
  key: string;
  newRow: UnifiedStateRow | null;
  deleted: boolean;
  currentETag: bigint | null;
}

export interface UnifiedStateUpdateRequestLike {
  topicName: string;
  appliedUpdate: UnifiedStateAppliedUpdate | null;
  key: string | null;
  row: UnifiedStateRow | null;
}

export const TOPIC_STORAGE_KEYS = {
  'uss-oauth': 'antigravityUnifiedStateSync.oauthToken',
  'uss-enterprisePreferences': 'antigravityUnifiedStateSync.enterprisePreferences',
  'uss-userStatus': 'antigravityUnifiedStateSync.userStatus',
  'uss-browserPreferences': 'antigravityUnifiedStateSync.browserPreferences',
  'uss-agentPreferences': 'antigravityUnifiedStateSync.agentPreferences',
  'uss-overrideStore': 'antigravityUnifiedStateSync.overrideStore',
  'uss-modelCredits': 'antigravityUnifiedStateSync.modelCredits',
  'uss-modelPreferences': 'antigravityUnifiedStateSync.modelPreferences',
  'trajectorySummaries': 'antigravityUnifiedStateSync.trajectorySummaries',
  'sidebarWorkspaces': 'antigravityUnifiedStateSync.sidebarWorkspaces',
  'uss-windowPreferences': 'antigravityUnifiedStateSync.windowPreferences',
  'uss-theme': 'antigravityUnifiedStateSync.theme',
  'uss-editorPreferences': 'antigravityUnifiedStateSync.editorPreferences',
  'uss-tabPreferences': 'antigravityUnifiedStateSync.tabPreferences',
} as const;

const LAST_SELECTED_AGENT_MODEL_SENTINEL_KEY = 'last_selected_agent_model_sentinel_key';
const SQLITE_WRITE_RETRY_DELAYS_MS = [25, 50, 100, 200, 400] as const;
const BASE64_VALUE_PATTERN_VAR = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const GOLDEN_SIDEBAR_WORKSPACE_SEED_ROW_VAR = {
  rowKey: 'file:///golden-sidebar-workspace-seed',
  rowValue: 'IiVmaWxlOi8vL2dvbGRlbi1zaWRlYmFyLXdvcmtzcGFjZS1zZWVkKgIQAQ==',
} as const;

interface ParsedSidebarWorkspaceSeedRow extends SidebarWorkspaceSeedRowLike {
  rowValueBytes: Buffer;
  workspaceUri: string;
  workspaceUriFieldStartOffset: number;
  workspaceUriFieldEndOffset: number;
}

function encodeVarint_func(value_var: number): Buffer {
  const bytes_var: number[] = [];
  let remaining_var = value_var;

  do {
    let byte_var = remaining_var & 0x7f;
    remaining_var >>= 7;
    if (remaining_var > 0) {
      byte_var |= 0x80;
    }
    bytes_var.push(byte_var);
  } while (remaining_var > 0);

  return Buffer.from(bytes_var);
}

function encodeBigVarint_func(value_var: bigint): Buffer {
  const bytes_var: number[] = [];
  let remaining_var = value_var;

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

function encodeLengthDelimitedField_func(field_number_var: number, value_var: Buffer): Buffer {
  return Buffer.concat([
    encodeTag_func(field_number_var, 2),
    encodeVarint_func(value_var.length),
    value_var,
  ]);
}

function encodeStringField_func(field_number_var: number, value_var: string): Buffer {
  return encodeLengthDelimitedField_func(field_number_var, Buffer.from(value_var, 'utf8'));
}

function encodeBigVarintField_func(field_number_var: number, value_var: bigint): Buffer {
  return Buffer.concat([
    encodeTag_func(field_number_var, 0),
    encodeBigVarint_func(value_var),
  ]);
}

function decodeBase64BufferStrict_func(base64_value_var: string): Buffer | null {
  const normalized_base64_var = base64_value_var.trim();
  if (!normalized_base64_var || !BASE64_VALUE_PATTERN_VAR.test(normalized_base64_var)) {
    return null;
  }

  const decoded_bytes_var = Buffer.from(normalized_base64_var, 'base64');
  return decoded_bytes_var.toString('base64') === normalized_base64_var
    ? decoded_bytes_var
    : null;
}

function parseSidebarWorkspaceSeedRow_func(
  seed_row_var: SidebarWorkspaceSeedRowLike,
): ParsedSidebarWorkspaceSeedRow | null {
  const row_value_bytes_var = decodeBase64BufferStrict_func(seed_row_var.rowValue);
  if (!row_value_bytes_var) {
    return null;
  }

  let workspace_uri_var: string | null = null;
  let workspace_uri_field_start_offset_var = -1;
  let workspace_uri_field_end_offset_var = -1;
  let offset_var = 0;

  try {
    while (offset_var < row_value_bytes_var.length) {
      const field_start_offset_var = offset_var;
      const { value_var: tag_var, nextOffset_var } = readVarint_func(row_value_bytes_var, offset_var);
      const field_number_var = Number(tag_var >> 3n);
      const wire_type_var = Number(tag_var & 0x07n);
      offset_var = nextOffset_var;

      if (field_number_var === 4) {
        if (wire_type_var !== 2 || workspace_uri_var !== null) {
          return null;
        }

        const {
          value_var: workspace_uri_length_var,
          nextOffset_var: workspace_uri_data_offset_var,
        } = readVarint_func(row_value_bytes_var, offset_var);
        const field_end_offset_var = workspace_uri_data_offset_var + Number(workspace_uri_length_var);
        if (field_end_offset_var > row_value_bytes_var.length) {
          return null;
        }

        workspace_uri_var = row_value_bytes_var
          .subarray(workspace_uri_data_offset_var, field_end_offset_var)
          .toString('utf8');
        workspace_uri_field_start_offset_var = field_start_offset_var;
        workspace_uri_field_end_offset_var = field_end_offset_var;
        offset_var = field_end_offset_var;
        continue;
      }

      offset_var = skipField_func(row_value_bytes_var, offset_var, wire_type_var);
      if (offset_var > row_value_bytes_var.length) {
        return null;
      }
    }
  } catch {
    return null;
  }

  if (
    workspace_uri_var === null
    || workspace_uri_var !== seed_row_var.rowKey
  ) {
    return null;
  }

  return {
    ...seed_row_var,
    rowValueBytes: row_value_bytes_var,
    workspaceUri: workspace_uri_var,
    workspaceUriFieldStartOffset: workspace_uri_field_start_offset_var,
    workspaceUriFieldEndOffset: workspace_uri_field_end_offset_var,
  };
}

function patchSidebarWorkspaceSeedRowValueBase64_func(
  parsed_seed_row_var: ParsedSidebarWorkspaceSeedRow,
  workspace_uri_var: string,
): string {
  if (parsed_seed_row_var.workspaceUri === workspace_uri_var) {
    return parsed_seed_row_var.rowValue;
  }

  const patched_bytes_var = Buffer.concat([
    parsed_seed_row_var.rowValueBytes.subarray(0, parsed_seed_row_var.workspaceUriFieldStartOffset),
    encodeStringField_func(4, workspace_uri_var),
    parsed_seed_row_var.rowValueBytes.subarray(parsed_seed_row_var.workspaceUriFieldEndOffset),
  ]);
  return patched_bytes_var.toString('base64');
}

export function resolveSidebarWorkspaceRowValueBase64_func(
  workspace_uri_var: string,
  runtime_seed_rows_var: Iterable<SidebarWorkspaceSeedRowLike>,
  options_var: {
    goldenSeedRow_var?: SidebarWorkspaceSeedRowLike | null;
  } = {},
): SidebarWorkspaceRowValueResolution | null {
  let runtime_seed_candidate_var: ParsedSidebarWorkspaceSeedRow | null = null;

  for (const runtime_seed_row_var of runtime_seed_rows_var) {
    const parsed_runtime_seed_row_var = parseSidebarWorkspaceSeedRow_func(runtime_seed_row_var);
    if (!parsed_runtime_seed_row_var) {
      continue;
    }

    if (parsed_runtime_seed_row_var.workspaceUri === workspace_uri_var) {
      return {
        rowValue: parsed_runtime_seed_row_var.rowValue,
        seedRowKey: parsed_runtime_seed_row_var.rowKey,
        source: 'runtime-target',
      };
    }

    if (!runtime_seed_candidate_var) {
      runtime_seed_candidate_var = parsed_runtime_seed_row_var;
    }
  }

  if (runtime_seed_candidate_var) {
    return {
      rowValue: patchSidebarWorkspaceSeedRowValueBase64_func(
        runtime_seed_candidate_var,
        workspace_uri_var,
      ),
      seedRowKey: runtime_seed_candidate_var.rowKey,
      source: 'runtime-seed',
    };
  }

  const golden_seed_row_var = options_var.goldenSeedRow_var ?? GOLDEN_SIDEBAR_WORKSPACE_SEED_ROW_VAR;
  if (!golden_seed_row_var) {
    return null;
  }

  const parsed_golden_seed_row_var = parseSidebarWorkspaceSeedRow_func(golden_seed_row_var);
  if (!parsed_golden_seed_row_var) {
    return null;
  }

  return {
    rowValue: patchSidebarWorkspaceSeedRowValueBase64_func(parsed_golden_seed_row_var, workspace_uri_var),
    seedRowKey: parsed_golden_seed_row_var.rowKey,
    source: 'golden-seed',
  };
}

export function createSidebarWorkspaceRowValueBase64_func(workspace_uri_var: string): string {
  const resolution_var = resolveSidebarWorkspaceRowValueBase64_func(workspace_uri_var, []);
  if (!resolution_var) {
    throw new Error('Invalid golden sidebarWorkspaces seed row');
  }
  return resolution_var.rowValue;
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

function parseMaybeConnectProtoMessage_func(body_var: Buffer): Buffer {
  if (body_var.length < 5) {
    return body_var;
  }

  const flags_var = body_var.readUInt8(0);
  const length_var = body_var.readUInt32BE(1);
  if (flags_var === 0 && (length_var + 5) <= body_var.length) {
    return body_var.subarray(5, 5 + length_var);
  }

  return body_var;
}

function decodeRow_func(buffer_var: Buffer): UnifiedStateRow {
  let value_var = '';
  let e_tag_var = 0n;
  let offset_var = 0;

  while (offset_var < buffer_var.length) {
    const { value_var: tag_var, nextOffset_var } = readVarint_func(buffer_var, offset_var);
    const field_number_var = Number(tag_var >> 3n);
    const wire_type_var = Number(tag_var & 0x07n);
    offset_var = nextOffset_var;

    if (field_number_var === 1 && wire_type_var === 2) {
      const { value_var: length_var, nextOffset_var: data_offset_var } = readVarint_func(buffer_var, offset_var);
      const end_offset_var = data_offset_var + Number(length_var);
      value_var = buffer_var.subarray(data_offset_var, end_offset_var).toString('utf8');
      offset_var = end_offset_var;
      continue;
    }

    if (field_number_var === 2 && wire_type_var === 0) {
      const decoded_var = readVarint_func(buffer_var, offset_var);
      e_tag_var = decoded_var.value_var;
      offset_var = decoded_var.nextOffset_var;
      continue;
    }

    offset_var = skipField_func(buffer_var, offset_var, wire_type_var);
  }

  return {
    value: value_var,
    eTag: e_tag_var,
  };
}

function encodeRow_func(row_var: UnifiedStateRow): Buffer {
  return Buffer.concat([
    encodeStringField_func(1, row_var.value),
    encodeBigVarintField_func(2, row_var.eTag),
  ]);
}

function decodeTopicRows_func(topic_bytes_var: Buffer): Map<string, UnifiedStateRow> {
  const rows_var = new Map<string, UnifiedStateRow>();
  let offset_var = 0;

  while (offset_var < topic_bytes_var.length) {
    const { value_var: tag_var, nextOffset_var } = readVarint_func(topic_bytes_var, offset_var);
    const field_number_var = Number(tag_var >> 3n);
    const wire_type_var = Number(tag_var & 0x07n);
    offset_var = nextOffset_var;

    if (field_number_var !== 1 || wire_type_var !== 2) {
      offset_var = skipField_func(topic_bytes_var, offset_var, wire_type_var);
      continue;
    }

    const { value_var: entry_length_var, nextOffset_var: entry_offset_var } = readVarint_func(topic_bytes_var, offset_var);
    const entry_end_var = entry_offset_var + Number(entry_length_var);
    let entry_key_var = '';
    let entry_row_var: UnifiedStateRow | null = null;
    let inner_offset_var = entry_offset_var;

    while (inner_offset_var < entry_end_var) {
      const { value_var: entry_tag_var, nextOffset_var: next_inner_offset_var } = readVarint_func(topic_bytes_var, inner_offset_var);
      const entry_field_number_var = Number(entry_tag_var >> 3n);
      const entry_wire_type_var = Number(entry_tag_var & 0x07n);
      inner_offset_var = next_inner_offset_var;

      if (entry_field_number_var === 1 && entry_wire_type_var === 2) {
        const { value_var: key_length_var, nextOffset_var: key_offset_var } = readVarint_func(topic_bytes_var, inner_offset_var);
        const key_end_var = key_offset_var + Number(key_length_var);
        entry_key_var = topic_bytes_var.subarray(key_offset_var, key_end_var).toString('utf8');
        inner_offset_var = key_end_var;
        continue;
      }

      if (entry_field_number_var === 2 && entry_wire_type_var === 2) {
        const { value_var: row_length_var, nextOffset_var: row_offset_var } = readVarint_func(topic_bytes_var, inner_offset_var);
        const row_end_var = row_offset_var + Number(row_length_var);
        entry_row_var = decodeRow_func(topic_bytes_var.subarray(row_offset_var, row_end_var));
        inner_offset_var = row_end_var;
        continue;
      }

      inner_offset_var = skipField_func(topic_bytes_var, inner_offset_var, entry_wire_type_var);
    }

    if (entry_key_var && entry_row_var) {
      rows_var.set(entry_key_var, entry_row_var);
    }
    offset_var = entry_end_var;
  }

  return rows_var;
}

function extractSentinelBase64Value_func(text_var: string, sentinel_key_var: string): string | null {
  const sentinel_index_var = text_var.indexOf(sentinel_key_var);
  if (sentinel_index_var === -1) {
    return null;
  }

  const after_var = text_var.substring(
    sentinel_index_var + sentinel_key_var.length,
    sentinel_index_var + sentinel_key_var.length + 32,
  );
  const match_var = after_var.match(/([A-Za-z0-9+/]{2,12}={0,2})/);
  return match_var?.[1] ?? null;
}

function decodeSentinelVarintFieldValue_func(
  sentinel_bytes_var: Buffer,
  field_number_var: number,
): number | null {
  let offset_var = 0;

  while (offset_var < sentinel_bytes_var.length) {
    const { value_var: tag_var, nextOffset_var } = readVarint_func(sentinel_bytes_var, offset_var);
    const current_field_number_var = Number(tag_var >> 3n);
    const wire_type_var = Number(tag_var & 0x07n);
    offset_var = nextOffset_var;

    if (current_field_number_var === field_number_var && wire_type_var === 0) {
      const decoded_var = readVarint_func(sentinel_bytes_var, offset_var);
      return Number(decoded_var.value_var);
    }

    offset_var = skipField_func(sentinel_bytes_var, offset_var, wire_type_var);
  }

  return null;
}

function normalizeSqliteValueToBase64String_func(value_var: unknown): string | null {
  if (typeof value_var === 'string') {
    return value_var;
  }
  if (value_var instanceof Uint8Array) {
    return Buffer.from(value_var).toString('utf8');
  }
  if (value_var instanceof ArrayBuffer) {
    return Buffer.from(value_var).toString('utf8');
  }
  if (ArrayBuffer.isView(value_var)) {
    return Buffer.from(value_var.buffer, value_var.byteOffset, value_var.byteLength).toString('utf8');
  }
  return value_var == null ? null : String(value_var);
}

function isRetryableSqliteWriteError_func(error_var: unknown): boolean {
  const message_var = error_var instanceof Error ? error_var.message : String(error_var);
  return /SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(message_var);
}

async function sleep_func(duration_ms_var: number): Promise<void> {
  await new Promise((resolve_var) => {
    setTimeout(resolve_var, duration_ms_var);
  });
}

export function extractSelectedModelEnumFromModelPreferencesBase64_func(
  raw_base64_var: string,
): number | null {
  const raw_bytes_var = Buffer.from(raw_base64_var, 'base64');
  const raw_text_var = raw_bytes_var.toString('utf8');
  const sentinel_base64_var = extractSentinelBase64Value_func(
    raw_text_var,
    LAST_SELECTED_AGENT_MODEL_SENTINEL_KEY,
  );
  if (!sentinel_base64_var) {
    return null;
  }

  const sentinel_bytes_var = Buffer.from(sentinel_base64_var, 'base64');
  return decodeSentinelVarintFieldValue_func(sentinel_bytes_var, 2);
}

function encodeTopicRows_func(rows_var: Map<string, UnifiedStateRow>): Buffer {
  const entries_var: Buffer[] = [];

  for (const [key_var, row_var] of rows_var.entries()) {
    const entry_var = Buffer.concat([
      encodeStringField_func(1, key_var),
      encodeLengthDelimitedField_func(2, encodeRow_func(row_var)),
    ]);
    entries_var.push(encodeLengthDelimitedField_func(1, entry_var));
  }

  return Buffer.concat(entries_var);
}

function decodeAppliedUpdate_func(buffer_var: Buffer): UnifiedStateAppliedUpdate {
  let key_var = '';
  let new_row_var: UnifiedStateRow | null = null;
  let deleted_var = false;
  let current_e_tag_var: bigint | null = null;
  let offset_var = 0;

  while (offset_var < buffer_var.length) {
    const { value_var: tag_var, nextOffset_var } = readVarint_func(buffer_var, offset_var);
    const field_number_var = Number(tag_var >> 3n);
    const wire_type_var = Number(tag_var & 0x07n);
    offset_var = nextOffset_var;

    if (field_number_var === 1 && wire_type_var === 2) {
      const { value_var: length_var, nextOffset_var: data_offset_var } = readVarint_func(buffer_var, offset_var);
      const end_offset_var = data_offset_var + Number(length_var);
      key_var = buffer_var.subarray(data_offset_var, end_offset_var).toString('utf8');
      offset_var = end_offset_var;
      continue;
    }

    if (field_number_var === 2 && wire_type_var === 2) {
      const { value_var: row_length_var, nextOffset_var: row_offset_var } = readVarint_func(buffer_var, offset_var);
      const row_end_var = row_offset_var + Number(row_length_var);
      new_row_var = decodeRow_func(buffer_var.subarray(row_offset_var, row_end_var));
      offset_var = row_end_var;
      continue;
    }

    if (field_number_var === 3 && wire_type_var === 0) {
      const decoded_var = readVarint_func(buffer_var, offset_var);
      current_e_tag_var = decoded_var.value_var;
      offset_var = decoded_var.nextOffset_var;
      continue;
    }

    if (field_number_var === 5 && wire_type_var === 0) {
      const decoded_var = readVarint_func(buffer_var, offset_var);
      deleted_var = decoded_var.value_var !== 0n;
      offset_var = decoded_var.nextOffset_var;
      continue;
    }

    offset_var = skipField_func(buffer_var, offset_var, wire_type_var);
  }

  return {
    key: key_var,
    newRow: new_row_var,
    deleted: deleted_var,
    currentETag: current_e_tag_var,
  };
}

function decodeUpdateRequestMessage_func(message_var: Buffer): UnifiedStateUpdateRequestLike {
  let topic_name_var = '';
  let applied_update_var: UnifiedStateAppliedUpdate | null = null;
  let key_var: string | null = null;
  let row_var: UnifiedStateRow | null = null;
  let offset_var = 0;

  while (offset_var < message_var.length) {
    const { value_var: tag_var, nextOffset_var } = readVarint_func(message_var, offset_var);
    const field_number_var = Number(tag_var >> 3n);
    const wire_type_var = Number(tag_var & 0x07n);
    offset_var = nextOffset_var;

    if (field_number_var === 1 && wire_type_var === 2) {
      const { value_var: length_var, nextOffset_var: data_offset_var } = readVarint_func(message_var, offset_var);
      const end_offset_var = data_offset_var + Number(length_var);
      topic_name_var = message_var.subarray(data_offset_var, end_offset_var).toString('utf8');
      offset_var = end_offset_var;
      continue;
    }

    if (field_number_var === 2 && wire_type_var === 2) {
      const { value_var: length_var, nextOffset_var: data_offset_var } = readVarint_func(message_var, offset_var);
      const end_offset_var = data_offset_var + Number(length_var);
      key_var = message_var.subarray(data_offset_var, end_offset_var).toString('utf8');
      offset_var = end_offset_var;
      continue;
    }

    if (field_number_var === 3 && wire_type_var === 2) {
      const { value_var: row_length_var, nextOffset_var: row_offset_var } = readVarint_func(message_var, offset_var);
      const row_end_var = row_offset_var + Number(row_length_var);
      row_var = decodeRow_func(message_var.subarray(row_offset_var, row_end_var));
      offset_var = row_end_var;
      continue;
    }

    if (field_number_var === 5 && wire_type_var === 2) {
      const { value_var: update_length_var, nextOffset_var: update_offset_var } = readVarint_func(message_var, offset_var);
      const update_end_var = update_offset_var + Number(update_length_var);
      applied_update_var = decodeAppliedUpdate_func(message_var.subarray(update_offset_var, update_end_var));
      offset_var = update_end_var;
      continue;
    }

    offset_var = skipField_func(message_var, offset_var, wire_type_var);
  }

  return {
    topicName: topic_name_var,
    appliedUpdate: applied_update_var,
    key: key_var,
    row: row_var,
  };
}

export function decodeUnifiedStateUpdateRequestBytes_func(body_var: Buffer): UnifiedStateUpdateRequestLike {
  const message_var = parseMaybeConnectProtoMessage_func(body_var);
  const direct_request_var = decodeUpdateRequestMessage_func(message_var);
  if (direct_request_var.appliedUpdate || direct_request_var.key || direct_request_var.row) {
    return direct_request_var;
  }

  // PushUnifiedStateSyncUpdateRequest는 field 1에 UpdateRequest를 한 겹 더 감싼다.
  // 테스트에서는 UpdateRequest 본문을 직접 넣기도 하므로,
  // wrapper가 안 맞으면 위 direct decode 결과를 그대로 쓴다.
  let offset_var = 0;
  while (offset_var < message_var.length) {
    const { value_var: tag_var, nextOffset_var } = readVarint_func(message_var, offset_var);
    const field_number_var = Number(tag_var >> 3n);
    const wire_type_var = Number(tag_var & 0x07n);
    offset_var = nextOffset_var;

    if (field_number_var === 1 && wire_type_var === 2) {
      const { value_var: length_var, nextOffset_var: data_offset_var } = readVarint_func(message_var, offset_var);
      const end_offset_var = data_offset_var + Number(length_var);
      const nested_request_var = decodeUpdateRequestMessage_func(message_var.subarray(data_offset_var, end_offset_var));
      if (nested_request_var.topicName) {
        return nested_request_var;
      }
      offset_var = end_offset_var;
      continue;
    }

    offset_var = skipField_func(message_var, offset_var, wire_type_var);
  }

  return direct_request_var;
}

function resolveStorageKeyForTopic_func(topic_name_var: string): string | null {
  if (topic_name_var in TOPIC_STORAGE_KEYS) {
    return TOPIC_STORAGE_KEYS[topic_name_var as TopicName];
  }

  if (/^[A-Za-z][A-Za-z0-9]*$/.test(topic_name_var)) {
    return `antigravityUnifiedStateSync.${topic_name_var}`;
  }

  return null;
}

async function createSqlJsDatabase_func(db_path_var: string): Promise<SqlJsDatabase> {
  const module_var = await import('sql.js');
  const init_sql_js_func = (module_var.default ?? module_var) as (options?: {
    locateFile?: (file_name_var: string) => string;
  }) => Promise<{ Database: new (buffer_var: Uint8Array) => SqlJsDatabase }>;
  const require_var = createRequire(import.meta.url);
  const sql_js_entry_var = require_var.resolve('sql.js');
  const wasm_dir_var = path.dirname(sql_js_entry_var);

  const sql_var = await init_sql_js_func({
    locateFile: (file_name_var) => path.join(wasm_dir_var, file_name_var),
  });

  return new sql_var.Database(readFileSync(db_path_var));
}

export class StateDbReader {
  private _db_var: SqlJsDatabase | null = null;
  private _open_promise_var: Promise<SqlJsDatabase> | null = null;
  private _test_before_atomic_topic_write_var:
    | ((storage_key_var: string, write_index_var: number) => void)
    | null = null;

  constructor(private readonly dbPath: string) {}

  private async _getDatabase_func(): Promise<SqlJsDatabase> {
    if (this._db_var) {
      return this._db_var;
    }
    if (!this._open_promise_var) {
      this._open_promise_var = createSqlJsDatabase_func(this.dbPath);
    }
    this._db_var = await this._open_promise_var;
    return this._db_var;
  }

  private _invalidateReadCache_func(): void {
    this._db_var?.close();
    this._db_var = null;
    this._open_promise_var = null;
  }

  private async _runSqliteWriteTransactionWithRetry_func(
    transaction_body_var: (db_var: BunSqliteDatabase) => void,
  ): Promise<void> {
    for (let attempt_index_var = 0; attempt_index_var < SQLITE_WRITE_RETRY_DELAYS_MS.length; attempt_index_var += 1) {
      const db_var = new BunSqliteDatabase(this.dbPath);
      let committed_var = false;
      try {
        db_var.exec('PRAGMA busy_timeout = 5000');
        db_var.exec('BEGIN IMMEDIATE');
        transaction_body_var(db_var);
        db_var.exec('COMMIT');
        committed_var = true;
        return;
      } catch (error_var) {
        if (!committed_var) {
          try {
            db_var.exec('ROLLBACK');
          } catch {
            // BEGIN IMMEDIATE 이전에 실패했거나 이미 종료된 경우는 무시한다.
          }
        }
        if (
          !isRetryableSqliteWriteError_func(error_var)
          || attempt_index_var === (SQLITE_WRITE_RETRY_DELAYS_MS.length - 1)
        ) {
          throw error_var;
        }
        const backoff_ms_var = SQLITE_WRITE_RETRY_DELAYS_MS[attempt_index_var] + Math.floor(Math.random() * 25);
        await sleep_func(backoff_ms_var);
      } finally {
        db_var.close();
        if (committed_var) {
          this._invalidateReadCache_func();
        }
      }
    }
  }

  private async _mutateTopicRowsInSqliteTransaction_func(
    storage_key_var: string,
    mutate_func: (topic_rows_var: Map<string, UnifiedStateRow>) => void,
  ): Promise<void> {
    await this._runSqliteWriteTransactionWithRetry_func((db_var) => {
      const select_statement_var = db_var.query('SELECT value FROM ItemTable WHERE key = ?');
      const upsert_statement_var = db_var.query(
        'INSERT INTO ItemTable (key, value) VALUES (?, ?) '
        + 'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      );
      const existing_row_var = select_statement_var.get(storage_key_var) as { value?: unknown } | null;
      const current_raw_value_var = normalizeSqliteValueToBase64String_func(existing_row_var?.value ?? null);
      const current_topic_bytes_var = current_raw_value_var
        ? Buffer.from(current_raw_value_var, 'base64')
        : Buffer.alloc(0);
      const topic_rows_var = decodeTopicRows_func(current_topic_bytes_var);

      mutate_func(topic_rows_var);

      const next_topic_bytes_var = encodeTopicRows_func(topic_rows_var);
      upsert_statement_var.run(storage_key_var, next_topic_bytes_var.toString('base64'));
    });
  }

  async getBase64Value(storage_key_var: string): Promise<string | null> {
    const db_var = await this._getDatabase_func();
    const statement_var = db_var.prepare('SELECT value FROM ItemTable WHERE key = ?');
    statement_var.bind([storage_key_var]);

    try {
      if (!statement_var.step()) {
        return null;
      }

      const row_var = statement_var.getAsObject();
      const value_var = row_var.value;
      if (typeof value_var === 'string') {
        return value_var;
      }
      if (value_var instanceof Uint8Array) {
        return Buffer.from(value_var).toString('utf8');
      }
      return value_var == null ? null : String(value_var);
    } finally {
      statement_var.free();
    }
  }

  async getTopicBytes(topic_name_var: TopicName): Promise<Buffer> {
    const storage_key_var = TOPIC_STORAGE_KEYS[topic_name_var];
    if (!storage_key_var) {
      throw new Error(`Unsupported unified-state topic: ${topic_name_var}`);
    }

    const raw_value_var = await this.getBase64Value(storage_key_var);
    if (!raw_value_var) {
      return Buffer.alloc(0);
    }

    return Buffer.from(raw_value_var, 'base64');
  }

  async createSidebarWorkspaceTopicRowAtomicUpsert_func(
    workspace_uri_var: string,
    e_tag_var: bigint = 1n,
  ): Promise<TopicRowValueAtomicUpsert | null> {
    let existing_target_e_tag_var: bigint | null = null;
    let runtime_seed_rows_var: SidebarWorkspaceSeedRowLike[] = [];

    try {
      const sidebar_topic_base64_var = await this.getBase64Value(TOPIC_STORAGE_KEYS.sidebarWorkspaces);
      const sidebar_topic_bytes_var = sidebar_topic_base64_var
        ? decodeBase64BufferStrict_func(sidebar_topic_base64_var)
        : null;
      if (sidebar_topic_bytes_var) {
        const sidebar_topic_rows_var = decodeTopicRows_func(sidebar_topic_bytes_var);
        runtime_seed_rows_var = Array.from(
          sidebar_topic_rows_var.entries(),
          ([row_key_var, row_var]) => {
            if (row_key_var === workspace_uri_var) {
              existing_target_e_tag_var = row_var.eTag;
            }

            return {
              rowKey: row_key_var,
              rowValue: row_var.value,
              eTag: row_var.eTag,
            };
          },
        );
      }
    } catch {
      runtime_seed_rows_var = [];
    }

    const sidebar_resolution_var = resolveSidebarWorkspaceRowValueBase64_func(
      workspace_uri_var,
      runtime_seed_rows_var,
    );
    if (!sidebar_resolution_var) {
      return null;
    }

    return {
      topicName: 'sidebarWorkspaces',
      rowKey: workspace_uri_var,
      rowValue: sidebar_resolution_var.rowValue,
      eTag: sidebar_resolution_var.source === 'runtime-target'
        ? (existing_target_e_tag_var ?? e_tag_var)
        : e_tag_var,
    };
  }

  async upsertBase64Value(storage_key_var: string, base64_value_var: string): Promise<void> {
    await this._runSqliteWriteTransactionWithRetry_func((db_var) => {
      db_var.query(
        'INSERT INTO ItemTable (key, value) VALUES (?, ?) '
        + 'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ).run(storage_key_var, base64_value_var);
    });
  }

  async applyUnifiedStateUpdateRequestBytes(update_request_bytes_var: Buffer): Promise<UnifiedStateUpdateRequestLike> {
    const update_request_var = decodeUnifiedStateUpdateRequestBytes_func(update_request_bytes_var);
    const storage_key_var = resolveStorageKeyForTopic_func(update_request_var.topicName);
    if (!storage_key_var) {
      return update_request_var;
    }

    const key_var = update_request_var.appliedUpdate?.key ?? update_request_var.key;
    if (!key_var) {
      return update_request_var;
    }

    const new_row_var = update_request_var.appliedUpdate?.newRow ?? update_request_var.row;
    const deleted_var = update_request_var.appliedUpdate?.deleted ?? false;
    // antigravity-cli 구현용 주석:
    // standalone LS는 topic push 행동이 항상 일정하지 않았다.
    // 어떤 재현에서는 trajectorySummaries push가 관찰됐고,
    // 더 단순한 StartCascade + SendUserCascadeMessage 재현에서는
    // browser/agent/override/modelCredits topic만 오고
    // trajectorySummaries push는 오지 않았다.
    //
    // 따라서 여기의 의미는 "push가 왔을 때 절대 버리지 않는다"는 보존 계층이다.
    // later-open UI surfaced를 닫으려면 이 보존 계층과 별개로
    // GetAllCascadeTrajectories 기반 fallback hydration도 필요하다.
    await this._mutateTopicRowsInSqliteTransaction_func(storage_key_var, (topic_rows_var) => {
      if (deleted_var || !new_row_var) {
        topic_rows_var.delete(key_var);
      } else {
        topic_rows_var.set(key_var, new_row_var);
      }
    });
    return update_request_var;
  }

  async upsertTopicRowValue(
    topic_name_var: string,
    row_key_var: string,
    row_value_var: string,
    e_tag_var: bigint = 1n,
  ): Promise<void> {
    const storage_key_var = resolveStorageKeyForTopic_func(topic_name_var);
    if (!storage_key_var) {
      return;
    }

    await this._mutateTopicRowsInSqliteTransaction_func(storage_key_var, (topic_rows_var) => {
      topic_rows_var.set(row_key_var, {
        value: row_value_var,
        eTag: e_tag_var,
      });
    });
  }

  async upsertTopicRowValuesAtomic(rows_var: TopicRowValueAtomicUpsert[]): Promise<void> {
    if (rows_var.length === 0) {
      return;
    }

    const grouped_rows_var = new Map<string, Map<string, UnifiedStateRow>>();
    for (const row_var of rows_var) {
      const storage_key_var = resolveStorageKeyForTopic_func(row_var.topicName);
      if (!storage_key_var) {
        throw new Error(`Unsupported unified-state topic: ${row_var.topicName}`);
      }
      const topic_rows_var = grouped_rows_var.get(storage_key_var) ?? new Map<string, UnifiedStateRow>();
      topic_rows_var.set(row_var.rowKey, {
        value: row_var.rowValue,
        eTag: row_var.eTag ?? 1n,
      });
      grouped_rows_var.set(storage_key_var, topic_rows_var);
    }

    await this._runSqliteWriteTransactionWithRetry_func((db_var) => {
      const select_statement_var = db_var.query('SELECT value FROM ItemTable WHERE key = ?');
      const upsert_statement_var = db_var.query(
        'INSERT INTO ItemTable (key, value) VALUES (?, ?) '
        + 'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      );
      const next_topic_rows_by_storage_key_var = new Map<string, Map<string, UnifiedStateRow>>();

      for (const [storage_key_var, pending_rows_var] of grouped_rows_var.entries()) {
        const existing_row_var = select_statement_var.get(storage_key_var) as { value?: unknown } | null;
        const current_raw_value_var = normalizeSqliteValueToBase64String_func(existing_row_var?.value ?? null);
        const current_topic_bytes_var = current_raw_value_var
          ? Buffer.from(current_raw_value_var, 'base64')
          : Buffer.alloc(0);
        const topic_rows_var = decodeTopicRows_func(current_topic_bytes_var);

        for (const [row_key_var, row_value_var] of pending_rows_var.entries()) {
          topic_rows_var.set(row_key_var, row_value_var);
        }

        next_topic_rows_by_storage_key_var.set(storage_key_var, topic_rows_var);
      }

      let write_index_var = 0;
      for (const [storage_key_var, topic_rows_var] of next_topic_rows_by_storage_key_var.entries()) {
        this._test_before_atomic_topic_write_var?.(storage_key_var, write_index_var);
        const next_topic_bytes_var = encodeTopicRows_func(topic_rows_var);
        upsert_statement_var.run(storage_key_var, next_topic_bytes_var.toString('base64'));
        write_index_var += 1;
      }
    });
  }

  async close(): Promise<void> {
    this._db_var?.close();
    this._db_var = null;
    this._open_promise_var = null;
  }

  /**
   * state.vscdb의 uss-oauth topic에서 OAuth access token을 추출한다.
   * protobuf field 1 (LEN) = access token string.
   * IDE가 antigravityAuth.getOAuthTokenInfo().accessToken으로 쓰는 것과 같은 값.
   */
  async extractOAuthAccessToken(): Promise<string | null> {
    const bytes_var = await this.getTopicBytes('uss-oauth');
    if (bytes_var.length === 0) {
      return null;
    }

    // protobuf wire format: field 1 = tag 0x0a (field_number=1, wire_type=2=LEN)
    let offset_var = 0;
    while (offset_var < bytes_var.length) {
      const tag_var = bytes_var[offset_var];
      const field_num_var = tag_var >> 3;
      const wire_type_var = tag_var & 0x7;
      offset_var += 1;

      if (wire_type_var === 2) {
        // length-delimited
        let len_var = 0;
        let shift_var = 0;
        while (offset_var < bytes_var.length) {
          const b_var = bytes_var[offset_var];
          offset_var += 1;
          len_var |= (b_var & 0x7f) << shift_var;
          shift_var += 7;
          if (!(b_var & 0x80)) break;
        }

        if (field_num_var === 1) {
          // field 1 = access token
          return bytes_var.subarray(offset_var, offset_var + len_var).toString('utf8');
        }
        offset_var += len_var;
      } else if (wire_type_var === 0) {
        // varint — skip
        while (offset_var < bytes_var.length && (bytes_var[offset_var] & 0x80)) {
          offset_var += 1;
        }
        offset_var += 1;
      } else {
        break; // unknown wire type
      }
    }

    return null;
  }

  async extractLastSelectedModelEnum(): Promise<number | null> {
    const raw_value_var = await this.getBase64Value(TOPIC_STORAGE_KEYS['uss-modelPreferences']);
    if (!raw_value_var) {
      return null;
    }

    return extractSelectedModelEnumFromModelPreferencesBase64_func(raw_value_var);
  }
}

export function createUnifiedStateUpdateEnvelope(topic_bytes_var: Buffer): Buffer {
  const update_message_var = Buffer.concat([
    Buffer.from([0x0a]),
    encodeVarint_func(topic_bytes_var.length),
    topic_bytes_var,
  ]);
  const connect_header_var = Buffer.alloc(5);
  connect_header_var.writeUInt8(0, 0);
  connect_header_var.writeUInt32BE(update_message_var.length, 1);
  return Buffer.concat([connect_header_var, update_message_var]);
}
