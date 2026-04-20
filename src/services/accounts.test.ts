import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  discoverAccounts_func,
  getActiveAccountName_func,
  getAccount_func,
  getCurrentAccountId_func,
  getDefaultCliDir_func,
  getDefaultDataDir_func,
  getNextManagedAccountName_func,
  getStateDbPath_func,
  listAccounts_func,
  setActiveAccountName_func,
  setCurrentAccountId_func,
  upsertAccount_func,
} from './accounts.js';

let testRoot_var: string;

beforeEach(() => {
  testRoot_var = mkdtempSync(path.join(tmpdir(), 'ag-accounts-'));
});

afterEach(() => {
  rmSync(testRoot_var, { recursive: true, force: true });
});

function setupPaths_func(): {
  cliDir: string;
  defaultDataDir: string;
} {
  const cliDir_var = path.join(testRoot_var, 'cli');
  const defaultDataDir_var = path.join(testRoot_var, 'default-data-dir');
  mkdirSync(cliDir_var, { recursive: true });
  mkdirSync(path.join(defaultDataDir_var, 'User', 'globalStorage'), { recursive: true });
  return {
    cliDir: cliDir_var,
    defaultDataDir: defaultDataDir_var,
  };
}

function createLegacyManagedAccount_func(cliDir_var: string, accountName_var: string): void {
  mkdirSync(path.join(cliDir_var, 'user-data', accountName_var, 'User', 'globalStorage'), { recursive: true });
  writeFileSync(
    path.join(cliDir_var, 'user-data', accountName_var, 'User', 'globalStorage', 'state.vscdb'),
    '',
  );
}

function makeTokenInput_func(overrides_var: Partial<{
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
  expiry_timestamp: number;
  token_type: string;
  project_id: string | null;
}> = {}) {
  const hasRefreshTokenOverride_var = Object.prototype.hasOwnProperty.call(overrides_var, 'refresh_token');
  return {
    access_token: overrides_var.access_token ?? 'ya29.test-access-token',
    refresh_token: hasRefreshTokenOverride_var ? overrides_var.refresh_token ?? null : 'refresh-token',
    expires_in: overrides_var.expires_in ?? 3600,
    expiry_timestamp: overrides_var.expiry_timestamp ?? 1_712_345_678,
    token_type: overrides_var.token_type ?? 'Bearer',
    project_id: overrides_var.project_id ?? null,
  };
}

function readJsonFile_func(filePath_var: string): unknown {
  return JSON.parse(readFileSync(filePath_var, 'utf8'));
}

