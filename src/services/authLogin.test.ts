import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  authLogin_func,
  importLocalFromStateDb_func,
  type OAuthCallbackReceiver,
} from './authLogin.js';
import {
  getAccount_func,
  getActiveAccountName_func,
  getCurrentAccountId_func,
  listAccounts_func,
} from './accounts.js';
import { loadFingerprintStore_func } from './fingerprint.js';

let testRoot_var: string;
let original_client_id_var: string | undefined;
let original_client_secret_var: string | undefined;

beforeEach(() => {
  testRoot_var = mkdtempSync(path.join(tmpdir(), 'ag-auth-login-'));
  original_client_id_var = process.env.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_ID;
  original_client_secret_var = process.env.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_SECRET;
  process.env.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
  process.env.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret';
});

afterEach(() => {
  rmSync(testRoot_var, { recursive: true, force: true });
  if (original_client_id_var == null) {
    delete process.env.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_ID;
  } else {
    process.env.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_ID = original_client_id_var;
  }

  if (original_client_secret_var == null) {
    delete process.env.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_SECRET;
  } else {
    process.env.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_SECRET = original_client_secret_var;
  }
});

function createPaths_func(): { cliDir: string; defaultDataDir: string } {
  const cliDir_var = path.join(testRoot_var, 'cli');
  const defaultDataDir_var = path.join(testRoot_var, 'default');
  mkdirSync(cliDir_var, { recursive: true });
  mkdirSync(path.join(defaultDataDir_var, 'User', 'globalStorage'), { recursive: true });
  return {
    cliDir: cliDir_var,
    defaultDataDir: defaultDataDir_var,
  };
}

function createReceiverStub_func(callbackUrl_var: string): () => Promise<OAuthCallbackReceiver> {
  return async () => ({
    redirectUri: 'http://127.0.0.1:43123/oauth-callback',
    waitForCallbackUrl: async () => callbackUrl_var,
    close: async () => undefined,
  });
}

