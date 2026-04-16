import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  fetchQuotaForAccount_func,
  fetchQuotaForAccounts_func,
  readQuotaCache_func,
  writeQuotaCache_func,
  type QuotaFetchAccountInput,
} from './quotaClient.js';

let testRoot_var: string;

beforeEach(() => {
  testRoot_var = mkdtempSync(path.join(tmpdir(), 'ag-quota-'));
});

afterEach(() => {
  rmSync(testRoot_var, { recursive: true, force: true });
});

function makeAccount_func(overrides_var: Partial<QuotaFetchAccountInput> = {}): QuotaFetchAccountInput {
  return {
    id: overrides_var.id ?? 'acc-1',
    email: overrides_var.email ?? 'user@example.com',
    accountStatus: overrides_var.accountStatus ?? 'active',
    token: overrides_var.token ?? {
      access_token: 'access-123',
      refresh_token: 'refresh-123',
      expires_in: 3600,
      expiry_timestamp: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
      project_id: null,
    },
    cacheDir: overrides_var.cacheDir ?? path.join(testRoot_var, 'cache', 'quota'),
  };
}

describe('quotaClient cache', () => {
  test('writes and reads fresh quota cache', async () => {
    const cacheDir_var = path.join(testRoot_var, 'cache', 'quota');
    const nowMs_var = Date.now();

    await writeQuotaCache_func({
      cacheDir: cacheDir_var,
      accountId: 'acc-1',
      value: {
        subscriptionTier: 'PRO',
        projectId: 'projects/demo-1',
        credits: [],
        families: {
          GEMINI: {
            remaining_pct: 45,
            reset_time: '2026-04-16T10:00:00Z',
            models: [
              { model_id: 'gemini-2.5-pro', remaining_fraction: 0.45, reset_time: '2026-04-16T10:00:00Z' },
            ],
          },
        },
        fetchError: null,
        accountStatus: 'active',
        cachedAtMs: nowMs_var,
      },
    });

    const cache_var = await readQuotaCache_func({
      cacheDir: cacheDir_var,
      accountId: 'acc-1',
      nowMs: nowMs_var + 1_000,
    });

    expect(cache_var?.isFresh).toBe(true);
    expect(cache_var?.value.subscriptionTier).toBe('PRO');
    expect(cache_var?.value.families.GEMINI?.remaining_pct).toBe(45);
  });

  test('marks cache stale after 60 seconds', async () => {
    const cacheDir_var = path.join(testRoot_var, 'cache', 'quota');
    const nowMs_var = Date.now();

    await writeQuotaCache_func({
      cacheDir: cacheDir_var,
      accountId: 'acc-1',
      value: {
        subscriptionTier: null,
        projectId: null,
        credits: [],
        families: {},
        fetchError: null,
        accountStatus: 'active',
        cachedAtMs: nowMs_var,
      },
    });

    const cache_var = await readQuotaCache_func({
      cacheDir: cacheDir_var,
      accountId: 'acc-1',
      nowMs: nowMs_var + 61_000,
    });

    expect(cache_var?.isFresh).toBe(false);
  });
});

