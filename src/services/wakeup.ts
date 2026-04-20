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

export interface WakeupExecutableAccount extends WakeupCandidateAccount {
  token: {
    access_token: string;
    refresh_token: string | null;
    expiry_timestamp: number;
  };
  fingerprintId: string;
  deviceProfile: {
    machine_id: string;
    mac_machine_id: string;
    dev_device_id: string;
    sqm_id: string;
    service_machine_id: string;
  } | null;
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
    if (['forbidden', 'disabled', 'protected', 'needs_reauth'].includes(account_var.accountStatus)) {
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

export async function executeWakeup_func(options_var: {
  account: WakeupExecutableAccount;
  nowSeconds: number;
  injectAuth: () => Promise<void>;
  applyDeviceProfile?: () => Promise<void> | void;
  performWarmupTurn: () => Promise<'success' | 'timeout' | 'forbidden' | 'error'>;
  persistResult: (result: 'success' | 'timeout' | 'forbidden' | 'error') => Promise<void>;
}): Promise<{ status: 'success' | 'timeout' | 'forbidden' | 'error' | 'skipped' }> {
  const filtered_var = filterWakeupCandidates_func({
    nowSeconds: options_var.nowSeconds,
    accounts: [options_var.account],
  });
  if (filtered_var.candidates.length === 0) {
    return { status: 'skipped' };
  }

  if (!options_var.account.token.refresh_token) {
    await options_var.persistResult('error');
    return { status: 'error' };
  }

  try {
    await options_var.injectAuth();
    await options_var.applyDeviceProfile?.();
    const result_var = await options_var.performWarmupTurn();
    await options_var.persistResult(result_var);
    return { status: result_var };
  } catch {
    await options_var.persistResult('error');
    return { status: 'error' };
  }
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
