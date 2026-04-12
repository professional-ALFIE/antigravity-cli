/**
 * accounts.ts — 계정 발견, 활성 계정 관리.
 *
 * Phase 1:
 * - default 계정: ~/Library/Application Support/Antigravity (이름: "default")
 * - managed 계정: ~/.antigravity-cli/user-data/user-* (디렉토리만)
 * - 활성 계정 persistence: ~/.antigravity-cli/auth.json
 */

import { existsSync, readdirSync, statSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ─── 상수 ──────────────────────────────────────────────────────

const DEFAULT_ACCOUNT_NAME = 'default';
const AUTH_JSON_VERSION = 1;

// ─── 타입 ──────────────────────────────────────────────────────

export interface AccountInfo {
  /** 계정 이름: "default" 또는 "user-01" 등 */
  name: string;
  /** 계정의 user-data-dir 절대 경로 (Antigravity --user-data-dir 인자로 전달하는 경로) */
  userDataDirPath: string;
}

interface AuthJson {
  version: number;
  activeAccountName: string;
}

interface DiscoverAccountsOptions {
  /** ~/Library/Application Support/Antigravity */
  defaultDataDir: string;
  /** ~/.antigravity-cli */
  cliDir: string;
}

interface GetActiveAccountNameOptions {
  cliDir: string;
}

interface SetActiveAccountNameOptions {
  cliDir: string;
  accountName: string;
}

interface GetStateDbPathOptions {
  userDataDirPath: string;
}

// ─── 경로 헬퍼 ────────────────────────────────────────────────

/**
 * 계정의 state.vscdb 절대 경로를 반환한다.
 * 규칙: {userDataDirPath}/User/globalStorage/state.vscdb
 */
export function getStateDbPath_func(options_var: GetStateDbPathOptions): string {
  return path.join(options_var.userDataDirPath, 'User', 'globalStorage', 'state.vscdb');
}

/**
 * 기본 defaultDataDir 경로 (macOS).
 * ~/Library/Application Support/Antigravity
 */
export function getDefaultDataDir_func(): string {
  return path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity');
}

/**
 * 기본 cliDir 경로.
 * ~/.antigravity-cli
 */
export function getDefaultCliDir_func(): string {
  return path.join(os.homedir(), '.antigravity-cli');
}

// ─── 계정 발견 ────────────────────────────────────────────────

/**
 * 계정 목록을 발견한다.
 * 1. default: defaultDataDir → name="default"
 * 2. managed: cliDir/user-data/user-* (디렉토리만) → 숫자 정렬
 */
export async function discoverAccounts_func(options_var: DiscoverAccountsOptions): Promise<AccountInfo[]> {
  const accounts_var: AccountInfo[] = [
    { name: DEFAULT_ACCOUNT_NAME, userDataDirPath: options_var.defaultDataDir },
  ];

  const user_data_dir_var = path.join(options_var.cliDir, 'user-data');
  if (!existsSync(user_data_dir_var)) {
    return accounts_var;
  }

  let entries_var: string[];
  try {
    entries_var = readdirSync(user_data_dir_var);
  } catch {
    return accounts_var;
  }

  const managed_var: AccountInfo[] = [];
  for (const entry_var of entries_var) {
    if (!entry_var.startsWith('user-')) continue;

    const full_path_var = path.join(user_data_dir_var, entry_var);
    try {
      const stat_var = statSync(full_path_var);
      if (!stat_var.isDirectory()) continue;
    } catch {
      continue;
    }

    managed_var.push({ name: entry_var, userDataDirPath: full_path_var });
  }

  // 숫자 suffix 정렬: user-01 < user-02 < user-10 < user-nosuffix (lexical fallback)
  managed_var.sort((a_var, b_var) => {
    const an_var = parseUserSuffix_func(a_var.name);
    const bn_var = parseUserSuffix_func(b_var.name);
    if (an_var !== null && bn_var !== null) return an_var - bn_var;
    if (an_var !== null) return -1;
    if (bn_var !== null) return 1;
    return a_var.name.localeCompare(b_var.name);
  });

  return [...accounts_var, ...managed_var];
}

function parseUserSuffix_func(name_var: string): number | null {
  const match_var = name_var.match(/^user-(\d+)$/);
  if (!match_var) return null;
  return parseInt(match_var[1], 10);
}

// ─── 활성 계정 ────────────────────────────────────────────────

function resolveAuthJsonPath_func(cli_dir_var: string): string {
  return path.join(cli_dir_var, 'auth.json');
}

/**
 * 현재 활성 계정 이름을 반환한다.
 * auth.json 없음 / 손상됨 → "default" fallback (no throw)
 */
export async function getActiveAccountName_func(options_var: GetActiveAccountNameOptions): Promise<string> {
  const auth_json_path_var = resolveAuthJsonPath_func(options_var.cliDir);

  if (!existsSync(auth_json_path_var)) {
    return DEFAULT_ACCOUNT_NAME;
  }

  try {
    const raw_var = readFileSync(auth_json_path_var, 'utf8');
    const parsed_var = JSON.parse(raw_var) as Partial<AuthJson>;
    return typeof parsed_var.activeAccountName === 'string'
      ? parsed_var.activeAccountName
      : DEFAULT_ACCOUNT_NAME;
  } catch {
    return DEFAULT_ACCOUNT_NAME;
  }
}

/**
 * 활성 계정 이름을 auth.json에 쓴다.
 */
export async function setActiveAccountName_func(options_var: SetActiveAccountNameOptions): Promise<void> {
  const auth_json_path_var = resolveAuthJsonPath_func(options_var.cliDir);

  // cliDir이 없으면 생성
  mkdirSync(options_var.cliDir, { recursive: true });

  const auth_json_var: AuthJson = {
    version: AUTH_JSON_VERSION,
    activeAccountName: options_var.accountName,
  };
  writeFileSync(auth_json_path_var, JSON.stringify(auth_json_var, null, 2) + '\n', 'utf8');
}

// ─── 다음 managed 계정 이름 ───────────────────────────────────

/**
 * 현재 계정 목록에서 다음 managed 계정 이름을 결정한다.
 * hole-fill: user-01, user-03 있으면 → user-02 반환.
 * 연속이면 마지막+1.
 */
export function getNextManagedAccountName_func(accounts_var: AccountInfo[]): string {
  const existing_suffixes_var = new Set<number>();

  for (const account_var of accounts_var) {
    const n_var = parseUserSuffix_func(account_var.name);
    if (n_var !== null) existing_suffixes_var.add(n_var);
  }

  let i_var = 1;
  while (existing_suffixes_var.has(i_var)) {
    i_var += 1;
  }

  return `user-${String(i_var).padStart(2, '0')}`;
}
