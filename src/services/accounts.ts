import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_ACCOUNT_NAME_var = 'default';
const ACCOUNTS_VERSION_var = '1.0';

export type AccountStatus = 'active' | 'protected' | 'forbidden' | 'disabled' | 'needs_reauth';

export interface AccountInfo {
  name: string;
  userDataDirPath: string;
}

export interface AccountIndexEntry {
  id: string;
  email: string;
  name: string;
  created_at: number;
  last_used: number;
}

export interface AccountTokenData {
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
  expiry_timestamp: number;
  token_type: string;
  project_id: string | null;
}

export interface AccountQuotaFamilyCache {
  remaining_pct: number | null;
  reset_time: string | null;
  models: string[];
}

export interface AccountDetail {
  id: string;
  email: string;
  name: string;
  account_status: AccountStatus;
  account_status_reason: string | null;
  account_status_changed_at: number | null;
  token: AccountTokenData;
  fingerprint_id: string;
  quota_cache: {
    subscription_tier: string | null;
    families: Record<string, AccountQuotaFamilyCache>;
    fetch_error: string | null;
    cached_at: number | null;
  };
  rotation: {
    family_buckets: Record<string, string | null>;
    last_rotated_at: number | null;
  };
  wakeup_history: {
    last_attempt_at: number | null;
    last_result: string | null;
    attempt_count: number;
  };
  created_at: number;
  last_used: number;
}

interface AccountsIndex {
  version: string;
  current_account_id: string | null;
  accounts: AccountIndexEntry[];
}

interface DiscoverAccountsOptions {
  defaultDataDir: string;
  cliDir: string;
}

interface GetStateDbPathOptions {
  userDataDirPath: string;
}

interface GetActiveAccountNameOptions {
  cliDir: string;
}

interface SetActiveAccountNameOptions {
  cliDir: string;
  accountName: string;
}

interface SetCurrentAccountIdOptions {
  cliDir: string;
  accountId: string | null;
}

interface UpsertAccountOptions {
  cliDir: string;
  email: string;
  name: string;
  token: AccountTokenData;
  accountStatus?: AccountStatus;
  accountStatusReason?: string | null;
  nowTimestamp?: number;
}

interface GetAccountOptions {
  cliDir: string;
  accountId: string;
}

function parseUserSuffix_func(name_var: string): number | null {
  const match_var = name_var.match(/^user-(\d+)$/);
  if (!match_var) {
    return null;
  }
  return Number.parseInt(match_var[1], 10);
}

function resolveAccountsIndexPath_func(cliDir_var: string): string {
  return path.join(cliDir_var, 'accounts.json');
}

function resolveAccountsDirPath_func(cliDir_var: string): string {
  return path.join(cliDir_var, 'accounts');
}

function resolveAccountDetailPath_func(cliDir_var: string, accountId_var: string): string {
  return path.join(resolveAccountsDirPath_func(cliDir_var), `${accountId_var}.json`);
}

function resolveLegacyAuthJsonPath_func(cliDir_var: string): string {
  return path.join(cliDir_var, 'auth.json');
}

function ensureDir_func(dirPath_var: string): void {
  mkdirSync(dirPath_var, { recursive: true });
}

function chmod0600_func(filePath_var: string): void {
  chmodSync(filePath_var, 0o600);
}

