import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { injectAuthToStateDb_func } from './authInject.js';

let testRoot_var: string;

beforeEach(() => {
  testRoot_var = mkdtempSync(path.join(tmpdir(), 'ag-auth-inject-'));
});

afterEach(() => {
  rmSync(testRoot_var, { recursive: true, force: true });
});

async function createMinimalStateDb_func(dbPath_var: string): Promise<void> {
  const module_var = await import('sql.js');
  const initSqlJs_var = (module_var.default ?? module_var) as (opts?: object) => Promise<{
    Database: new () => {
      run(sql: string, params?: unknown[]): void;
      export(): Uint8Array;
      close(): void;
    };
  }>;

  const sql_var = await initSqlJs_var({});
  const db_var = new sql_var.Database();
  db_var.run('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
  db_var.run('INSERT INTO ItemTable (key, value) VALUES (?, ?)', [
    'jetskiStateSync.agentManagerInitState',
    Buffer.from([0x0a, 0x03, 0x66, 0x6f, 0x6f]).toString('base64'),
  ]);
  writeFileSync(dbPath_var, Buffer.from(db_var.export()));
  db_var.close();
}

describe('injectAuthToStateDb_func', () => {
  test('writes oauthToken, onboarding, and replaces agentManagerInitState field 6', async () => {
    const dbPath_var = path.join(testRoot_var, 'state.vscdb');
    await createMinimalStateDb_func(dbPath_var);

    await injectAuthToStateDb_func({
      stateDbPath: dbPath_var,
      accessToken: 'access-123',
      refreshToken: 'refresh-123',
      expiryTimestampSeconds: 1_712_345_678,
    });

    const module_var = await import('sql.js');
    const initSqlJs_var = (module_var.default ?? module_var) as (opts?: object) => Promise<{
      Database: new (bytes: Uint8Array) => {
        exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
        close(): void;
      };
    }>;
    const sql_var = await initSqlJs_var({});
    const db_var = new sql_var.Database(new Uint8Array(readFileSync(dbPath_var)));

    const oauthRows_var = db_var.exec("SELECT value FROM ItemTable WHERE key='antigravityUnifiedStateSync.oauthToken'");
    const onboardingRows_var = db_var.exec("SELECT value FROM ItemTable WHERE key='antigravityOnboarding'");
    const agentRows_var = db_var.exec("SELECT value FROM ItemTable WHERE key='jetskiStateSync.agentManagerInitState'");

    expect(oauthRows_var[0].values[0][0]).toBeString();
    expect(onboardingRows_var[0].values[0][0]).toBe('true');
    expect(String(agentRows_var[0].values[0][0])).not.toBe(Buffer.from([0x0a, 0x03, 0x66, 0x6f, 0x6f]).toString('base64'));
    db_var.close();
  });

  test('writes storage.serviceMachineId when provided', async () => {
    const dbPath_var = path.join(testRoot_var, 'state.vscdb');
    await createMinimalStateDb_func(dbPath_var);

    await injectAuthToStateDb_func({
      stateDbPath: dbPath_var,
      accessToken: 'access-123',
      refreshToken: 'refresh-123',
      expiryTimestampSeconds: 1_712_345_678,
      serviceMachineId: 'machine-xyz',
    });

    const module_var = await import('sql.js');
    const initSqlJs_var = (module_var.default ?? module_var) as (opts?: object) => Promise<{
      Database: new (bytes: Uint8Array) => {
        exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
        close(): void;
      };
    }>;
    const sql_var = await initSqlJs_var({});
    const db_var = new sql_var.Database(new Uint8Array(readFileSync(dbPath_var)));

    const rows_var = db_var.exec("SELECT value FROM ItemTable WHERE key='storage.serviceMachineId'");
    expect(rows_var[0].values[0][0]).toBe('machine-xyz');
    db_var.close();
  });
});
