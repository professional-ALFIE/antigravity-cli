/**
 * accounts.ts — 계정 발견, 활성 계정 관리.
 *
 * Phase 1 구현:
 * - default 계정: ~/Library/Application Support/Antigravity (이름: "default")
 * - managed 계정: ~/.antigravity-cli/user-data/user-* (디렉토리만)
 * - 활성 계정 persistence: ~/.antigravity-cli/auth.json
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';

import {
  discoverAccounts_func,
  getActiveAccountName_func,
  setActiveAccountName_func,
  getStateDbPath_func,
  getNextManagedAccountName_func,
  type AccountInfo,
} from './accounts.js';

// ──── 테스트용 임시 디렉토리 셋업 ────────────────────────────────

let testRoot: string;

beforeEach(() => {
  testRoot = mkdtempSync(path.join(tmpdir(), 'ag-accounts-'));
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

/**
 * 테스트용 환경 구성 헬퍼:
 * testRoot/default-data-dir = default account (~/Library/Application Support/Antigravity)
 * testRoot/cli-dir = ~/.antigravity-cli
 */
function setupTestEnv(opts: {
  hasDefaultDb?: boolean;
  managedAccounts?: string[]; // 예: ['user-01', 'user-02']
  activeAccountName?: string;
  authJsonCorrupted?: boolean;
  managedNonDir?: string[]; // 파일로만 생성 (디렉토리 아님)
} = {}): {
  defaultDataDir: string;
  cliDir: string;
  userDataDir: string;
  authJsonPath: string;
} {
  const defaultDataDir = path.join(testRoot, 'default-data-dir');
  const cliDir = path.join(testRoot, 'cli-dir');
  const userDataDir = path.join(cliDir, 'user-data');
  const authJsonPath = path.join(cliDir, 'auth.json');

  mkdirSync(path.join(defaultDataDir, 'User', 'globalStorage'), { recursive: true });
  if (opts.hasDefaultDb ?? true) {
    writeFileSync(path.join(defaultDataDir, 'User', 'globalStorage', 'state.vscdb'), '');
  }

  mkdirSync(userDataDir, { recursive: true });

  for (const name of opts.managedAccounts ?? []) {
    mkdirSync(path.join(userDataDir, name, 'User', 'globalStorage'), { recursive: true });
    writeFileSync(path.join(userDataDir, name, 'User', 'globalStorage', 'state.vscdb'), '');
  }

  for (const name of opts.managedNonDir ?? []) {
    writeFileSync(path.join(userDataDir, name), 'i-am-a-file');
  }

  if (opts.authJsonCorrupted) {
    writeFileSync(authJsonPath, '{{invalid json}}');
  } else if (opts.activeAccountName !== undefined) {
    writeFileSync(authJsonPath, JSON.stringify({ version: 1, activeAccountName: opts.activeAccountName }));
  }

  return { defaultDataDir, cliDir, userDataDir, authJsonPath };
}

// ──── discoverAccounts_func 테스트 ───────────────────────────────

describe('discoverAccounts_func', () => {
  test('1. default만 있는 경우', async () => {
    const { defaultDataDir, cliDir } = setupTestEnv();

    const accounts = await discoverAccounts_func({ defaultDataDir, cliDir });

    expect(accounts.length).toBe(1);
    expect(accounts[0].name).toBe('default');
    expect(accounts[0].userDataDirPath).toBe(defaultDataDir);
  });

  test('2. default + user-01 + user-02 발견', async () => {
    const { defaultDataDir, cliDir } = setupTestEnv({
      managedAccounts: ['user-01', 'user-02'],
    });

    const accounts = await discoverAccounts_func({ defaultDataDir, cliDir });

    expect(accounts.length).toBe(3);
    expect(accounts[0].name).toBe('default');
    expect(accounts[1].name).toBe('user-01');
    expect(accounts[2].name).toBe('user-02');
  });

  test('3. user-01, user-10, user-02 순서 정렬 (숫자 정렬)', async () => {
    const { defaultDataDir, cliDir } = setupTestEnv({
      managedAccounts: ['user-10', 'user-02', 'user-01'],
    });

    const accounts = await discoverAccounts_func({ defaultDataDir, cliDir });

    expect(accounts.map((a) => a.name)).toEqual(['default', 'user-01', 'user-02', 'user-10']);
  });

  test('4. user-data 디렉토리 없으면 managed 없이 default만', async () => {
    const { defaultDataDir, cliDir } = setupTestEnv();
    rmSync(path.join(cliDir, 'user-data'), { recursive: true, force: true });

    const accounts = await discoverAccounts_func({ defaultDataDir, cliDir });

    expect(accounts.length).toBe(1);
    expect(accounts[0].name).toBe('default');
  });

  test('5. user-data에 파일(비-디렉토리) user-* 있으면 무시', async () => {
    const { defaultDataDir, cliDir } = setupTestEnv({
      managedAccounts: ['user-01'],
      managedNonDir: ['user-99'],
    });

    const accounts = await discoverAccounts_func({ defaultDataDir, cliDir });

    const names = accounts.map((a) => a.name);
    expect(names).not.toContain('user-99');
    expect(names).toContain('user-01');
  });

  test('6. default dataDir 없어도 default 계정은 목록에 포함 (db 없이)', async () => {
    const { defaultDataDir, cliDir } = setupTestEnv({ hasDefaultDb: false });
    rmSync(defaultDataDir, { recursive: true, force: true });

    const accounts = await discoverAccounts_func({ defaultDataDir, cliDir });

    expect(accounts.find((a) => a.name === 'default')).toBeDefined();
  });
});

