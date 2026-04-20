import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  applyDeviceProfile_func,
  captureOriginalBaseline_func,
  createFingerprintRecord_func,
  generateDeviceProfile_func,
  loadFingerprintStore_func,
  resolveFingerprintEnvironmentPaths_func,
} from './fingerprint.js';

let testRoot_var: string;

beforeEach(() => {
  testRoot_var = mkdtempSync(path.join(tmpdir(), 'ag-fingerprint-'));
});

afterEach(() => {
  rmSync(testRoot_var, { recursive: true, force: true });
});

async function createStateDb_func(dbPath_var: string): Promise<void> {
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
  writeFileSync(dbPath_var, Buffer.from(db_var.export()));
  db_var.close();
}

describe('generateDeviceProfile_func', () => {
  test('generates Cockpit-compatible 5-field profile shapes', () => {
    const profile_var = generateDeviceProfile_func();

    expect(profile_var.machine_id).toMatch(/^auth0\|user_[0-9a-f]{32}$/);
    expect(profile_var.mac_machine_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(profile_var.dev_device_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(profile_var.sqm_id).toMatch(/^\{[0-9A-F-]{36}\}$/);
    expect(profile_var.service_machine_id).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe('applyDeviceProfile_func', () => {
  test('writes nested + flat telemetry keys, machineid, and state.vscdb serviceMachineId', async () => {
    const cliDir_var = path.join(testRoot_var, 'cli');
    const userDataDir_var = path.join(testRoot_var, 'default-data');
    const paths_var = resolveFingerprintEnvironmentPaths_func(userDataDir_var);
    mkdirSync(path.dirname(paths_var.storagePath), { recursive: true });

    writeFileSync(paths_var.storagePath, `${JSON.stringify({
      telemetry: {
        machineId: 'old-machine',
      },
    }, null, 2)}\n`);
    await createStateDb_func(paths_var.stateDbPath);

    const fingerprint_var = createFingerprintRecord_func({
      cliDir: cliDir_var,
      name: 'Managed Account Fingerprint',
      profile: {
        machine_id: 'auth0|user_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        mac_machine_id: '11111111-2222-4333-8444-555555555555',
        dev_device_id: '66666666-7777-4888-9999-aaaaaaaaaaaa',
        sqm_id: '{BBBBBBBB-CCCC-4DDD-8EEE-FFFFFFFFFFFF}',
        service_machine_id: '12345678-1234-4234-9234-123456789abc',
      },
      createdAt: 1_700_000_000,
    });

    applyDeviceProfile_func({
      cliDir: cliDir_var,
      fingerprintId: fingerprint_var.id,
      profile: fingerprint_var.profile,
      paths: paths_var,
    });

    const storageJson_var = JSON.parse(readFileSync(paths_var.storagePath, 'utf8')) as Record<string, unknown>;
    expect((storageJson_var.telemetry as Record<string, unknown>).machineId).toBe(fingerprint_var.profile.machine_id);
    expect(storageJson_var['telemetry.machineId']).toBe(fingerprint_var.profile.machine_id);
    expect((storageJson_var.telemetry as Record<string, unknown>).sqmId).toBe(fingerprint_var.profile.sqm_id);
    expect(readFileSync(paths_var.machineIdPath, 'utf8').trim()).toBe(fingerprint_var.profile.service_machine_id);

    const module_var = await import('sql.js');
    const initSqlJs_var = (module_var.default ?? module_var) as (opts?: object) => Promise<{
      Database: new (bytes: Uint8Array) => {
        exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
        close(): void;
      };
    }>;
    const sql_var = await initSqlJs_var({});
    const db_var = new sql_var.Database(new Uint8Array(readFileSync(paths_var.stateDbPath)));
    const rows_var = db_var.exec("SELECT value FROM ItemTable WHERE key='storage.serviceMachineId'");
    expect(rows_var[0].values[0][0]).toBe(fingerprint_var.profile.service_machine_id);
    db_var.close();

    const store_var = loadFingerprintStore_func({ cliDir: cliDir_var });
    expect(store_var.current_fingerprint_id).toBe(fingerprint_var.id);
  });
});

describe('captureOriginalBaseline_func', () => {
  test('captures current storage profile as original baseline and persists fingerprints.json as 0600', async () => {
    const cliDir_var = path.join(testRoot_var, 'cli');
    const userDataDir_var = path.join(testRoot_var, 'default-data');
    const paths_var = resolveFingerprintEnvironmentPaths_func(userDataDir_var);
    mkdirSync(path.dirname(paths_var.storagePath), { recursive: true });
    mkdirSync(path.dirname(paths_var.machineIdPath), { recursive: true });

    writeFileSync(paths_var.storagePath, `${JSON.stringify({
      telemetry: {
        machineId: 'auth0|user_deadbeefdeadbeefdeadbeefdeadbeef',
        macMachineId: '11111111-2222-4333-8444-555555555555',
        devDeviceId: '66666666-7777-4888-9999-aaaaaaaaaaaa',
        sqmId: '{BBBBBBBB-CCCC-4DDD-8EEE-FFFFFFFFFFFF}',
      },
    }, null, 2)}\n`);
    writeFileSync(paths_var.machineIdPath, '12345678-1234-4234-9234-123456789abc\n');
    await createStateDb_func(paths_var.stateDbPath);

    const store_var = captureOriginalBaseline_func({
      cliDir: cliDir_var,
      paths: paths_var,
      nowSeconds: 1_700_000_000,
    });

    expect(store_var.original_baseline?.id).toBe('original');
    expect(store_var.original_baseline?.profile.machine_id).toBe('auth0|user_deadbeefdeadbeefdeadbeefdeadbeef');
    expect(store_var.original_baseline?.profile.service_machine_id).toBe('12345678-1234-4234-9234-123456789abc');
    expect(store_var.current_fingerprint_id).toBe('original');

    const storePath_var = path.join(cliDir_var, 'fingerprints.json');
    const mode_var = statSync(storePath_var).mode & 0o777;
    expect(mode_var).toBe(0o600);
  });
});
