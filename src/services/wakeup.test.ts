import { describe, expect, test } from 'bun:test';

import {
  executeWakeup_func,
  filterWakeupCandidates_func,
  updateWakeupHistory_func,
} from './wakeup.js';

describe('filterWakeupCandidates_func', () => {
  test('W-1 null-quota active account becomes wake-up candidate', () => {
    const result_var = filterWakeupCandidates_func({
      nowSeconds: 1_700_000_000,
      accounts: [
        {
          id: 'acc-1',
          accountStatus: 'active',
          families: {
            GEMINI: { remaining_pct: null, reset_time: null },
            CLAUDE: { remaining_pct: null, reset_time: null },
          },
          wakeupHistory: { last_attempt_at: null, last_result: null, attempt_count: 0 },
        },
      ],
    });

    expect(result_var.candidates.map((candidate_var) => candidate_var.id)).toEqual(['acc-1']);
  });

  test('W-2 forbidden/disabled/protected accounts are excluded', () => {
    const result_var = filterWakeupCandidates_func({
      nowSeconds: 1_700_000_000,
      accounts: [
        {
          id: 'forbidden',
          accountStatus: 'forbidden',
          families: { GEMINI: { remaining_pct: null, reset_time: null } },
          wakeupHistory: { last_attempt_at: null, last_result: null, attempt_count: 0 },
        },
        {
          id: 'disabled',
          accountStatus: 'disabled',
          families: { GEMINI: { remaining_pct: null, reset_time: null } },
          wakeupHistory: { last_attempt_at: null, last_result: null, attempt_count: 0 },
        },
        {
          id: 'protected',
          accountStatus: 'protected',
          families: { GEMINI: { remaining_pct: null, reset_time: null } },
          wakeupHistory: { last_attempt_at: null, last_result: null, attempt_count: 0 },
        },
        {
          id: 'needs-reauth',
          accountStatus: 'needs_reauth',
          families: { GEMINI: { remaining_pct: null, reset_time: null } },
          wakeupHistory: { last_attempt_at: null, last_result: null, attempt_count: 0 },
        },
      ],
    });

    expect(result_var.candidates).toEqual([]);
  });

  test('W-3 partial-null quota is not considered sleeping', () => {
    const result_var = filterWakeupCandidates_func({
      nowSeconds: 1_700_000_000,
      accounts: [
        {
          id: 'acc-1',
          accountStatus: 'active',
          families: {
            GEMINI: { remaining_pct: null, reset_time: null },
            CLAUDE: { remaining_pct: 50, reset_time: null },
          },
          wakeupHistory: { last_attempt_at: null, last_result: null, attempt_count: 0 },
        },
      ],
    });

    expect(result_var.candidates).toEqual([]);
  });

  test('W-4 30-minute cooldown excludes recent failures', () => {
    const result_var = filterWakeupCandidates_func({
      nowSeconds: 1_700_000_000,
      accounts: [
        {
          id: 'acc-1',
          accountStatus: 'active',
          families: { GEMINI: { remaining_pct: null, reset_time: null } },
          wakeupHistory: { last_attempt_at: 1_700_000_000 - 60, last_result: 'timeout', attempt_count: 1 },
        },
      ],
    });

    expect(result_var.candidates).toEqual([]);
    expect(result_var.skippedCooldown.map((candidate_var) => candidate_var.id)).toEqual(['acc-1']);
  });
});

describe('updateWakeupHistory_func', () => {
  test('W-5 updates wakeup history counters and timestamps', () => {
    const updated_var = updateWakeupHistory_func({
      account: {
        id: 'acc-1',
        wakeupHistory: { last_attempt_at: null, last_result: null, attempt_count: 0 },
      },
      nowSeconds: 1_700_000_000,
      result: 'success',
    });

    expect(updated_var.wakeupHistory).toEqual({
      last_attempt_at: 1_700_000_000,
      last_result: 'success',
      attempt_count: 1,
    });
  });
});

describe('executeWakeup_func', () => {
  test('runs inject -> profile -> warmup -> persist for sleeping accounts', async () => {
    const calls_var: string[] = [];

    const result_var = await executeWakeup_func({
      nowSeconds: 1_700_000_000,
      account: {
        id: 'acc-1',
        accountStatus: 'active',
        families: {
          GEMINI: { remaining_pct: null, reset_time: null },
          CLAUDE: { remaining_pct: null, reset_time: null },
        },
        wakeupHistory: { last_attempt_at: null, last_result: null, attempt_count: 0 },
        token: {
          access_token: 'access-123',
          refresh_token: 'refresh-123',
          expiry_timestamp: 1_712_345_678,
        },
        fingerprintId: 'fp-1',
        deviceProfile: {
          machine_id: 'auth0|user_deadbeefdeadbeefdeadbeefdeadbeef',
          mac_machine_id: '11111111-2222-4333-8444-555555555555',
          dev_device_id: '66666666-7777-4888-9999-aaaaaaaaaaaa',
          sqm_id: '{BBBBBBBB-CCCC-4DDD-8EEE-FFFFFFFFFFFF}',
          service_machine_id: '12345678-1234-4234-9234-123456789abc',
        },
      },
      injectAuth: async () => {
        calls_var.push('inject');
      },
      applyDeviceProfile: async () => {
        calls_var.push('fingerprint');
      },
      performWarmupTurn: async () => {
        calls_var.push('turn');
        return 'success';
      },
      persistResult: async (result_var) => {
        calls_var.push(`persist:${result_var}`);
      },
    });

    expect(result_var.status).toBe('success');
    expect(calls_var).toEqual(['inject', 'fingerprint', 'turn', 'persist:success']);
  });

  test('skips already-awake accounts without side effects', async () => {
    const calls_var: string[] = [];

    const result_var = await executeWakeup_func({
      nowSeconds: 1_700_000_000,
      account: {
        id: 'acc-1',
        accountStatus: 'active',
        families: {
          GEMINI: { remaining_pct: 50, reset_time: null },
        },
        wakeupHistory: { last_attempt_at: null, last_result: null, attempt_count: 0 },
        token: {
          access_token: 'access-123',
          refresh_token: 'refresh-123',
          expiry_timestamp: 1_712_345_678,
        },
        fingerprintId: 'fp-1',
        deviceProfile: null,
      },
      injectAuth: async () => {
        calls_var.push('inject');
      },
      performWarmupTurn: async () => 'success',
      persistResult: async () => {
        calls_var.push('persist');
      },
    });

    expect(result_var.status).toBe('skipped');
    expect(calls_var).toEqual([]);
  });
});