describe('fetchQuotaForAccount_func', () => {
  test('uses fresh cache without network calls', async () => {
    const account_var = makeAccount_func();
    const nowMs_var = Date.now();

    await writeQuotaCache_func({
      cacheDir: account_var.cacheDir,
      accountId: account_var.id,
      value: {
        subscriptionTier: 'PRO',
        projectId: 'projects/demo-1',
        credits: [],
        families: {
          GEMINI: {
            remaining_pct: 70,
            reset_time: '2026-04-16T10:00:00Z',
            models: [
              { model_id: 'gemini-2.5-pro', remaining_fraction: 0.7, reset_time: '2026-04-16T10:00:00Z' },
            ],
          },
        },
        fetchError: null,
        accountStatus: 'active',
        cachedAtMs: nowMs_var,
      },
    });

    let fetchCalled_var = false;
    const result_var = await fetchQuotaForAccount_func({
      account: account_var,
      nowMs: nowMs_var + 5_000,
      fetchImpl: async () => {
        fetchCalled_var = true;
        throw new Error('should not be called');
      },
    });

    expect(fetchCalled_var).toBe(false);
    expect(result_var.source).toBe('cache');
    expect(result_var.data.subscriptionTier).toBe('PRO');
  });

  test('refreshes token when expiry is within 5 minutes', async () => {
    const account_var = makeAccount_func({
      token: {
        access_token: 'stale-access',
        refresh_token: 'refresh-123',
        expires_in: 3600,
        expiry_timestamp: Math.floor(Date.now() / 1000) + 120,
        token_type: 'Bearer',
        project_id: null,
      },
    });
    const authHeaders_var: string[] = [];

    const result_var = await fetchQuotaForAccount_func({
      account: account_var,
      refreshAccessToken: async () => ({
        access_token: 'fresh-access',
        refresh_token: 'refresh-456',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
      fetchImpl: async (_url_var, init_var) => {
        authHeaders_var.push(String((init_var?.headers as Record<string, string>).Authorization));
        if (String(_url_var).includes('loadCodeAssist')) {
          return new Response(JSON.stringify({
            currentTier: { id: 'g1-pro-tier' },
            project: { id: 'projects/demo-1' },
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          models: {
            'gemini-2.5-pro': {
              displayName: 'Gemini 2.5 Pro',
              quotaInfo: { remainingFraction: 0.45, resetTime: '2026-04-16T10:00:00Z' },
            },
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    expect(authHeaders_var).toEqual(['Bearer fresh-access', 'Bearer fresh-access']);
    expect(result_var.data.refreshedToken?.access_token).toBe('fresh-access');
    expect(result_var.data.refreshedToken?.refresh_token).toBe('refresh-456');
  });

  test('maps 403 into forbidden account status', async () => {
    const account_var = makeAccount_func();

    const result_var = await fetchQuotaForAccount_func({
      account: account_var,
      fetchImpl: async (_url_var, _init_var) => new Response('forbidden', { status: 403 }),
    });

    expect(result_var.data.accountStatus).toBe('forbidden');
    expect(result_var.data.fetchError?.code).toBe(403);
  });

  test('uses stale cache on timeout when available', async () => {
    const account_var = makeAccount_func();
    const nowMs_var = Date.now();

    await writeQuotaCache_func({
      cacheDir: account_var.cacheDir,
      accountId: account_var.id,
      value: {
        subscriptionTier: 'PRO',
        projectId: 'projects/demo-1',
        credits: [],
        families: {
          CLAUDE: {
            remaining_pct: 10,
            reset_time: '2026-04-16T11:00:00Z',
            models: [
              { model_id: 'claude-sonnet-4', remaining_fraction: 0.1, reset_time: '2026-04-16T11:00:00Z' },
            ],
          },
        },
        fetchError: null,
        accountStatus: 'active',
        cachedAtMs: nowMs_var - 61_000,
      },
    });

    const result_var = await fetchQuotaForAccount_func({
      account: account_var,
      nowMs: nowMs_var,
      fetchImpl: async () => {
        throw new Error('network timeout');
      },
    });

    expect(result_var.source).toBe('stale-cache');
    expect(result_var.data.fetchError?.message).toContain('network timeout');
    expect(result_var.data.families.CLAUDE?.remaining_pct).toBe(10);
  });
});

describe('fetchQuotaForAccounts_func', () => {
  test('returns per-account results for multiple accounts', async () => {
    const cacheDir_var = path.join(testRoot_var, 'cache', 'quota');
    const accounts_var = [
      makeAccount_func({ id: 'acc-1', email: 'one@example.com', cacheDir: cacheDir_var }),
      makeAccount_func({ id: 'acc-2', email: 'two@example.com', cacheDir: cacheDir_var }),
    ];

    const result_var = await fetchQuotaForAccounts_func({
      accounts: accounts_var,
      fetchImpl: async (url_var) => {
        if (String(url_var).includes('loadCodeAssist')) {
          return new Response(JSON.stringify({
            currentTier: { id: 'g1-pro-tier' },
            project: { id: 'projects/demo-1' },
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          models: {
            'gemini-2.5-pro': {
              displayName: 'Gemini 2.5 Pro',
              quotaInfo: { remainingFraction: 0.6, resetTime: '2026-04-16T10:00:00Z' },
            },
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    expect(result_var).toHaveLength(2);
    expect(result_var.map((item_var) => item_var.account.id)).toEqual(['acc-1', 'acc-2']);
    expect(result_var.every((item_var) => item_var.result.data.subscriptionTier === 'g1-pro-tier')).toBe(true);
  });
});
