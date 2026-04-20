import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
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
      preTurnSnapshot: {
        families: {
          GEMINI: { remaining_pct: 73 },
        },
        captured_at: 1_700_000_000 - 60,
      },
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
    expect(result_var.pendingSwitch?.pre_turn_pct).toBe(73);
    expect(result_var.pendingSwitch?.post_turn_pct).toBe(69);
    expect(result_var.pendingSwitch?.bucket_crossed).toBe('70');
    expect(result_var.pendingSwitch?.applied_at).toBe(1_700_000_000);
    expect(result_var.updatedCurrentAccount?.familyBuckets.GEMINI).toBe('70');
  });

  test('R-2 same bucket does not rotate when pre/post stay within 70%% bucket', () => {
    const result_var = decideAutoRotate_func({
      currentAccountId: 'acc-1',
      effectiveFamily: 'GEMINI',
      preTurnSnapshot: {
        families: {
          GEMINI: { remaining_pct: 67 },
        },
        captured_at: 1_700_000_000 - 60,
      },
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

    expect(result_var.pendingSwitch).toBeNull();
  });

  test('R-3 Pro below 20%% becomes protected and excluded', () => {
    const result_var = decideAutoRotate_func({
      currentAccountId: 'acc-1',
      effectiveFamily: 'GEMINI',
      preTurnSnapshot: {
        families: {
          GEMINI: { remaining_pct: 25 },
        },
        captured_at: 1_700_000_000 - 60,
      },
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
      preTurnSnapshot: {
        families: {
          GEMINI: { remaining_pct: 12 },
        },
        captured_at: 1_700_000_000 - 60,
      },
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

  test('R-9 bucket is preserved when quota recovers above 90%%', () => {
    const result_var = decideAutoRotate_func({
      currentAccountId: 'acc-1',
      effectiveFamily: 'GEMINI',
      preTurnSnapshot: {
        families: {
          GEMINI: { remaining_pct: 95 },
        },
        captured_at: 1_700_000_000 - 60,
      },
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

    expect(result_var.updatedCurrentAccount?.familyBuckets.GEMINI).toBe('70');
  });

  test('R-10 needs_reauth candidates are excluded from rotate selection', () => {
    const result_var = decideAutoRotate_func({
      currentAccountId: 'acc-1',
      effectiveFamily: 'CLAUDE',
      preTurnSnapshot: {
        families: {
          CLAUDE: { remaining_pct: 73 },
        },
        captured_at: 1_700_000_000 - 60,
      },
      accounts: [
        {
          id: 'acc-1',
          email: 'one@example.com',
          accountStatus: 'active',
          lastUsed: 100,
          subscriptionTier: 'ultra',
          families: { CLAUDE: { remaining_pct: 64, reset_time: null } },
          familyBuckets: { GEMINI: null, CLAUDE: null, _min: null },
        },
        {
          id: 'acc-2',
          email: 'two@example.com',
          accountStatus: 'needs_reauth',
          lastUsed: 50,
          subscriptionTier: 'ultra',
          families: { CLAUDE: { remaining_pct: 99, reset_time: null } },
          familyBuckets: { GEMINI: null, CLAUDE: null, _min: null },
        },
      ],
      nowSeconds: 1_700_000_000,
    });

    expect(result_var.pendingSwitch).toBeNull();
    expect(result_var.warning).toContain('No eligible account');
  });
});

describe('pending switch record helpers', () => {
  test('PS-1 saves and loads the applied switch record', async () => {
    const runtimeDir_var = path.join(testRoot_var, 'runtime');
    await savePendingSwitchIntent_func({
      runtimeDir: runtimeDir_var,
      value: {
        target_account_id: 'acc-2',
        source_account_id: 'acc-1',
        reason: 'Ultra threshold 70% crossed (current: 68%)',
        pre_turn_pct: 73,
        post_turn_pct: 68,
        bucket_crossed: '70',
        effective_family: 'GEMINI',
        fingerprint_id: 'fp-2',
        service_machine_id: 'svc-2',
        applied_at: 1_700_000_000,
      },
    });

    const loaded_var = await loadPendingSwitchIntent_func({
      runtimeDir: runtimeDir_var,
      nowSeconds: 1_700_000_100,
    });

    expect(loaded_var?.target_account_id).toBe('acc-2');
    expect(loaded_var?.fingerprint_id).toBe('fp-2');
  });

  test('discards stale applied records older than 24h', async () => {
    const runtimeDir_var = path.join(testRoot_var, 'runtime');
    await savePendingSwitchIntent_func({
      runtimeDir: runtimeDir_var,
      value: {
        target_account_id: 'acc-2',
        source_account_id: 'acc-1',
        reason: 'stale',
        pre_turn_pct: 73,
        post_turn_pct: 68,
        bucket_crossed: '70',
        effective_family: 'GEMINI',
        fingerprint_id: null,
        service_machine_id: null,
        applied_at: 1_700_000_000,
      },
    });

    const loaded_var = await loadPendingSwitchIntent_func({
      runtimeDir: runtimeDir_var,
      nowSeconds: 1_700_000_000 + 86_401,
    });

    expect(loaded_var).toBeNull();
  });

  test('writes pending-switch.json with 0600 permissions', async () => {
    const runtimeDir_var = path.join(testRoot_var, 'runtime');
    await savePendingSwitchIntent_func({
      runtimeDir: runtimeDir_var,
      value: {
        target_account_id: 'acc-2',
        source_account_id: 'acc-1',
        reason: 'permissions',
        pre_turn_pct: 73,
        post_turn_pct: 68,
        bucket_crossed: '70',
        effective_family: 'GEMINI',
        fingerprint_id: null,
        service_machine_id: null,
        applied_at: 1_700_000_000,
      },
    });

    const file_mode_var = statSync(path.join(runtimeDir_var, 'pending-switch.json')).mode & 0o777;
    expect(file_mode_var).toBe(0o600);
  });

  test('clearPendingSwitchIntent removes the persisted applied record file', async () => {
    const runtimeDir_var = path.join(testRoot_var, 'runtime');
    await savePendingSwitchIntent_func({
      runtimeDir: runtimeDir_var,
      value: {
        target_account_id: 'acc-2',
        source_account_id: 'acc-1',
        reason: 'cleanup',
        pre_turn_pct: 73,
        post_turn_pct: 68,
        bucket_crossed: '70',
        effective_family: 'GEMINI',
        fingerprint_id: null,
        service_machine_id: null,
        applied_at: 1_700_000_000,
      },
    });

    await clearPendingSwitchIntent_func({ runtimeDir: runtimeDir_var });

    expect(() => readFileSync(path.join(runtimeDir_var, 'pending-switch.json'), 'utf8')).toThrow();
  });
});