// ──── getActiveAccountName_func / setActiveAccountName_func 테스트 ─

describe('getActiveAccountName_func / setActiveAccountName_func', () => {
  test('1. auth.json 없으면 "default" fallback', async () => {
    const { cliDir } = setupTestEnv();
    // auth.json 생성 안 함

    const active = await getActiveAccountName_func({ cliDir });
    expect(active).toBe('default');
  });

  test('2. auth.json에서 activeAccountName 정상 읽기', async () => {
    const { cliDir } = setupTestEnv({ activeAccountName: 'user-01' });

    const active = await getActiveAccountName_func({ cliDir });
    expect(active).toBe('user-01');
  });

  test('3. auth.json 손상됨 → "default" fallback (no throw)', async () => {
    const { cliDir } = setupTestEnv({ authJsonCorrupted: true });

    const active = await getActiveAccountName_func({ cliDir });
    expect(active).toBe('default');
  });

  test('4. setActiveAccountName_func → auth.json 쓰기 + 읽기 검증', async () => {
    const { cliDir } = setupTestEnv();

    await setActiveAccountName_func({ cliDir, accountName: 'user-02' });

    const active = await getActiveAccountName_func({ cliDir });
    expect(active).toBe('user-02');
  });

  test('5. 활성 계정이 discovered 목록에 없으면 "default" fallback', async () => {
    const { defaultDataDir, cliDir } = setupTestEnv({ activeAccountName: 'user-99' });

    const accounts = await discoverAccounts_func({ defaultDataDir, cliDir });
    const activeRaw = await getActiveAccountName_func({ cliDir });
    // user-99가 discoverd 목록에 없으면 → caller 레이어의 fallback
    const finalActive = accounts.some((a) => a.name === activeRaw) ? activeRaw : 'default';
    expect(finalActive).toBe('default');
  });
});

// ──── getStateDbPath_func / getNextManagedAccountName_func 테스트 ─

describe('getStateDbPath_func', () => {
  test('default 계정 stateDbPath', () => {
    const { defaultDataDir } = setupTestEnv();
    const dbPath = getStateDbPath_func({ userDataDirPath: defaultDataDir });
    expect(dbPath).toBe(path.join(defaultDataDir, 'User', 'globalStorage', 'state.vscdb'));
  });

  test('managed 계정 stateDbPath', () => {
    const { userDataDir } = setupTestEnv({ managedAccounts: ['user-01'] });
    const accountDirPath = path.join(userDataDir, 'user-01');
    const dbPath = getStateDbPath_func({ userDataDirPath: accountDirPath });
    expect(dbPath).toBe(path.join(accountDirPath, 'User', 'globalStorage', 'state.vscdb'));
  });
});

describe('getNextManagedAccountName_func', () => {
  test('1. 기존 계정 없으면 user-01', async () => {
    const { defaultDataDir, cliDir } = setupTestEnv();

    const accounts = await discoverAccounts_func({ defaultDataDir, cliDir });
    const next = getNextManagedAccountName_func(accounts);
    expect(next).toBe('user-01');
  });

  test('2. user-01 있으면 user-02', async () => {
    const { defaultDataDir, cliDir } = setupTestEnv({ managedAccounts: ['user-01'] });

    const accounts = await discoverAccounts_func({ defaultDataDir, cliDir });
    const next = getNextManagedAccountName_func(accounts);
    expect(next).toBe('user-02');
  });

  test('3. user-01, user-03 있으면 user-02 (hole fill)', async () => {
    const { defaultDataDir, cliDir } = setupTestEnv({ managedAccounts: ['user-01', 'user-03'] });

    const accounts = await discoverAccounts_func({ defaultDataDir, cliDir });
    const next = getNextManagedAccountName_func(accounts);
    expect(next).toBe('user-02');
  });

  test('4. user-01~10 연속이면 user-11', async () => {
    const names = Array.from({ length: 10 }, (_, i) => `user-${String(i + 1).padStart(2, '0')}`);
    const { defaultDataDir, cliDir } = setupTestEnv({ managedAccounts: names });

    const accounts = await discoverAccounts_func({ defaultDataDir, cliDir });
    const next = getNextManagedAccountName_func(accounts);
    expect(next).toBe('user-11');
  });
});
