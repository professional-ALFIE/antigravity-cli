/**
 * LS startup metadata builder — protobuf wire format.
 *
 * 원본: scripts/headless-backend/make_metadata.ts (stage20에서 검증됨)
 * Antigravity 고유 모듈. Claude Code에 대응 없음.
 *
 * 이관 방법: 그대로 복사. protobuf wire format은 한 바이트도 바꾸지 않는다.
 * import 경로만 수정: './config.js' → 같은 디렉토리 내 config.
 */

import crypto from 'node:crypto';

import type { HeadlessBackendConfig } from './config.js';

export interface MetadataFields {
  ideName: string;
  extensionVersion: string;
  apiKey: string;
  locale: string;
  os: string;
  ideVersion: string;
  hardware: string;
  sessionId: string;
  extensionName: string;
  extensionPath: string;
  triggerId: string;
  id: string;
  userTierId: string;
}

export const METADATA_FIELD_NUMBERS = {
  ideName: 1,
  extensionVersion: 2,
  apiKey: 3,
  locale: 4,
  os: 5,
  ideVersion: 7,
  hardware: 8,
  sessionId: 10,
  extensionName: 12,
  extensionPath: 17,
  triggerId: 25,
  id: 27,
  userTierId: 29,
} as const satisfies Record<keyof MetadataFields, number>;

const METADATA_FIELD_ORDER: Array<keyof MetadataFields> = [
  'ideName',
  'extensionVersion',
  'apiKey',
  'locale',
  'os',
  'ideVersion',
  'hardware',
  'sessionId',
  'extensionName',
  'extensionPath',
  'triggerId',
  'id',
  'userTierId',
];

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

function encodeStringField_func(field_number_var: number, value_var: string): Buffer {
  const value_bytes_var = Buffer.from(value_var, 'utf8');
  const tag_var = (field_number_var << 3) | 2;
  return Buffer.concat([
    encodeVarint_func(tag_var),
    encodeVarint_func(value_bytes_var.length),
    value_bytes_var,
  ]);
}

function toTextproto_func(fields_var: MetadataFields, redact_api_key_var: boolean): string {
  return [
    `ide_name: "${fields_var.ideName}"`,
    `extension_version: "${fields_var.extensionVersion}"`,
    `api_key: "${redact_api_key_var ? '[REDACTED]' : fields_var.apiKey}"`,
    `locale: "${fields_var.locale}"`,
    `os: "${fields_var.os}"`,
    `ide_version: "${fields_var.ideVersion}"`,
    `hardware: "${fields_var.hardware}"`,
    `session_id: "${fields_var.sessionId}"`,
    `extension_name: "${fields_var.extensionName}"`,
    `extension_path: "${fields_var.extensionPath}"`,
    `trigger_id: "${fields_var.triggerId}"`,
    `id: "${fields_var.id}"`,
    `user_tier_id: "${fields_var.userTierId}"`,
  ].join('\n');
}

export function createMetadataFields(
  config_var: Pick<HeadlessBackendConfig, 'env' | 'extensionVersion' | 'extensionRootPath' | 'ideVersion'>,
  overrides_var: Partial<MetadataFields> = {},
): MetadataFields {
  const api_key_var = overrides_var.apiKey ?? config_var.env.ANTIGRAVITY_OAUTH_ACCESS_TOKEN;
  if (!api_key_var) {
    throw new Error('ANTIGRAVITY_OAUTH_ACCESS_TOKEN is required to build LS startup metadata.');
  }

  return {
    ideName: overrides_var.ideName ?? 'antigravity',
    extensionVersion: overrides_var.extensionVersion ?? config_var.extensionVersion,
    apiKey: api_key_var,
    locale: overrides_var.locale ?? 'ko',
    os: overrides_var.os ?? 'mac',
    ideVersion: overrides_var.ideVersion ?? config_var.ideVersion,
    hardware: overrides_var.hardware ?? process.arch,
    sessionId: overrides_var.sessionId ?? crypto.randomUUID(),
    extensionName: overrides_var.extensionName ?? 'antigravity',
    extensionPath: overrides_var.extensionPath ?? config_var.extensionRootPath,
    triggerId: overrides_var.triggerId ?? crypto.randomUUID(),
    id: overrides_var.id ?? crypto.randomUUID(),
    userTierId: overrides_var.userTierId ?? '',
  };
}

export function buildMetadataArtifact(fields_var: MetadataFields): {
  fields: MetadataFields;
  binary: Buffer;
  textproto: string;
  redactedTextproto: string;
} {
  const binary_parts_var = METADATA_FIELD_ORDER.map((field_name_var) =>
    encodeStringField_func(METADATA_FIELD_NUMBERS[field_name_var], fields_var[field_name_var]));

  return {
    fields: fields_var,
    binary: Buffer.concat(binary_parts_var),
    textproto: toTextproto_func(fields_var, false),
    redactedTextproto: toTextproto_func(fields_var, true),
  };
}
