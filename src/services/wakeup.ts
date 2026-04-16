export interface WakeupCandidateAccount {
  id: string;
  accountStatus: string;
  families: Record<string, { remaining_pct: number | null; reset_time: string | null }>;
  wakeupHistory: {
    last_attempt_at: number | null;
    last_result: string | null;
    attempt_count: number;
  };
}

const WAKEUP_COOLDOWN_SECONDS_var = 30 * 60;

function isSleepingQuota_func(families_var: Record<string, { remaining_pct: number | null }>): boolean {
  const values_var = Object.values(families_var);
  if (values_var.length === 0) {
    return false;
  }
  return values_var.every((family_var) => family_var.remaining_pct === null);
}

function isInCooldown_func(account_var: WakeupCandidateAccount, nowSeconds_var: number): boolean {
  if (!account_var.wakeupHistory.last_attempt_at) {
    return false;
  }
  if (!['timeout', 'error'].includes(account_var.wakeupHistory.last_result ?? '')) {
    return false;
  }
  return nowSeconds_var - account_var.wakeupHistory.last_attempt_at < WAKEUP_COOLDOWN_SECONDS_var;
}

export function filterWakeupCandidates_func(options_var: {
  accounts: WakeupCandidateAccount[];
  nowSeconds: number;
}): {
  candidates: WakeupCandidateAccount[];
  skippedCooldown: WakeupCandidateAccount[];
} {
  const candidates_var: WakeupCandidateAccount[] = [];
  const skippedCooldown_var: WakeupCandidateAccount[] = [];

  for (const account_var of options_var.accounts) {
    if (['forbidden', 'disabled', 'protected'].includes(account_var.accountStatus)) {
      continue;
    }
    if (!isSleepingQuota_func(account_var.families)) {
      continue;
    }
    if (isInCooldown_func(account_var, options_var.nowSeconds)) {
      skippedCooldown_var.push(account_var);
      continue;
    }
    candidates_var.push(account_var);
  }

  return {
    candidates: candidates_var,
    skippedCooldown: skippedCooldown_var,
  };
}

export function updateWakeupHistory_func(options_var: {
  account: {
    id: string;
    wakeupHistory: {
      last_attempt_at: number | null;
      last_result: string | null;
      attempt_count: number;
    };
  };
  nowSeconds: number;
  result: 'success' | 'timeout' | 'forbidden' | 'error';
}): {
  id: string;
  wakeupHistory: {
    last_attempt_at: number;
    last_result: 'success' | 'timeout' | 'forbidden' | 'error';
    attempt_count: number;
  };
} {
  return {
    id: options_var.account.id,
    wakeupHistory: {
      last_attempt_at: options_var.nowSeconds,
      last_result: options_var.result,
      attempt_count: options_var.account.wakeupHistory.attempt_count + 1,
    },
  };
}
