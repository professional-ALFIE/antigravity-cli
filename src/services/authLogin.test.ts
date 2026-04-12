/**
 * authLogin.test.ts — authLogin_func 단위 테스트.
 *
 * openApp을 mock하여 외부 의존성 제거.
 * state.vscdb readiness는 가짜 DB 파일로 시뮬레이션.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { authLogin_func } from './authLogin.js';
import { TOPIC_STORAGE_KEYS } from './stateVscdb.js';

// ──── 임시 환경 셋업 ─────────────────────────────────────────

let testRoot: string;

beforeEach(() => {
  testRoot = mkdtempSync(path.join(tmpdir(), 'ag-login-'));
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function makeCliDir(): string {
  const p = path.join(testRoot, 'cli');
  mkdirSync(p, { recursive: true });
  return p;
}

function makeDefaultDataDir(): string {
  const p = path.join(testRoot, 'default');
  mkdirSync(path.join(p, 'User', 'globalStorage'), { recursive: true });
  return p;
}

/**
 * 가짜 state.vscdb 생성 (두 necessary topic 포함).
 * 실제 DB 대신 mock-ready 파일: StateDbReader.getTopicBytes가 항상 성공하도록
 * 실제 컴포넌트를 우회하는 방법으로, readiness check를 직접 시뮬레이션한다.
 *
 * authLogin_func의 checkTopicsReady_func를 우회하기 위해:
 * agcl 옵션에 readiness mock을 제공하지 않는다.
 * 대신 실제 createStateDb로 minimal DB를 만들어 통합 테스트한다.
 */
async function createMinimalStateDb(dbPath_var: string): Promise<void> {
  const dir_var = path.dirname(dbPath_var);
  mkdirSync(dir_var, { recursive: true });

  const module_var = await import('sql.js');
  const initSqlJs = (module_var.default ?? module_var) as (opts?: object) => Promise<{
    Database: new () => {
      run(sql: string, params?: unknown[]): void;
      export(): Uint8Array;
      close(): void;
    };
  }>;

  const sql_var = await initSqlJs({});
  const db_var = new sql_var.Database();
  db_var.run("CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)");

  // uss-oauth, uss-enterprisePreferences 최소 bytes (비어있지 않음)
  const min_bytes_var = Buffer.from('AAAAAA==', 'base64').toString('base64');
  for (const topic_var of ['uss-oauth', 'uss-enterprisePreferences'] as const) {
    db_var.run("INSERT INTO ItemTable (key, value) VALUES (?, ?)", [
      TOPIC_STORAGE_KEYS[topic_var],
      min_bytes_var,
    ]);
  }
  writeFileSync(dbPath_var, Buffer.from(db_var.export()));
  db_var.close();
}

// ──── 테스트 ─────────────────────────────────────────────────

describe('authLogin_func', () => {
  test('1. open_failed — open mock에서 에러 발생', async () => {
    const cliDir = makeCliDir();
    const defaultDataDir = makeDefaultDataDir();

    const result = await authLogin_func({
      cliDir,
      defaultDataDir,
      timeoutMs: 1000,
      pollIntervalMs: 100,
      openApp: async () => {
        throw new Error('app not found');
      },
    });

    expect(result.status).toBe('open_failed');
    expect((result as { message: string }).message).toContain('app not found');
    expect(result.accountName).toBe('user-01');
  });

  test('2. success — open 성공 + DB 즉시 준비됨', async () => {
    const cliDir = makeCliDir();
    const defaultDataDir = makeDefaultDataDir();

    const result = await authLogin_func({
      cliDir,
      defaultDataDir,
      timeoutMs: 5000,
      pollIntervalMs: 50,
      openApp: async (userDataDir_var) => {
        // DB를 즉시 생성해서 ready 상태로 만든다
        const dbPath_var = path.join(userDataDir_var, 'User', 'globalStorage', 'state.vscdb');
        await createMinimalStateDb(dbPath_var);
      },
    });

    expect(result.status).toBe('success');
    expect(result.accountName).toBe('user-01');
  });

  test('3. success — active account 전환됨', async () => {
    const cliDir = makeCliDir();
    const defaultDataDir = makeDefaultDataDir();
    const { getActiveAccountName_func } = await import('./accounts.js');

    const result = await authLogin_func({
      cliDir,
      defaultDataDir,
      timeoutMs: 5000,
      pollIntervalMs: 50,
      openApp: async (userDataDir_var) => {
        const dbPath_var = path.join(userDataDir_var, 'User', 'globalStorage', 'state.vscdb');
        await createMinimalStateDb(dbPath_var);
      },
    });

    expect(result.status).toBe('success');
    const active = await getActiveAccountName_func({ cliDir });
    expect(active).toBe('user-01');
  });

  test('4. timeout — DB가 끝까지 준비되지 않음', async () => {
    const cliDir = makeCliDir();
    const defaultDataDir = makeDefaultDataDir();

    const result = await authLogin_func({
      cliDir,
      defaultDataDir,
      timeoutMs: 200,  // 매우 짧은 timeout
      pollIntervalMs: 50,
      openApp: async () => {
        // DB 생성 안 함 → timeout 발생
      },
    });

    expect(result.status).toBe('timeout');
    expect(result.accountName).toBe('user-01');
  });

  test('5. cancelled — signal abort', async () => {
    const cliDir = makeCliDir();
    const defaultDataDir = makeDefaultDataDir();
    const controller = new AbortController();

    const loginPromise = authLogin_func({
      cliDir,
      defaultDataDir,
      timeoutMs: 5000,
      pollIntervalMs: 50,
      signal: controller.signal,
      openApp: async () => {
        // DB 생성 안 함 → abort 기다림
      },
    });

    // 150ms 후 abort
    setTimeout(() => controller.abort(), 150);

    const result = await loginPromise;
    expect(result.status).toBe('cancelled');
  });

  test('6. user-01 이미 있으면 user-02 생성', async () => {
    const cliDir = makeCliDir();
    const defaultDataDir = makeDefaultDataDir();

    // user-01 디렉토리 미리 생성
    mkdirSync(path.join(cliDir, 'user-data', 'user-01', 'User', 'globalStorage'), { recursive: true });

    const result = await authLogin_func({
      cliDir,
      defaultDataDir,
      timeoutMs: 200,
      pollIntervalMs: 50,
      openApp: async () => { /* timeout */ },
    });

    expect(result.accountName).toBe('user-02');
  });
});