function writeJsonAtomic0600_func(filePath_var: string, value_var: unknown): void {
  ensureDir_func(path.dirname(filePath_var));
  const tempPath_var = `${filePath_var}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath_var, `${JSON.stringify(value_var, null, 2)}\n`, 'utf8');
  chmod0600_func(tempPath_var);
  renameSync(tempPath_var, filePath_var);
  chmod0600_func(filePath_var);
}

function backupCorruptIndex_func(indexPath_var: string): void {
  const backupPath_var = `${indexPath_var}.corrupt-${Date.now()}.bak`;
  renameSync(indexPath_var, backupPath_var);
  chmod0600_func(backupPath_var);
}

function createEmptyIndex_func(): AccountsIndex {
  return {
    version: ACCOUNTS_VERSION_var,
    current_account_id: null,
    accounts: [],
  };
}

function readAccountsIndex_func(cliDir_var: string): AccountsIndex {
  const indexPath_var = resolveAccountsIndexPath_func(cliDir_var);
  if (!existsSync(indexPath_var)) {
    return createEmptyIndex_func();
  }

  try {
    const parsed_var = JSON.parse(readFileSync(indexPath_var, 'utf8')) as Partial<AccountsIndex>;
    if (
      parsed_var.version !== ACCOUNTS_VERSION_var
      || !Array.isArray(parsed_var.accounts)
    ) {
      throw new Error('invalid accounts index schema');
    }

    return {
      version: ACCOUNTS_VERSION_var,
      current_account_id: typeof parsed_var.current_account_id === 'string' ? parsed_var.current_account_id : null,
      accounts: parsed_var.accounts.map((account_var) => ({
        id: String(account_var.id),
        email: String(account_var.email),
        name: String(account_var.name),
        created_at: Number(account_var.created_at),
        last_used: Number(account_var.last_used),
      })),
    };
  } catch {
    backupCorruptIndex_func(indexPath_var);
    return createEmptyIndex_func();
  }
}

function writeAccountsIndex_func(cliDir_var: string, index_var: AccountsIndex): void {
  writeJsonAtomic0600_func(resolveAccountsIndexPath_func(cliDir_var), index_var);
}

function readAccountDetailSync_func(cliDir_var: string, accountId_var: string): AccountDetail | null {
  const detailPath_var = resolveAccountDetailPath_func(cliDir_var, accountId_var);
  if (!existsSync(detailPath_var)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(detailPath_var, 'utf8')) as AccountDetail;
  } catch {
    return null;
  }
}

function defaultAccountStatus_func(token_var: AccountTokenData): AccountStatus {
  return token_var.refresh_token ? 'active' : 'needs_reauth';
}

function createAccountDetail_func(options_var: {
  id: string;
  email: string;
  name: string;
  token: AccountTokenData;
  accountStatus: AccountStatus;
  accountStatusReason: string | null;
  nowTimestamp: number;
  existing?: AccountDetail | null;
}): AccountDetail {
  const existing_var = options_var.existing ?? null;
  const createdAt_var = existing_var?.created_at ?? options_var.nowTimestamp;
  const accountStatus_var = options_var.accountStatus;
  const accountStatusChangedAt_var = existing_var?.account_status === accountStatus_var
    ? existing_var.account_status_changed_at
    : options_var.nowTimestamp;

  return {
    id: options_var.id,
    email: options_var.email,
    name: options_var.name,
    account_status: accountStatus_var,
    account_status_reason: options_var.accountStatusReason,
    account_status_changed_at: accountStatusChangedAt_var,
    token: options_var.token,
    fingerprint_id: existing_var?.fingerprint_id ?? 'original',
    quota_cache: existing_var?.quota_cache ?? {
      subscription_tier: null,
      families: {},
      fetch_error: null,
      cached_at: null,
    },
    rotation: existing_var?.rotation ?? {
      family_buckets: {
        GEMINI: null,
        CLAUDE: null,
        _min: null,
      },
      last_rotated_at: null,
    },
    wakeup_history: existing_var?.wakeup_history ?? {
      last_attempt_at: null,
      last_result: null,
      attempt_count: 0,
    },
    created_at: createdAt_var,
    last_used: options_var.nowTimestamp,
  };
}

function writeAccountDetail_func(cliDir_var: string, detail_var: AccountDetail): void {
  writeJsonAtomic0600_func(resolveAccountDetailPath_func(cliDir_var, detail_var.id), detail_var);
}

export function getStateDbPath_func(options_var: GetStateDbPathOptions): string {
  return path.join(options_var.userDataDirPath, 'User', 'globalStorage', 'state.vscdb');
}

export function getDefaultDataDir_func(): string {
  return path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity');
}

export function getDefaultCliDir_func(): string {
  return path.join(os.homedir(), '.antigravity-cli');
}

export async function listAccounts_func(options_var: { cliDir: string }): Promise<AccountDetail[]> {
  const index_var = readAccountsIndex_func(options_var.cliDir);
  const accounts_var: AccountDetail[] = [];

  for (const account_var of index_var.accounts) {
    const detail_var = readAccountDetailSync_func(options_var.cliDir, account_var.id);
    if (!detail_var) {
      continue;
    }
    accounts_var.push(detail_var);
  }

  return accounts_var;
}

export async function getAccount_func(options_var: GetAccountOptions): Promise<AccountDetail | null> {
  return readAccountDetailSync_func(options_var.cliDir, options_var.accountId);
}

export async function getCurrentAccountId_func(options_var: { cliDir: string }): Promise<string | null> {
  const index_var = readAccountsIndex_func(options_var.cliDir);
  return index_var.current_account_id;
}

export async function setCurrentAccountId_func(options_var: SetCurrentAccountIdOptions): Promise<void> {
  const index_var = readAccountsIndex_func(options_var.cliDir);
  index_var.current_account_id = options_var.accountId;
  writeAccountsIndex_func(options_var.cliDir, index_var);
}

export async function getActiveAccountName_func(options_var: GetActiveAccountNameOptions): Promise<string> {
  const indexPath_var = resolveAccountsIndexPath_func(options_var.cliDir);
  if (existsSync(indexPath_var)) {
    const currentAccountId_var = await getCurrentAccountId_func({ cliDir: options_var.cliDir });
    return currentAccountId_var ?? DEFAULT_ACCOUNT_NAME_var;
  }

  const authJsonPath_var = resolveLegacyAuthJsonPath_func(options_var.cliDir);
  if (!existsSync(authJsonPath_var)) {
    return DEFAULT_ACCOUNT_NAME_var;
  }

  try {
    const parsed_var = JSON.parse(readFileSync(authJsonPath_var, 'utf8')) as { activeAccountName?: string };
    return typeof parsed_var.activeAccountName === 'string' ? parsed_var.activeAccountName : DEFAULT_ACCOUNT_NAME_var;
  } catch {
    return DEFAULT_ACCOUNT_NAME_var;
  }
}

export async function setActiveAccountName_func(options_var: SetActiveAccountNameOptions): Promise<void> {
  const indexPath_var = resolveAccountsIndexPath_func(options_var.cliDir);
  if (existsSync(indexPath_var)) {
    await setCurrentAccountId_func({ cliDir: options_var.cliDir, accountId: options_var.accountName });
    return;
  }

  ensureDir_func(options_var.cliDir);
  writeJsonAtomic0600_func(resolveLegacyAuthJsonPath_func(options_var.cliDir), {
    version: 1,
    activeAccountName: options_var.accountName,
  });
}

export async function upsertAccount_func(options_var: UpsertAccountOptions): Promise<{
  account: AccountDetail;
  created: boolean;
}> {
  const nowTimestamp_var = options_var.nowTimestamp ?? Math.floor(Date.now() / 1000);
  const index_var = readAccountsIndex_func(options_var.cliDir);
  const normalizedEmail_var = options_var.email.trim().toLowerCase();
  const existingEntry_var = index_var.accounts.find(
    (account_var) => account_var.email.trim().toLowerCase() === normalizedEmail_var,
  );
  const existingDetail_var = existingEntry_var
    ? readAccountDetailSync_func(options_var.cliDir, existingEntry_var.id)
    : null;
  const accountId_var = existingEntry_var?.id ?? randomUUID();
  const accountStatus_var = options_var.accountStatus ?? defaultAccountStatus_func(options_var.token);

  const detail_var = createAccountDetail_func({
    id: accountId_var,
    email: options_var.email,
    name: options_var.name,
    token: options_var.token,
    accountStatus: accountStatus_var,
    accountStatusReason: options_var.accountStatusReason ?? null,
    nowTimestamp: nowTimestamp_var,
    existing: existingDetail_var,
  });

  const nextEntry_var: AccountIndexEntry = {
    id: accountId_var,
    email: options_var.email,
    name: options_var.name,
    created_at: existingEntry_var?.created_at ?? nowTimestamp_var,
    last_used: nowTimestamp_var,
  };

  const nextAccounts_var = index_var.accounts.filter((account_var) => account_var.id !== accountId_var);
  nextAccounts_var.push(nextEntry_var);
  nextAccounts_var.sort((left_var, right_var) => left_var.created_at - right_var.created_at);

  writeAccountDetail_func(options_var.cliDir, detail_var);
  writeAccountsIndex_func(options_var.cliDir, {
    version: ACCOUNTS_VERSION_var,
    current_account_id: index_var.current_account_id,
    accounts: nextAccounts_var,
  });

  return {
    account: detail_var,
    created: existingEntry_var === undefined,
  };
}

export async function discoverAccounts_func(options_var: DiscoverAccountsOptions): Promise<AccountInfo[]> {
  const indexPath_var = resolveAccountsIndexPath_func(options_var.cliDir);
  if (existsSync(indexPath_var)) {
    const accounts_var = await listAccounts_func({ cliDir: options_var.cliDir });
    if (accounts_var.length > 0) {
      return accounts_var.map((account_var) => ({
        name: account_var.id,
        userDataDirPath: options_var.defaultDataDir,
      }));
    }
  }

  const legacyAccounts_var: AccountInfo[] = [
    { name: DEFAULT_ACCOUNT_NAME_var, userDataDirPath: options_var.defaultDataDir },
  ];

  const userDataDir_var = path.join(options_var.cliDir, 'user-data');
  if (!existsSync(userDataDir_var)) {
    return legacyAccounts_var;
  }

  let entries_var: string[];
  try {
    entries_var = readdirSync(userDataDir_var);
  } catch {
    return legacyAccounts_var;
  }

  const managedAccounts_var: AccountInfo[] = [];
  for (const entry_var of entries_var) {
    if (!entry_var.startsWith('user-')) {
      continue;
    }

    const fullPath_var = path.join(userDataDir_var, entry_var);
    try {
      if (!statSync(fullPath_var).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }

    managedAccounts_var.push({
      name: entry_var,
      userDataDirPath: fullPath_var,
    });
  }

  managedAccounts_var.sort((left_var, right_var) => {
    const leftSuffix_var = parseUserSuffix_func(left_var.name);
    const rightSuffix_var = parseUserSuffix_func(right_var.name);
    if (leftSuffix_var !== null && rightSuffix_var !== null) {
      return leftSuffix_var - rightSuffix_var;
    }
    if (leftSuffix_var !== null) {
      return -1;
    }
    if (rightSuffix_var !== null) {
      return 1;
    }
    return left_var.name.localeCompare(right_var.name);
  });

  return [...legacyAccounts_var, ...managedAccounts_var];
}

export function getNextManagedAccountName_func(accounts_var: AccountInfo[]): string {
  const suffixes_var = new Set<number>();

  for (const account_var of accounts_var) {
    const suffix_var = parseUserSuffix_func(account_var.name);
    if (suffix_var !== null) {
      suffixes_var.add(suffix_var);
    }
  }

  let nextSuffix_var = 1;
  while (suffixes_var.has(nextSuffix_var)) {
    nextSuffix_var += 1;
  }

  return `user-${String(nextSuffix_var).padStart(2, '0')}`;
}
