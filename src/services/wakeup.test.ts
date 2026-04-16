import { describe, expect, test } from 'bun:test';

import {
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