describe('authLogin_func', () => {
  test('1. browser open 실패 시 open_failed 반환', async () => {
    const { cliDir: cliDir_var, defaultDataDir: defaultDataDir_var } = createPaths_func();

    const result_var = await authLogin_func({
      cliDir: cliDir_var,
      defaultDataDir: defaultDataDir_var,
      createCallbackReceiver: createReceiverStub_func('http://127.0.0.1:43123/oauth-callback?state=fixed-state&code=ok'),
      generateState: () => 'fixed-state',
      openUrl: async () => {
        throw new Error('browser unavailable');
      },
    });

    expect(result_var.status).toBe('open_failed');
    expect('message' in result_var ? result_var.message : '').toContain('browser unavailable');
  });

  test('2. OAuth callback 후 account store에 저장된다', async () => {
    const { cliDir: cliDir_var, defaultDataDir: defaultDataDir_var } = createPaths_func();
    const openedUrls_var: string[] = [];
    writeFileSync(path.join(defaultDataDir_var, 'User', 'globalStorage', 'storage.json'), `${JSON.stringify({
      telemetry: {
        machineId: 'auth0|user_deadbeefdeadbeefdeadbeefdeadbeef',
        macMachineId: '11111111-2222-4333-8444-555555555555',
        devDeviceId: '66666666-7777-4888-9999-aaaaaaaaaaaa',
        sqmId: '{BBBBBBBB-CCCC-4DDD-8EEE-FFFFFFFFFFFF}',
      },
    }, null, 2)}\n`);
    writeFileSync(path.join(defaultDataDir_var, 'machineid'), '12345678-1234-4234-9234-123456789abc\n');

    const result_var = await authLogin_func({
      cliDir: cliDir_var,
      defaultDataDir: defaultDataDir_var,
      createCallbackReceiver: createReceiverStub_func('http://127.0.0.1:43123/oauth-callback?state=fixed-state&code=auth-code-xyz'),
      generateState: () => 'fixed-state',
      openUrl: async (url_var) => {
        openedUrls_var.push(url_var);
      },
      exchangeAuthorizationCode: async () => ({
        access_token: 'access-123',
        refresh_token: 'refresh-123',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
      fetchGoogleUserInfo: async () => ({
        id: 'google-user-1',
        email: 'user@example.com',
        name: 'User Example',
        given_name: 'User',
        family_name: 'Example',
      }),
      importLocalAccounts: async () => ({
        importedCount: 0,
        importedAccounts: [],
      }),
    });

    const currentAccountId_var = await getCurrentAccountId_func({ cliDir: cliDir_var });
    const storedAccount_var = currentAccountId_var
      ? await getAccount_func({ cliDir: cliDir_var, accountId: currentAccountId_var })
      : null;

    expect(openedUrls_var).toHaveLength(1);
    expect(result_var.status).toBe('success');
    expect(result_var.email).toBe('user@example.com');
    expect(currentAccountId_var).toBeTruthy();
    expect(storedAccount_var?.token.refresh_token).toBe('refresh-123');
    expect(storedAccount_var?.device_profile).not.toBeNull();
    expect(storedAccount_var?.fingerprint_id).not.toBe('original');

    const fingerprintStore_var = loadFingerprintStore_func({ cliDir: cliDir_var });
    expect(fingerprintStore_var.original_baseline?.id).toBe('original');
    expect(fingerprintStore_var.fingerprints.some((fingerprint_var) => fingerprint_var.id === storedAccount_var?.fingerprint_id)).toBe(true);
  });

  test('3. 성공 시 active account가 전환된다', async () => {
    const { cliDir: cliDir_var, defaultDataDir: defaultDataDir_var } = createPaths_func();

    const result_var = await authLogin_func({
      cliDir: cliDir_var,
      defaultDataDir: defaultDataDir_var,
      createCallbackReceiver: createReceiverStub_func('http://127.0.0.1:43123/oauth-callback?state=fixed-state&code=auth-code-xyz'),
      generateState: () => 'fixed-state',
      openUrl: async () => undefined,
      exchangeAuthorizationCode: async () => ({
        access_token: 'access-123',
        refresh_token: 'refresh-123',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
      fetchGoogleUserInfo: async () => ({
        id: 'google-user-1',
        email: 'user@example.com',
        name: 'User Example',
        given_name: 'User',
        family_name: 'Example',
      }),
      importLocalAccounts: async () => ({
        importedCount: 0,
        importedAccounts: [],
      }),
    });

    const active_var = await getActiveAccountName_func({ cliDir: cliDir_var });
    expect(result_var.status).toBe('success');
    expect(active_var).toBe(result_var.accountName);
  });

  test('4. callback 미도착 시 timeout 반환', async () => {
    const { cliDir: cliDir_var, defaultDataDir: defaultDataDir_var } = createPaths_func();

    const result_var = await authLogin_func({
      cliDir: cliDir_var,
      defaultDataDir: defaultDataDir_var,
      timeoutMs: 30,
      createCallbackReceiver: async () => ({
        redirectUri: 'http://127.0.0.1:43123/oauth-callback',
        waitForCallbackUrl: async () => new Promise<string>(() => undefined),
        close: async () => undefined,
      }),
      generateState: () => 'fixed-state',
      openUrl: async () => undefined,
    });

    expect(result_var.status).toBe('timeout');
  });

  test('5. abort signal이면 cancelled 반환', async () => {
    const { cliDir: cliDir_var, defaultDataDir: defaultDataDir_var } = createPaths_func();
    const controller_var = new AbortController();

    const promise_var = authLogin_func({
      cliDir: cliDir_var,
      defaultDataDir: defaultDataDir_var,
      timeoutMs: 5000,
      signal: controller_var.signal,
      createCallbackReceiver: async () => ({
        redirectUri: 'http://127.0.0.1:43123/oauth-callback',
        waitForCallbackUrl: async () => new Promise<string>(() => undefined),
        close: async () => undefined,
      }),
      generateState: () => 'fixed-state',
      openUrl: async () => undefined,
    });

    setTimeout(() => controller_var.abort(), 20);
    const result_var = await promise_var;

    expect(result_var.status).toBe('cancelled');
  });

  test('6. legacy user-01이 있으면 다음 accountName은 user-02다', async () => {
    const { cliDir: cliDir_var, defaultDataDir: defaultDataDir_var } = createPaths_func();
    mkdirSync(path.join(cliDir_var, 'user-data', 'user-01', 'User', 'globalStorage'), { recursive: true });
    writeFileSync(path.join(cliDir_var, 'user-data', 'user-01', 'User', 'globalStorage', 'state.vscdb'), '');

    const result_var = await authLogin_func({
      cliDir: cliDir_var,
      defaultDataDir: defaultDataDir_var,
      timeoutMs: 10,
      createCallbackReceiver: async () => ({
        redirectUri: 'http://127.0.0.1:43123/oauth-callback',
        waitForCallbackUrl: async () => new Promise<string>(() => undefined),
        close: async () => undefined,
      }),
      generateState: () => 'fixed-state',
      openUrl: async () => undefined,
    });

    expect(result_var.accountName).toBe('user-02');
  });

  test('7. state mismatch면 error 반환', async () => {
    const { cliDir: cliDir_var, defaultDataDir: defaultDataDir_var } = createPaths_func();

    const result_var = await authLogin_func({
      cliDir: cliDir_var,
      defaultDataDir: defaultDataDir_var,
      createCallbackReceiver: createReceiverStub_func('http://127.0.0.1:43123/oauth-callback?state=wrong-state&code=auth-code-xyz'),
      generateState: () => 'fixed-state',
      openUrl: async () => undefined,
    });

    expect(result_var.status).toBe('error');
    expect('message' in result_var ? result_var.message : '').toContain('Invalid state');
  });
});

describe('importLocalFromStateDb_func', () => {
  test('8. state.vscdb들에서 계정을 불러와 account store에 적재한다', async () => {
    const { cliDir: cliDir_var, defaultDataDir: defaultDataDir_var } = createPaths_func();

    const result_var = await importLocalFromStateDb_func({
      cliDir: cliDir_var,
      defaultDataDir: defaultDataDir_var,
      stateDbPaths: ['/tmp/a/state.vscdb', '/tmp/b/state.vscdb'],
      readStateDbAccount: async (stateDbPath_var) => {
        if (stateDbPath_var.includes('/tmp/a/')) {
          return {
            email: 'first@example.com',
            name: 'First User',
            token: {
              access_token: 'access-1',
              refresh_token: 'refresh-1',
              expires_in: 3600,
              expiry_timestamp: 1_712_345_678,
              token_type: 'Bearer',
              project_id: null,
            },
          };
        }

        return {
          email: 'second@example.com',
          name: 'Second User',
          token: {
            access_token: 'access-2',
            refresh_token: null,
            expires_in: 3600,
            expiry_timestamp: 1_712_345_679,
            token_type: 'Bearer',
            project_id: null,
          },
        };
      },
    });

    const accounts_var = await listAccounts_func({ cliDir: cliDir_var });

    expect(result_var.importedCount).toBe(2);
    expect(accounts_var).toHaveLength(2);
    expect(accounts_var.map((account_var) => account_var.email).sort()).toEqual([
      'first@example.com',
      'second@example.com',
    ]);
    expect(accounts_var.find((account_var) => account_var.email === 'second@example.com')?.account_status).toBe('needs_reauth');
    expect(accounts_var.every((account_var) => account_var.device_profile !== null)).toBe(true);
    expect(accounts_var.every((account_var) => account_var.fingerprint_id !== 'original')).toBe(true);
  });
});