function writeStoreAccountFixture_func(options_var: {
  cliDir: string;
  accountId: string;
  detail: Record<string, unknown>;
  createdAt?: number;
  lastUsed?: number;
}): void {
  const createdAt_var = options_var.createdAt ?? 1_712_345_678;
  const lastUsed_var = options_var.lastUsed ?? createdAt_var;

  mkdirSync(path.join(options_var.cliDir, 'accounts'), { recursive: true });
  writeFileSync(
    path.join(options_var.cliDir, 'accounts.json'),
    `${JSON.stringify({
      version: '1.0',
      current_account_id: options_var.accountId,
      accounts: [{
        id: options_var.accountId,
        email: options_var.detail.email,
        name: options_var.detail.name,
        created_at: createdAt_var,
        last_used: lastUsed_var,
      }],
    }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(options_var.cliDir, 'accounts', `${options_var.accountId}.json`),
    `${JSON.stringify(options_var.detail, null, 2)}\n`,
  );
}

describe('legacy compatibility helpers', () => {
  test('getDefaultCliDir_func returns ~/.antigravity-cli suffix', () => {
    expect(getDefaultCliDir_func()).toEndWith(path.join('.antigravity-cli'));
  });

  test('getDefaultDataDir_func returns Antigravity app support suffix', () => {
    expect(getDefaultDataDir_func()).toEndWith(path.join('Library', 'Application Support', 'Antigravity'));
  });

  test('getStateDbPath_func returns state.vscdb under User/globalStorage', () => {
    expect(getStateDbPath_func({ userDataDirPath: '/tmp/example' })).toBe('/tmp/example/User/globalStorage/state.vscdb');
  });

  test('getNextManagedAccountName_func keeps legacy hole-fill behavior', () => {
    const next_var = getNextManagedAccountName_func([
      { name: 'default', userDataDirPath: '/default' },
      { name: 'user-01', userDataDirPath: '/u1' },
      { name: 'user-03', userDataDirPath: '/u3' },
    ]);
    expect(next_var).toBe('user-02');
  });

  test('discoverAccounts_func falls back to legacy user-data/user-* when store is absent', async () => {
    const { cliDir: cliDir_var, defaultDataDir: defaultDataDir_var } = setupPaths_func();
    createLegacyManagedAccount_func(cliDir_var, 'user-02');
    createLegacyManagedAccount_func(cliDir_var, 'user-01');

    const accounts_var = await discoverAccounts_func({ cliDir: cliDir_var, defaultDataDir: defaultDataDir_var });

    expect(accounts_var.map((account_var) => account_var.name)).toEqual(['default', 'user-01', 'user-02']);
  });

  test('getActiveAccountName_func and setActiveAccountName_func preserve legacy auth.json fallback', async () => {
    const { cliDir: cliDir_var } = setupPaths_func();

    expect(await getActiveAccountName_func({ cliDir: cliDir_var })).toBe('default');

    await setActiveAccountName_func({ cliDir: cliDir_var, accountName: 'user-02' });

    expect(await getActiveAccountName_func({ cliDir: cliDir_var })).toBe('user-02');
  });
});

describe('Account Store', () => {
  test('upsertAccount_func creates accounts.json and account detail file', async () => {
    const { cliDir: cliDir_var } = setupPaths_func();

    const result_var = await upsertAccount_func({
      cliDir: cliDir_var,
      email: 'user@example.com',
      name: 'User Example',
      token: makeTokenInput_func(),
    });

    const indexPath_var = path.join(cliDir_var, 'accounts.json');
    const detailPath_var = path.join(cliDir_var, 'accounts', `${result_var.account.id}.json`);

    expect(result_var.created).toBe(true);
    expect(existsSync(indexPath_var)).toBe(true);
    expect(existsSync(detailPath_var)).toBe(true);

    const indexJson_var = readJsonFile_func(indexPath_var) as {
      version: string;
      current_account_id: string | null;
      accounts: Array<{ id: string; email: string; name: string }>;
    };
    const detailJson_var = readJsonFile_func(detailPath_var) as {
      email: string;
      account_status: string;
      token: { refresh_token: string | null };
      fingerprint_id: string;
      quota_cache: { pre_turn_snapshot: null };
      device_profile: null;
    };

    expect(indexJson_var.version).toBe('1.0');
    expect(indexJson_var.current_account_id).toBeNull();
    expect(indexJson_var.accounts).toHaveLength(1);
    expect(indexJson_var.accounts[0].email).toBe('user@example.com');

    expect(detailJson_var.email).toBe('user@example.com');
    expect(detailJson_var.account_status).toBe('active');
    expect(detailJson_var.token.refresh_token).toBe('refresh-token');
    expect(detailJson_var.fingerprint_id).toBe('original');
    expect(detailJson_var.quota_cache.pre_turn_snapshot).toBeNull();
    expect(detailJson_var.device_profile).toBeNull();
  });

  test('upsertAccount_func updates existing account by case-insensitive email without duplication', async () => {
    const { cliDir: cliDir_var } = setupPaths_func();

    const first_var = await upsertAccount_func({
      cliDir: cliDir_var,
      email: 'USER@example.com',
      name: 'First Name',
      token: makeTokenInput_func({ refresh_token: 'refresh-1' }),
    });
    const second_var = await upsertAccount_func({
      cliDir: cliDir_var,
      email: 'user@example.com',
      name: 'Second Name',
      token: makeTokenInput_func({ refresh_token: 'refresh-2' }),
    });

    const accounts_var = await listAccounts_func({ cliDir: cliDir_var });
    const detail_var = await getAccount_func({ cliDir: cliDir_var, accountId: first_var.account.id });

    expect(second_var.created).toBe(false);
    expect(second_var.account.id).toBe(first_var.account.id);
    expect(accounts_var).toHaveLength(1);
    expect(detail_var?.name).toBe('Second Name');
    expect(detail_var?.token.refresh_token).toBe('refresh-2');
  });

  test('upsertAccount_func defaults account_status to needs_reauth when refresh_token is missing', async () => {
    const { cliDir: cliDir_var } = setupPaths_func();

    const result_var = await upsertAccount_func({
      cliDir: cliDir_var,
      email: 'reauth@example.com',
      name: 'Needs Reauth',
      token: makeTokenInput_func({ refresh_token: null }),
    });

    expect(result_var.account.account_status).toBe('needs_reauth');
    expect(result_var.account.token.refresh_token).toBeNull();
  });

  test('setCurrentAccountId_func and getCurrentAccountId_func persist current_account_id', async () => {
    const { cliDir: cliDir_var } = setupPaths_func();

    const result_var = await upsertAccount_func({
      cliDir: cliDir_var,
      email: 'active@example.com',
      name: 'Active User',
      token: makeTokenInput_func(),
    });

    await setCurrentAccountId_func({ cliDir: cliDir_var, accountId: result_var.account.id });

    expect(await getCurrentAccountId_func({ cliDir: cliDir_var })).toBe(result_var.account.id);
    expect(await getActiveAccountName_func({ cliDir: cliDir_var })).toBe(result_var.account.id);
  });

  test('discoverAccounts_func returns store-backed accounts when accounts.json exists', async () => {
    const { cliDir: cliDir_var, defaultDataDir: defaultDataDir_var } = setupPaths_func();

    const first_var = await upsertAccount_func({
      cliDir: cliDir_var,
      email: 'first@example.com',
      name: 'First User',
      token: makeTokenInput_func(),
    });
    const second_var = await upsertAccount_func({
      cliDir: cliDir_var,
      email: 'second@example.com',
      name: 'Second User',
      token: makeTokenInput_func(),
    });

    const accounts_var = await discoverAccounts_func({ cliDir: cliDir_var, defaultDataDir: defaultDataDir_var });

    expect(accounts_var.map((account_var) => account_var.name)).toEqual([first_var.account.id, second_var.account.id]);
    expect(accounts_var.every((account_var) => account_var.userDataDirPath === defaultDataDir_var)).toBe(true);
  });

  test('getAccount_func normalizes legacy detail missing pre_turn_snapshot and device_profile', async () => {
    const { cliDir: cliDir_var } = setupPaths_func();
    const token_var = makeTokenInput_func();
    writeStoreAccountFixture_func({
      cliDir: cliDir_var,
      accountId: 'legacy-account',
      detail: {
        id: 'legacy-account',
        email: 'legacy@example.com',
        name: 'Legacy User',
        account_status: 'active',
        account_status_reason: null,
        account_status_changed_at: null,
        token: token_var,
        fingerprint_id: 'original',
        quota_cache: {
          subscription_tier: 'pro',
          families: {},
          fetch_error: null,
          cached_at: null,
        },
        rotation: {
          family_buckets: {
            GEMINI: null,
            CLAUDE: null,
            _min: null,
          },
          last_rotated_at: null,
        },
        wakeup_history: {
          last_attempt_at: null,
          last_result: null,
          attempt_count: 0,
        },
        created_at: 1_712_345_678,
        last_used: 1_712_345_678,
      },
    });

    const detail_var = await getAccount_func({ cliDir: cliDir_var, accountId: 'legacy-account' });

    expect(detail_var?.quota_cache.pre_turn_snapshot).toBeNull();
    expect(detail_var?.device_profile).toBeNull();
  });

  test('upsertAccount_func preserves backward compatibility when existing detail misses new schema fields', async () => {
    const { cliDir: cliDir_var } = setupPaths_func();
    const token_var = makeTokenInput_func();
    writeStoreAccountFixture_func({
      cliDir: cliDir_var,
      accountId: 'legacy-account',
      detail: {
        id: 'legacy-account',
        email: 'legacy@example.com',
        name: 'Legacy User',
        account_status: 'active',
        account_status_reason: null,
        account_status_changed_at: null,
        token: token_var,
        fingerprint_id: 'original',
        quota_cache: {
          subscription_tier: 'pro',
          families: {},
          fetch_error: null,
          cached_at: null,
        },
        rotation: {
          family_buckets: {
            GEMINI: null,
            CLAUDE: null,
            _min: null,
          },
          last_rotated_at: null,
        },
        wakeup_history: {
          last_attempt_at: null,
          last_result: null,
          attempt_count: 0,
        },
        created_at: 1_712_345_678,
        last_used: 1_712_345_678,
      },
    });

    const result_var = await upsertAccount_func({
      cliDir: cliDir_var,
      email: 'legacy@example.com',
      name: 'Legacy User Updated',
      token: makeTokenInput_func({ refresh_token: 'refresh-updated' }),
    });

    expect(result_var.created).toBe(false);
    expect(result_var.account.quota_cache.pre_turn_snapshot).toBeNull();
    expect(result_var.account.device_profile).toBeNull();
  });

  test('discoverAccounts_func uses managed user-data path for store-backed user-* accounts', async () => {
    const { cliDir: cliDir_var, defaultDataDir: defaultDataDir_var } = setupPaths_func();
    createLegacyManagedAccount_func(cliDir_var, 'user-02');
    writeStoreAccountFixture_func({
      cliDir: cliDir_var,
      accountId: 'user-02',
      detail: {
        id: 'user-02',
        email: 'managed@example.com',
        name: 'Managed User',
        account_status: 'active',
        account_status_reason: null,
        account_status_changed_at: null,
        token: makeTokenInput_func(),
        fingerprint_id: 'original',
        quota_cache: {
          subscription_tier: null,
          families: {},
          fetch_error: null,
          cached_at: null,
        },
        rotation: {
          family_buckets: {
            GEMINI: null,
            CLAUDE: null,
            _min: null,
          },
          last_rotated_at: null,
        },
        wakeup_history: {
          last_attempt_at: null,
          last_result: null,
          attempt_count: 0,
        },
        created_at: 1_712_345_678,
        last_used: 1_712_345_678,
      },
    });

    const accounts_var = await discoverAccounts_func({ cliDir: cliDir_var, defaultDataDir: defaultDataDir_var });

    expect(accounts_var).toEqual([{
      name: 'user-02',
      userDataDirPath: path.join(cliDir_var, 'user-data', 'user-02'),
    }]);
  });

  test('listAccounts_func ignores missing detail file instead of crashing', async () => {
    const { cliDir: cliDir_var } = setupPaths_func();

    const result_var = await upsertAccount_func({
      cliDir: cliDir_var,
      email: 'missing-detail@example.com',
      name: 'Missing Detail',
      token: makeTokenInput_func(),
    });

    rmSync(path.join(cliDir_var, 'accounts', `${result_var.account.id}.json`), { force: true });

    const accounts_var = await listAccounts_func({ cliDir: cliDir_var });
    expect(accounts_var).toEqual([]);
  });

  test('corrupted accounts.json is backed up and treated as empty store', async () => {
    const { cliDir: cliDir_var, defaultDataDir: defaultDataDir_var } = setupPaths_func();

    writeFileSync(path.join(cliDir_var, 'accounts.json'), '{broken-json');

    const accounts_var = await listAccounts_func({ cliDir: cliDir_var });
    const discovered_var = await discoverAccounts_func({ cliDir: cliDir_var, defaultDataDir: defaultDataDir_var });
    const entries_var = readdirSync(cliDir_var);

    expect(accounts_var).toEqual([]);
    expect(discovered_var).toEqual([{ name: 'default', userDataDirPath: defaultDataDir_var }]);
    expect(entries_var.some((entry_var) => entry_var.startsWith('accounts.json.corrupt-') && entry_var.endsWith('.bak'))).toBe(true);
  });

  test('Account Store files are written with 0600 permissions on darwin', async () => {
    const { cliDir: cliDir_var } = setupPaths_func();

    const result_var = await upsertAccount_func({
      cliDir: cliDir_var,
      email: 'chmod@example.com',
      name: 'Chmod User',
      token: makeTokenInput_func(),
    });
    await setCurrentAccountId_func({ cliDir: cliDir_var, accountId: result_var.account.id });

    const indexMode_var = statSync(path.join(cliDir_var, 'accounts.json')).mode & 0o777;
    const detailMode_var = statSync(path.join(cliDir_var, 'accounts', `${result_var.account.id}.json`)).mode & 0o777;

    expect(indexMode_var).toBe(0o600);
    expect(detailMode_var).toBe(0o600);
  });
});
