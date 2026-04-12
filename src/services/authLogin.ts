/**
 * authLogin.ts — `agcl auth login` 실행.
 *
 * 플랜 §Step 7:
 * 1. discoverAccounts → getNextManagedAccountName
 * 2. managed dir 생성
 * 3. open -n -a Antigravity --args --user-data-dir=<abs>
 * 4. poll for state.vscdb + uss-oauth + uss-enterprisePreferences
 * 5. 성공 시 setActiveAccountName
 */

import { existsSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';

import {
  discoverAccounts_func,
  getNextManagedAccountName_func,
  setActiveAccountName_func,
  getStateDbPath_func,
  getDefaultCliDir_func,
  getDefaultDataDir_func,
} from './accounts.js';
import { StateDbReader } from './stateVscdb.js';

// ─── 상수 ──────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 120_000; // 2분
const DEFAULT_POLL_INTERVAL_MS = 1_000;

// open 명령어가 LS 기동을 기다리는 시간 (Antigravity가 떠서 DB 생성할 때까지)
const REQUIRED_TOPICS = ['uss-oauth', 'uss-enterprisePreferences'] as const;

// ─── 타입 ──────────────────────────────────────────────────────

export type AuthLoginResult =
  | { status: 'success'; accountName: string }
  | { status: 'timeout'; accountName: string }
  | { status: 'cancelled'; accountName: string }
  | { status: 'open_failed'; accountName: string; message: string };

export interface AuthLoginOptions {
  /** ~/.antigravity-cli 경로 override (테스트용) */
  cliDir?: string;
  /** ~/Library/Application Support/Antigravity 경로 override (테스트용) */
  defaultDataDir?: string;
  /** poll timeout ms (기본 120_000) */
  timeoutMs?: number;
  /** poll interval ms (기본 1_000) */
  pollIntervalMs?: number;
  /** signal for cancellation */
  signal?: AbortSignal;
  openApp?: (userDataDirPath: string) => Promise<void>;
}

// ─── 내부 헬퍼 ───────────────────────────────────────────────

async function sleep_func(ms_var: number): Promise<void> {
  return new Promise((resolve_var) => setTimeout(resolve_var, ms_var));
}

async function checkTopicsReady_func(state_db_path_var: string): Promise<boolean> {
  if (!existsSync(state_db_path_var)) return false;

  const reader_var = new StateDbReader(state_db_path_var);
  try {
    for (const topic_var of REQUIRED_TOPICS) {
      const bytes_var = await reader_var.getTopicBytes(topic_var as Parameters<typeof reader_var.getTopicBytes>[0]);
      if (!bytes_var || bytes_var.length === 0) return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    await reader_var.close();
  }
}

function openAntigravityApp_func(user_data_dir_var: string): Promise<void> {
  return new Promise((resolve_var, reject_var) => {
    execFile(
      'open',
      ['-n', '-a', 'Antigravity', '--args', `--user-data-dir=${user_data_dir_var}`],
      (error_var) => {
        if (error_var) {
          reject_var(error_var);
        } else {
          resolve_var();
        }
      },
    );
  });
}

// ─── authLogin_func ───────────────────────────────────────────

/**
 * 새 managed 계정을 추가하고 Antigravity 앱을 열어 로그인을 완료하도록 안내한다.
 * 성공 시 해당 계정을 active로 저장한다.
 */
export async function authLogin_func(options_var: AuthLoginOptions = {}): Promise<AuthLoginResult> {
  const cli_dir_var = options_var.cliDir ?? getDefaultCliDir_func();
  const default_data_dir_var = options_var.defaultDataDir ?? getDefaultDataDir_func();
  const timeout_ms_var = options_var.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const poll_interval_ms_var = options_var.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const open_app_var = options_var.openApp ?? openAntigravityApp_func;

  // 1. 다음 managed 계정 이름 결정
  const accounts_var = await discoverAccounts_func({ defaultDataDir: default_data_dir_var, cliDir: cli_dir_var });
  const account_name_var = getNextManagedAccountName_func(accounts_var);

  // 2. managed dir 생성
  const user_data_dir_var = path.join(cli_dir_var, 'user-data', account_name_var);
  mkdirSync(user_data_dir_var, { recursive: true });

  const state_db_path_var = getStateDbPath_func({ userDataDirPath: user_data_dir_var });

  // 3. open 실행
  try {
    await open_app_var(user_data_dir_var);
  } catch (error_var) {
    return {
      status: 'open_failed',
      accountName: account_name_var,
      message: error_var instanceof Error ? error_var.message : String(error_var),
    };
  }

  // 4. poll for DB readiness
  const deadline_var = Date.now() + timeout_ms_var;

  while (Date.now() < deadline_var) {
    // cancellation check
    if (options_var.signal?.aborted) {
      return { status: 'cancelled', accountName: account_name_var };
    }

    const ready_var = await checkTopicsReady_func(state_db_path_var);
    if (ready_var) {
      // 5. 성공 → active account 전환
      await setActiveAccountName_func({ cliDir: cli_dir_var, accountName: account_name_var });
      return { status: 'success', accountName: account_name_var };
    }

    await sleep_func(poll_interval_ms_var);
  }

  return { status: 'timeout', accountName: account_name_var };
}
