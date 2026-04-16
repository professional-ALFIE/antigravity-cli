import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  decideAutoRotate_func,
  loadPendingSwitchIntent_func,
  savePendingSwitchIntent_func,
  clearPendingSwitchIntent_func,
} from './rotate.js';

let testRoot_var: string;

beforeEach(() => {
  testRoot_var = mkdtempSync(path.join(tmpdir(), 'ag-rotate-'));
});

afterEach(() => {
  rmSync(testRoot_var, { recursive: true, force: true });
});

describe('decideAutoRotate_func', () => {
  test('R-1 Ultra 70%% bucket crossing schedules rotate once', () => {
    const result_var = decideAutoRotate_func({
      currentAccountId: 'acc-1',
      effectiveFamily: 'GEMINI',
      accounts: [
        {
          id: 'acc-1',
          email: 'one@example.com',
          accountStatus: 'active',
          lastUsed: 100,
          subscriptionTier: 'ultra',
          families: {
            GEMINI: { remaining_pct: 69, reset_time: null },
            CLAUDE: { remaining_pct: 80, reset_time: null },
          },
          familyBuckets: { GEMINI: null, CLAUDE: null, _min: null },
        },
        {
          id: 'acc-2',
          email: 'two@example.com',
          accountStatus: 'active',
          lastUsed: 50,
          subscriptionTier: 'ultra',
          families: {
            GEMINI: { remaining_pct: 88, reset_time: null },
            CLAUDE: { remaining_pct: 88, reset_time: null },
          },
          familyBuckets: { GEMINI: null, CLAUDE: null, _min: null },
        },
      ],
      nowSeconds: 1_700_000_000,
    });

    expect(result_var.pendingSwitch?.target_account_id).toBe('acc-2');
    expect(result_var.updatedCurrentAccount?.familyBuckets.GEMINI).toBe('70');
  });

  test('R-2 same bucket does not rotate again', () => {
    const result_var = decideAutoRotate_func({
      currentAccountId: 'acc-1',
      effectiveFamily: 'GEMINI',
      accounts: [
        {
          id: 'acc-1',
          email: 'one@example.com',
          accountStatus: 'active',
          lastUsed: 100,
          subscriptionTier: 'ultra',
          families: {
            GEMINI: { remaining_pct: 65, reset_time: null },
            CLAUDE: { remaining_pct: 80, reset_time: null },
          },
          familyBuckets: { GEMINI: '70', CLAUDE: null, _min: null },
        },
        {
          id: 'acc-2',
          email: 'two@example.com',
          accountStatus: 'active',
          lastUsed: 50,
          subscriptionTier: 'ultra',
          families: {
            GEMINI: { remaining_pct: 88, reset_time: null },
            CLAUDE: { remaining_pct: 88, reset_time: null },
          },
          familyBuckets: { GEMINI: null, CLAUDE: null, _min: null },
        },
      ],
      nowSeconds: 1_700_000_000,
    });

    expect(result_var.pendingSwitch).toBeNull();
  });

  test('R-3 Pro below 20%% becomes protected and excluded', () => {
    const result_var = decideAutoRotate_func({
      currentAccountId: 'acc-1',
      effectiveFamily: 'GEMINI',
      accounts: [
        {
          id: 'acc-1',
          email: 'one@example.com',
          accountStatus: 'active',
          lastUsed: 100,
          subscriptionTier: 'pro',
          families: {
            GEMINI: { remaining_pct: 19, reset_time: null },
            CLAUDE: { remaining_pct: 30, reset_time: null },
          },
          familyBuckets: { GEMINI: null, CLAUDE: null, _min: null },
        },
        {
          id: 'acc-2',
          email: 'two@example.com',
          accountStatus: 'active',
          lastUsed: 50,
          subscriptionTier: 'pro',
          families: {
            GEMINI: { remaining_pct: 70, reset_time: null },
            CLAUDE: { remaining_pct: 70, reset_time: null },
          },
          familyBuckets: { GEMINI: null, CLAUDE: null, _min: null },
        },
      ],
      nowSeconds: 1_700_000_000,
    });

    expect(result_var.updatedCurrentAccount?.accountStatus).toBe('protected');
    expect(result_var.pendingSwitch?.target_account_id).toBe('acc-2');
  });

  test('R-5 when all candidates exhausted returns warning and no switch', () => {
    const result_var = decideAutoRotate_func({
      currentAccountId: 'acc-1',
      effectiveFamily: 'GEMINI',
      accounts: [
        {
          id: 'acc-1',
          email: 'one@example.com',
          accountStatus: 'active',
          lastUsed: 100,
          subscriptionTier: 'ultra',
          families: { GEMINI: { remaining_pct: 9, reset_time: null } },
          familyBuckets: { GEMINI: null, CLAUDE: null, _min: null },
        },
        {
          id: 'acc-2',
          email: 'two@example.com',
          accountStatus: 'forbidden',
          lastUsed: 50,
          subscriptionTier: 'ultra',
          families: { GEMINI: { remaining_pct: 80, reset_time: null } },
          familyBuckets: { GEMINI: null, CLAUDE: null, _min: null },
        },
      ],
      nowSeconds: 1_700_000_000,
    });

    expect(result_var.pendingSwitch).toBeNull();
    expect(result_var.warning).toContain('No eligible account');
  });

  test('R-9 bucket resets when quota recovers above 90%%', () => {
    const result_var = decideAutoRotate_func({
      currentAccountId: 'acc-1',
      effectiveFamily: 'GEMINI',
      accounts: [
        {
          id: 'acc-1',
          email: 'one@example.com',
          accountStatus: 'active',
          lastUsed: 100,
          subscriptionTier: 'ultra',
          families: { GEMINI: { remaining_pct: 95, reset_time: null } },
          familyBuckets: { GEMINI: '70', CLAUDE: null, _min: '70' },
        },
      ],
      nowSeconds: 1_700_000_000,
    });

    expect(result_var.updatedCurrentAccount?.familyBuckets.GEMINI).toBeNull();
  });
});

