import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface RotateAccountSnapshot {
  id: string;
  email: string;
  accountStatus: string;
  lastUsed: number;
  subscriptionTier: string | null;
  families: Record<string, { remaining_pct: number | null; reset_time: string | null }>;
  familyBuckets: Record<string, string | null>;
}

export interface PendingSwitchIntent {
  target_account_id: string;
  source_account_id: string;
  reason: string;
  decided_at: number;
}

function resolveRuntimeDir_func(runtimeDir_var: string): string {
  mkdirSync(runtimeDir_var, { recursive: true });
  return runtimeDir_var;
}

function resolvePendingSwitchPath_func(runtimeDir_var: string): string {
  return path.join(resolveRuntimeDir_func(runtimeDir_var), 'pending-switch.json');
}

function normalizeTier_func(subscriptionTier_var: string | null): 'ultra' | 'pro' | 'free' {
  const lower_var = (subscriptionTier_var ?? '').toLowerCase();
  if (lower_var.includes('ultra')) return 'ultra';
  if (lower_var.includes('pro')) return 'pro';
  return 'free';
}

function resolveRemainingPct_func(account_var: RotateAccountSnapshot, effectiveFamily_var: string | null): { remainingPct: number | null; bucketKey: string } {
  if (effectiveFamily_var && account_var.families[effectiveFamily_var]) {
    return {
      remainingPct: account_var.families[effectiveFamily_var].remaining_pct,
      bucketKey: effectiveFamily_var,
    };
  }

  const values_var = Object.entries(account_var.families)
    .map(([, family_var]) => family_var.remaining_pct)
    .filter((value_var): value_var is number => value_var !== null);

  return {
    remainingPct: values_var.length > 0 ? Math.min(...values_var) : null,
    bucketKey: '_min',
  };
}

function thresholdBucket_func(remainingPct_var: number | null, tier_var: 'ultra' | 'pro' | 'free'): string | null {
  if (remainingPct_var === null) return null;
  if (tier_var === 'ultra') {
    if (remainingPct_var < 10) return '10';
    if (remainingPct_var < 40) return '40';
    if (remainingPct_var < 70) return '70';
    return null;
  }
  if (tier_var === 'pro') {
    if (remainingPct_var < 20) return '20';
    if (remainingPct_var < 70) return '70';
    return null;
  }
  return remainingPct_var <= 0 ? '0' : null;
}

export function decideAutoRotate_func(options_var: {
  currentAccountId: string;
  effectiveFamily: string | null;
  accounts: RotateAccountSnapshot[];
  nowSeconds: number;
}): {
  updatedCurrentAccount: RotateAccountSnapshot | null;
  pendingSwitch: PendingSwitchIntent | null;
  warning: string | null;
} {
  const currentAccount_var = options_var.accounts.find((account_var) => account_var.id === options_var.currentAccountId) ?? null;
  if (!currentAccount_var) {
    return {
      updatedCurrentAccount: null,
      pendingSwitch: null,
      warning: 'Current account not found',
    };
  }

  const tier_var = normalizeTier_func(currentAccount_var.subscriptionTier);
  const { remainingPct: currentRemainingPct_var, bucketKey: bucketKey_var } = resolveRemainingPct_func(currentAccount_var, options_var.effectiveFamily);
  const currentBucket_var = thresholdBucket_func(currentRemainingPct_var, tier_var);
  const storedBucket_var = currentAccount_var.familyBuckets[bucketKey_var] ?? null;

  const updatedCurrentAccount_var: RotateAccountSnapshot = {
    ...currentAccount_var,
    accountStatus: tier_var === 'pro' && currentRemainingPct_var !== null && currentRemainingPct_var < 20
      ? 'protected'
      : currentAccount_var.accountStatus,
    familyBuckets: {
      ...currentAccount_var.familyBuckets,
      [bucketKey_var]: currentAccount_var.familyBuckets[bucketKey_var] ?? null,
    },
  };

  if (currentBucket_var === null || currentBucket_var === storedBucket_var) {
    return {
      updatedCurrentAccount: updatedCurrentAccount_var,
      pendingSwitch: null,
      warning: null,
    };
  }

  updatedCurrentAccount_var.familyBuckets[bucketKey_var] = currentBucket_var;

  const candidateAccounts_var = options_var.accounts
    .filter((account_var) => account_var.id !== currentAccount_var.id)
    .filter((account_var) => !['forbidden', 'disabled', 'protected'].includes(account_var.accountStatus));

  const rankedCandidates_var = candidateAccounts_var
    .map((account_var) => ({
      account: account_var,
      ...resolveRemainingPct_func(account_var, options_var.effectiveFamily),
    }))
    .sort((left_var, right_var) => {
      const leftRemaining_var = left_var.remainingPct ?? -1;
      const rightRemaining_var = right_var.remainingPct ?? -1;
      if (rightRemaining_var !== leftRemaining_var) {
        return rightRemaining_var - leftRemaining_var;
      }
      return left_var.account.lastUsed - right_var.account.lastUsed;
    });

  const targetCandidate_var = rankedCandidates_var[0];
  if (!targetCandidate_var) {
    return {
      updatedCurrentAccount: updatedCurrentAccount_var,
      pendingSwitch: null,
      warning: `No eligible account for rotate from ${currentAccount_var.id}`,
    };
  }

  return {
    updatedCurrentAccount: updatedCurrentAccount_var,
    pendingSwitch: {
      target_account_id: targetCandidate_var.account.id,
      source_account_id: currentAccount_var.id,
      reason: `${tier_var === 'ultra' ? 'Ultra' : tier_var === 'pro' ? 'Pro' : 'Free'} threshold ${currentBucket_var}% crossed (current: ${currentRemainingPct_var ?? 'unknown'}%)`,
      decided_at: options_var.nowSeconds,
    },
    warning: null,
  };
}

export async function savePendingSwitchIntent_func(options_var: { runtimeDir: string; value: PendingSwitchIntent }): Promise<void> {
  writeFileSync(resolvePendingSwitchPath_func(options_var.runtimeDir), `${JSON.stringify(options_var.value, null, 2)}\n`, 'utf8');
}

export async function loadPendingSwitchIntent_func(options_var: { runtimeDir: string; nowSeconds: number }): Promise<PendingSwitchIntent | null> {
  const filePath_var = resolvePendingSwitchPath_func(options_var.runtimeDir);
  if (!existsSync(filePath_var)) {
    return null;
  }

  try {
    const parsed_var = JSON.parse(readFileSync(filePath_var, 'utf8')) as PendingSwitchIntent;
    if (options_var.nowSeconds - parsed_var.decided_at > 86_400) {
      rmSync(filePath_var, { force: true });
      return null;
    }
    return parsed_var;
  } catch {
    rmSync(filePath_var, { force: true });
    return null;
  }
}

export async function clearPendingSwitchIntent_func(options_var: { runtimeDir: string }): Promise<void> {
  rmSync(resolvePendingSwitchPath_func(options_var.runtimeDir), { force: true });
}
