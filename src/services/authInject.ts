import { readFileSync, writeFileSync } from 'node:fs';

function encodeVarint_func(value_var: number): number[] {
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
  return bytes_var;
}

function encodeTag_func(fieldNumber_var: number, wireType_var: number): number[] {
  return encodeVarint_func((fieldNumber_var << 3) | wireType_var);
}

function encodeStringField_func(fieldNumber_var: number, value_var: string): Buffer {
  const valueBytes_var = Buffer.from(value_var, 'utf8');
  return Buffer.from([
    ...encodeTag_func(fieldNumber_var, 2),
    ...encodeVarint_func(valueBytes_var.length),
    ...valueBytes_var,
  ]);
}

function encodeVarintField_func(fieldNumber_var: number, value_var: number): Buffer {
  return Buffer.from([
    ...encodeTag_func(fieldNumber_var, 0),
    ...encodeVarint_func(value_var),
  ]);
}

function createOauthInfoBytes_func(options_var: {
  accessToken: string;
  refreshToken: string;
  expiryTimestampSeconds: number;
}): Buffer {
  const timestampBytes_var = encodeVarintField_func(1, options_var.expiryTimestampSeconds);
  return Buffer.concat([
    encodeStringField_func(1, options_var.accessToken),
    encodeStringField_func(2, 'Bearer'),
    encodeStringField_func(3, options_var.refreshToken),
    Buffer.concat([
      Buffer.from([...encodeTag_func(4, 2), ...encodeVarint_func(timestampBytes_var.length)]),
      timestampBytes_var,
    ]),
  ]);
}

function createUnifiedOauthTokenBase64_func(options_var: {
  accessToken: string;
  refreshToken: string;
  expiryTimestampSeconds: number;
}): string {
  const oauthInfoBase64_var = createOauthInfoBytes_func(options_var).toString('base64');
  const inner2_var = encodeStringField_func(1, oauthInfoBase64_var);
  const inner_var = Buffer.concat([
    encodeStringField_func(1, 'oauthTokenInfoSentinelKey'),
    Buffer.from([...encodeTag_func(2, 2), ...encodeVarint_func(inner2_var.length)]),
    inner2_var,
  ]);
  const outer_var = Buffer.concat([
    Buffer.from([...encodeTag_func(1, 2), ...encodeVarint_func(inner_var.length)]),
    inner_var,
  ]);
  return outer_var.toString('base64');
}

function readVarint_func(bytes_var: Uint8Array, offset_var: number): { value: number; nextOffset: number } | null {
  let result_var = 0;
  let shift_var = 0;
  let cursor_var = offset_var;
  while (cursor_var < bytes_var.length) {
    const byte_var = bytes_var[cursor_var];
    result_var |= (byte_var & 0x7f) << shift_var;
    cursor_var += 1;
    if ((byte_var & 0x80) === 0) {
      return { value: result_var, nextOffset: cursor_var };
    }
    shift_var += 7;
  }
  return null;
}

function skipField_func(bytes_var: Uint8Array, offset_var: number, wireType_var: number): number | null {
  if (wireType_var === 0) {
    return readVarint_func(bytes_var, offset_var)?.nextOffset ?? null;
  }
  if (wireType_var === 2) {
    const length_var = readVarint_func(bytes_var, offset_var);
    if (!length_var) {
      return null;
    }
    return length_var.nextOffset + length_var.value;
  }
  return null;
}

function removeField_func(bytes_var: Uint8Array, fieldNumber_var: number): Buffer {
  const keptChunks_var: Buffer[] = [];
  let offset_var = 0;
  while (offset_var < bytes_var.length) {
    const fieldStart_var = offset_var;
    const tag_var = readVarint_func(bytes_var, offset_var);
    if (!tag_var) {
      break;
    }
    const currentField_var = tag_var.value >> 3;
    const wireType_var = tag_var.value & 0x7;
    const nextOffset_var = skipField_func(bytes_var, tag_var.nextOffset, wireType_var);
    if (nextOffset_var === null) {
      break;
    }
    if (currentField_var !== fieldNumber_var) {
      keptChunks_var.push(Buffer.from(bytes_var.subarray(fieldStart_var, nextOffset_var)));
    }
    offset_var = nextOffset_var;
  }
  return Buffer.concat(keptChunks_var);
}

async function openSqlJs_func() {
  const module_var = await import('sql.js');
  const initSqlJs_var = (module_var.default ?? module_var) as (opts?: object) => Promise<{
    Database: new (bytes?: Uint8Array) => {
      exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
      run(sql: string, params?: unknown[]): void;
      export(): Uint8Array;
      close(): void;
    };
  }>;
  return await initSqlJs_var({});
}

export async function injectAuthToStateDb_func(options_var: {
  stateDbPath: string;
  accessToken: string;
  refreshToken: string;
  expiryTimestampSeconds: number;
  serviceMachineId?: string;
}): Promise<void> {
  const sql_var = await openSqlJs_func();
  const db_var = new sql_var.Database(new Uint8Array(readFileSync(options_var.stateDbPath)));

  const oauthTokenBase64_var = createUnifiedOauthTokenBase64_func({
    accessToken: options_var.accessToken,
    refreshToken: options_var.refreshToken,
    expiryTimestampSeconds: options_var.expiryTimestampSeconds,
  });

  db_var.run('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)', [
    'antigravityUnifiedStateSync.oauthToken',
    oauthTokenBase64_var,
  ]);

  const agentRows_var = db_var.exec("SELECT value FROM ItemTable WHERE key='jetskiStateSync.agentManagerInitState'");
  if (agentRows_var.length > 0 && agentRows_var[0].values.length > 0) {
    const currentBase64_var = String(agentRows_var[0].values[0][0]);
    const currentBytes_var = Buffer.from(currentBase64_var, 'base64');
    const cleanedBytes_var = removeField_func(currentBytes_var, 6);
    const newField6_var = Buffer.concat([
      Buffer.from([...encodeTag_func(6, 2), ...encodeVarint_func(createOauthInfoBytes_func({
        accessToken: options_var.accessToken,
        refreshToken: options_var.refreshToken,
        expiryTimestampSeconds: options_var.expiryTimestampSeconds,
      }).length)]),
      createOauthInfoBytes_func({
        accessToken: options_var.accessToken,
        refreshToken: options_var.refreshToken,
        expiryTimestampSeconds: options_var.expiryTimestampSeconds,
      }),
    ]);
    db_var.run('UPDATE ItemTable SET value = ? WHERE key = ?', [
      Buffer.concat([cleanedBytes_var, newField6_var]).toString('base64'),
      'jetskiStateSync.agentManagerInitState',
    ]);
  }

  db_var.run('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)', [
    'antigravityOnboarding',
    'true',
  ]);

  if (options_var.serviceMachineId) {
    db_var.run('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)', [
      'storage.serviceMachineId',
      options_var.serviceMachineId,
    ]);
  }

  writeFileSync(options_var.stateDbPath, Buffer.from(db_var.export()));
  db_var.close();
}
