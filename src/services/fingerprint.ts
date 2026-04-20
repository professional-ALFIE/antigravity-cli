import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';

import { Database as BunSqliteDatabase } from 'bun:sqlite';

import type { DeviceProfile } from './accounts.js';

export interface Fingerprint {
  id: string;
  name: string;
  profile: DeviceProfile;
  created_at: number;
}

export interface FingerprintStore {
  original_baseline: Fingerprint | null;
  current_fingerprint_id: string | null;
  fingerprints: Fingerprint[];
}

export interface FingerprintEnvironmentPaths {
  storagePath: string;
  machineIdPath: string;
  stateDbPath: string;
}

const DEFAULT_FINGERPRINT_STORE_FILE_var = 'fingerprints.json';
const DEFAULT_BASELINE_FINGERPRINT_ID_var = 'original';
const DEFAULT_BASELINE_FINGERPRINT_NAME_var = 'Original Device Fingerprint';
const UUID_PATTERN_var = /^(?i:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

function ensureDir_func(dirPath_var: string): void {
  mkdirSync(dirPath_var, { recursive: true });
}

function writeJsonAtomic0600_func(filePath_var: string, value_var: unknown): void {
  ensureDir_func(path.dirname(filePath_var));
  const tempPath_var = `${filePath_var}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath_var, `${JSON.stringify(value_var, null, 2)}\n`, 'utf8');
  chmodSync(tempPath_var, 0o600);
  renameSync(tempPath_var, filePath_var);
  chmodSync(filePath_var, 0o600);
}

function createEmptyFingerprintStore_func(): FingerprintStore {
  return {
    original_baseline: null,
    current_fingerprint_id: null,
    fingerprints: [],
  };
}

function resolveFingerprintStorePath_func(cliDir_var: string): string {
  return path.join(cliDir_var, DEFAULT_FINGERPRINT_STORE_FILE_var);
}

function normalizeDeviceProfile_func(profile_var: unknown): DeviceProfile | null {
  if (!profile_var || typeof profile_var !== 'object') {
    return null;
  }

  const parsedProfile_var = profile_var as Partial<DeviceProfile>;
  if (
    typeof parsedProfile_var.machine_id !== 'string'
    || typeof parsedProfile_var.mac_machine_id !== 'string'
    || typeof parsedProfile_var.dev_device_id !== 'string'
    || typeof parsedProfile_var.sqm_id !== 'string'
    || typeof parsedProfile_var.service_machine_id !== 'string'
  ) {
    return null;
  }

  return {
    machine_id: parsedProfile_var.machine_id,
    mac_machine_id: parsedProfile_var.mac_machine_id,
    dev_device_id: parsedProfile_var.dev_device_id,
    sqm_id: parsedProfile_var.sqm_id,
    service_machine_id: parsedProfile_var.service_machine_id,
  };
}

function normalizeFingerprint_func(fingerprint_var: unknown): Fingerprint | null {
  if (!fingerprint_var || typeof fingerprint_var !== 'object') {
    return null;
  }

  const parsedFingerprint_var = fingerprint_var as Partial<Fingerprint>;
  const profile_var = normalizeDeviceProfile_func(parsedFingerprint_var.profile);
  if (
    typeof parsedFingerprint_var.id !== 'string'
    || typeof parsedFingerprint_var.name !== 'string'
    || typeof parsedFingerprint_var.created_at !== 'number'
    || !profile_var
  ) {
    return null;
  }

  return {
    id: parsedFingerprint_var.id,
    name: parsedFingerprint_var.name,
    profile: profile_var,
    created_at: parsedFingerprint_var.created_at,
  };
}

function normalizeFingerprintStore_func(store_var: unknown): FingerprintStore {
  if (!store_var || typeof store_var !== 'object') {
    return createEmptyFingerprintStore_func();
  }

  const parsedStore_var = store_var as Partial<FingerprintStore>;
  return {
    original_baseline: normalizeFingerprint_func(parsedStore_var.original_baseline),
    current_fingerprint_id: typeof parsedStore_var.current_fingerprint_id === 'string'
      ? parsedStore_var.current_fingerprint_id
      : null,
    fingerprints: Array.isArray(parsedStore_var.fingerprints)
      ? parsedStore_var.fingerprints
        .map((fingerprint_var) => normalizeFingerprint_func(fingerprint_var))
        .filter((fingerprint_var): fingerprint_var is Fingerprint => fingerprint_var !== null)
      : [],
  };
}

function isValidUuid_func(value_var: string): boolean {
  return UUID_PATTERN_var.test(value_var.trim());
}

function randomHex_func(length_var: number): string {
  return randomBytes(Math.ceil(length_var / 2)).toString('hex').slice(0, length_var);
}

function resolveServiceMachineId_func(options_var: {
  machineIdPath: string;
  stateDbPath: string;
}): string {
  if (existsSync(options_var.stateDbPath)) {
    try {
      const db_var = new BunSqliteDatabase(options_var.stateDbPath, { readonly: true });
      const row_var = db_var
        .query("SELECT value FROM ItemTable WHERE key = 'storage.serviceMachineId' LIMIT 1")
        .get() as { value?: string } | null;
      db_var.close();
      if (typeof row_var?.value === 'string' && isValidUuid_func(row_var.value)) {
        return row_var.value;
      }
    } catch {
      // ignore read fallback
    }
  }

  if (existsSync(options_var.machineIdPath)) {
    try {
      const machineIdText_var = readFileSync(options_var.machineIdPath, 'utf8').trim();
      if (isValidUuid_func(machineIdText_var)) {
        return machineIdText_var;
      }
    } catch {
      // ignore read fallback
    }
  }

  return randomUUID();
}

export function resolveFingerprintEnvironmentPaths_func(userDataDirPath_var: string): FingerprintEnvironmentPaths {
  return {
    storagePath: path.join(userDataDirPath_var, 'User', 'globalStorage', 'storage.json'),
    machineIdPath: path.join(userDataDirPath_var, 'machineid'),
    stateDbPath: path.join(userDataDirPath_var, 'User', 'globalStorage', 'state.vscdb'),
  };
}

export function generateDeviceProfile_func(): DeviceProfile {
  return {
    machine_id: `auth0|user_${randomHex_func(32)}`,
    mac_machine_id: randomUUID(),
    dev_device_id: randomUUID(),
    sqm_id: `{${randomUUID().toUpperCase()}}`,
    service_machine_id: randomUUID(),
  };
}

export function loadFingerprintStore_func(options_var: {
  cliDir: string;
}): FingerprintStore {
  const storePath_var = resolveFingerprintStorePath_func(options_var.cliDir);
  if (!existsSync(storePath_var)) {
    return createEmptyFingerprintStore_func();
  }

  try {
    return normalizeFingerprintStore_func(JSON.parse(readFileSync(storePath_var, 'utf8')));
  } catch {
    return createEmptyFingerprintStore_func();
  }
}

export function saveFingerprintStore_func(options_var: {
  cliDir: string;
  store: FingerprintStore;
}): void {
  writeJsonAtomic0600_func(resolveFingerprintStorePath_func(options_var.cliDir), options_var.store);
}

export function createFingerprintRecord_func(options_var: {
  cliDir: string;
  name: string;
  profile: DeviceProfile;
  createdAt?: number;
}): Fingerprint {
  const store_var = loadFingerprintStore_func({ cliDir: options_var.cliDir });
  const fingerprint_var: Fingerprint = {
    id: randomUUID(),
    name: options_var.name.trim(),
    profile: options_var.profile,
    created_at: options_var.createdAt ?? Math.floor(Date.now() / 1000),
  };

  store_var.fingerprints.push(fingerprint_var);
  saveFingerprintStore_func({
    cliDir: options_var.cliDir,
    store: store_var,
  });
  return fingerprint_var;
}

export function setCurrentFingerprintId_func(options_var: {
  cliDir: string;
  fingerprintId: string;
}): void {
  const store_var = loadFingerprintStore_func({ cliDir: options_var.cliDir });
  store_var.current_fingerprint_id = options_var.fingerprintId;
  saveFingerprintStore_func({
    cliDir: options_var.cliDir,
    store: store_var,
  });
}

export function readCurrentDeviceProfile_func(options_var: FingerprintEnvironmentPaths): DeviceProfile {
  const rawStorageJson_var = readFileSync(options_var.storagePath, 'utf8');
  const parsedStorageJson_var = JSON.parse(rawStorageJson_var) as Record<string, unknown>;
  const telemetry_var = parsedStorageJson_var.telemetry as Record<string, unknown> | undefined;

  const readTelemetryField_func = (fieldName_var: string): string => {
    const nestedValue_var = telemetry_var?.[fieldName_var];
    if (typeof nestedValue_var === 'string' && nestedValue_var.length > 0) {
      return nestedValue_var;
    }

    const flatValue_var = parsedStorageJson_var[`telemetry.${fieldName_var}`];
    if (typeof flatValue_var === 'string' && flatValue_var.length > 0) {
      return flatValue_var;
    }

    throw new Error(`Missing telemetry.${fieldName_var}`);
  };

  return {
    machine_id: readTelemetryField_func('machineId'),
    mac_machine_id: readTelemetryField_func('macMachineId'),
    dev_device_id: readTelemetryField_func('devDeviceId'),
    sqm_id: readTelemetryField_func('sqmId'),
    service_machine_id: resolveServiceMachineId_func({
      machineIdPath: options_var.machineIdPath,
      stateDbPath: options_var.stateDbPath,
    }),
  };
}

export function captureOriginalBaseline_func(options_var: {
  cliDir: string;
  paths: FingerprintEnvironmentPaths;
  nowSeconds?: number;
}): FingerprintStore {
  const store_var = loadFingerprintStore_func({ cliDir: options_var.cliDir });
  if (store_var.original_baseline) {
    return store_var;
  }

  if (!existsSync(options_var.paths.storagePath)) {
    saveFingerprintStore_func({
      cliDir: options_var.cliDir,
      store: store_var,
    });
    return store_var;
  }

  const profile_var = readCurrentDeviceProfile_func(options_var.paths);
  store_var.original_baseline = {
    id: DEFAULT_BASELINE_FINGERPRINT_ID_var,
    name: DEFAULT_BASELINE_FINGERPRINT_NAME_var,
    profile: profile_var,
    created_at: options_var.nowSeconds ?? Math.floor(Date.now() / 1000),
  };
  if (!store_var.current_fingerprint_id) {
    store_var.current_fingerprint_id = DEFAULT_BASELINE_FINGERPRINT_ID_var;
  }
  saveFingerprintStore_func({
    cliDir: options_var.cliDir,
    store: store_var,
  });
  return store_var;
}

export function applyDeviceProfile_func(options_var: {
  cliDir?: string;
  fingerprintId?: string | null;
  profile: DeviceProfile;
  paths: FingerprintEnvironmentPaths;
}): void {
  const rawStorageJson_var = existsSync(options_var.paths.storagePath)
    ? readFileSync(options_var.paths.storagePath, 'utf8')
    : '{}';
  const parsedStorageJson_var = JSON.parse(rawStorageJson_var) as Record<string, unknown>;
  if (typeof parsedStorageJson_var.telemetry !== 'object' || parsedStorageJson_var.telemetry === null || Array.isArray(parsedStorageJson_var.telemetry)) {
    parsedStorageJson_var.telemetry = {};
  }

  const telemetry_var = parsedStorageJson_var.telemetry as Record<string, unknown>;
  telemetry_var.machineId = options_var.profile.machine_id;
  telemetry_var.macMachineId = options_var.profile.mac_machine_id;
  telemetry_var.devDeviceId = options_var.profile.dev_device_id;
  telemetry_var.sqmId = options_var.profile.sqm_id;

  parsedStorageJson_var['telemetry.machineId'] = options_var.profile.machine_id;
  parsedStorageJson_var['telemetry.macMachineId'] = options_var.profile.mac_machine_id;
  parsedStorageJson_var['telemetry.devDeviceId'] = options_var.profile.dev_device_id;
  parsedStorageJson_var['telemetry.sqmId'] = options_var.profile.sqm_id;

  ensureDir_func(path.dirname(options_var.paths.storagePath));
  writeFileSync(options_var.paths.storagePath, `${JSON.stringify(parsedStorageJson_var, null, 2)}\n`, 'utf8');

  ensureDir_func(path.dirname(options_var.paths.machineIdPath));
  writeFileSync(options_var.paths.machineIdPath, `${options_var.profile.service_machine_id}\n`, 'utf8');

  ensureDir_func(path.dirname(options_var.paths.stateDbPath));
  const db_var = new BunSqliteDatabase(options_var.paths.stateDbPath);
  db_var.exec("CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value TEXT)");
  db_var.query("INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('storage.serviceMachineId', ?1)")
    .run(options_var.profile.service_machine_id);
  db_var.close();

  if (options_var.cliDir && options_var.fingerprintId) {
    setCurrentFingerprintId_func({
      cliDir: options_var.cliDir,
      fingerprintId: options_var.fingerprintId,
    });
  }
}