describe('pending switch persistence', () => {
  test('R-8 saves and loads pending switch intent', async () => {
    const runtimeDir_var = path.join(testRoot_var, 'runtime');
    await savePendingSwitchIntent_func({
      runtimeDir: runtimeDir_var,
      value: {
        target_account_id: 'acc-2',
        source_account_id: 'acc-1',
        reason: 'Ultra threshold 70% crossed (current: 68%)',
        decided_at: 1_700_000_000,
      },
    });

    const loaded_var = await loadPendingSwitchIntent_func({
      runtimeDir: runtimeDir_var,
      nowSeconds: 1_700_000_100,
    });

    expect(loaded_var?.target_account_id).toBe('acc-2');
  });

  test('stale pending switch intent older than 24h is discarded', async () => {
    const runtimeDir_var = path.join(testRoot_var, 'runtime');
    await savePendingSwitchIntent_func({
      runtimeDir: runtimeDir_var,
      value: {
        target_account_id: 'acc-2',
        source_account_id: 'acc-1',
        reason: 'stale',
        decided_at: 1_700_000_000,
      },
    });

    const loaded_var = await loadPendingSwitchIntent_func({
      runtimeDir: runtimeDir_var,
      nowSeconds: 1_700_000_000 + 86_401,
    });

    expect(loaded_var).toBeNull();
  });

  test('clearPendingSwitchIntent removes persisted file', async () => {
    const runtimeDir_var = path.join(testRoot_var, 'runtime');
    await savePendingSwitchIntent_func({
      runtimeDir: runtimeDir_var,
      value: {
        target_account_id: 'acc-2',
        source_account_id: 'acc-1',
        reason: 'cleanup',
        decided_at: 1_700_000_000,
      },
    });

    await clearPendingSwitchIntent_func({ runtimeDir: runtimeDir_var });

    expect(() => readFileSync(path.join(runtimeDir_var, 'pending-switch.json'), 'utf8')).toThrow();
  });
});
