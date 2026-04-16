/**
 * authList.ts — `agcl auth list` 출력 및 선택 로직.
 *
 * 플랜 §Step 4:
 * - discoverAccounts 호출
 * - 각 계정 stateVscdb 파싱
 * - TTY/non-TTY 렌더링
 * - JSON 출력
 */

import { describe, test, expect } from 'bun:test';
import {
  formatQuotaProgressBar_func,
  buildAuthListRows_func,
  buildParseResultFromQuotaCache_func,
  renderAuthListText_func,
  type AuthListRow,
  type ModelFamilySummaryDisplay,
} from './authList.js';

// ──── formatQuotaProgressBar_func (플랜 §Progress bar rendering rule) ─

describe('formatQuotaProgressBar_func', () => {
  test('1. remainingPercentage=null → [--------] ??%', () => {
    expect(formatQuotaProgressBar_func({ remainingPercentage: null, resetTime: null, isStale: false }))
      .toBe('[--------] ??%');
  });

  test('2. remainingPercentage=100 → ██████████ 99%', () => {
    expect(formatQuotaProgressBar_func({ remainingPercentage: 100, resetTime: null, isStale: false }))
      .toBe('██████████ 99%');
  });

  test('3. isStale=true → ██████████ 99% (stale clamp)', () => {
    expect(formatQuotaProgressBar_func({ remainingPercentage: 60, resetTime: null, isStale: true }))
      .toBe('██████████ 99%');
  });

  test('4. remainingPercentage=0 → ░░░░░░░░░░ 00%', () => {
    expect(formatQuotaProgressBar_func({ remainingPercentage: 0, resetTime: null, isStale: false }))
      .toBe('░░░░░░░░░░ 00%');
  });

  test('5. 87% → ████████░░ 87%', () => {
    expect(formatQuotaProgressBar_func({ remainingPercentage: 87, resetTime: null, isStale: false }))
      .toBe('████████░░ 87%');
  });

  test('6. 23% → ██░░░░░░░░ 23%', () => {
    expect(formatQuotaProgressBar_func({ remainingPercentage: 23, resetTime: null, isStale: false }))
      .toBe('██░░░░░░░░ 23%');
  });

  test('7. 50% → █████░░░░░ 50%', () => {
    expect(formatQuotaProgressBar_func({ remainingPercentage: 50, resetTime: null, isStale: false }))
      .toBe('█████░░░░░ 50%');
  });

  test('8. 10% → █░░░░░░░░░ 10%', () => {
    expect(formatQuotaProgressBar_func({ remainingPercentage: 10, resetTime: null, isStale: false }))
      .toBe('█░░░░░░░░░ 10%');
  });

  test('9. 5% → floor(0.5)=0 filled → ░░░░░░░░░░ 05%', () => {
    expect(formatQuotaProgressBar_func({ remainingPercentage: 5, resetTime: null, isStale: false }))
      .toBe('░░░░░░░░░░ 05%');
  });
});

// ──── buildAuthListRows_func ──────────────────────────────────────

describe('buildAuthListRows_func', () => {
  const nowIso = new Date(Date.now() + 3600_000).toISOString(); // 1시간 후

  test('1. 정상 파싱된 계정', () => {
    const rows = buildAuthListRows_func({
      accounts: [
        {
          name: 'default',
          userDataDirPath: '/default',
          parseResult: {
            email: 'user@gmail.com',
            userTierId: 'g1-ultra-tier',
            userTierName: 'Google AI Ultra',
            familyQuotaSummaries: [
              { familyName: 'GEMINI', remainingPercentage: 87, exhausted: false, resetTime: nowIso },
              { familyName: 'CLAUDE', remainingPercentage: 23, exhausted: false, resetTime: nowIso },
            ],
          },
        },
      ],
      activeAccountName: 'default',
      now: new Date(),
    });

    expect(rows.length).toBe(1);
    expect(rows[0].active).toBe(true);
    expect(rows[0].index).toBe(1);
    expect(rows[0].name).toBe('default');
    expect(rows[0].emailDisplay).toBe('user (Ultra)');
    const gemini = rows[0].familySummaries.find((f) => f.familyName === 'GEMINI');
    expect(gemini).toBeDefined();
    expect(gemini!.progressBar).toBe('████████░░ 87%');
  });

  test('2. parseResult=null → 모든 컬럼 "-"', () => {
    const rows = buildAuthListRows_func({
      accounts: [
        { name: 'user-01', userDataDirPath: '/u1', parseResult: null },
      ],
      activeAccountName: 'default',
      now: new Date(),
    });

    expect(rows[0].emailDisplay).toBe('-');
    expect(rows[0].familySummaries).toEqual([]);
  });

  test('3. 여러 계정 — index 순서 정확', () => {
    const rows = buildAuthListRows_func({
      accounts: [
        { name: 'default', userDataDirPath: '/d', parseResult: null },
        { name: 'user-01', userDataDirPath: '/u1', parseResult: null },
        { name: 'user-02', userDataDirPath: '/u2', parseResult: null },
      ],
      activeAccountName: 'user-01',
      now: new Date(),
    });

    expect(rows[0].active).toBe(false);
    expect(rows[1].active).toBe(true);
    expect(rows.map((r) => r.index)).toEqual([1, 2, 3]);
  });

  test('4. 이미 stale resetTime → isStale=true → ██████████ 99%', () => {
    const pastIso = new Date(Date.now() - 1000).toISOString(); // 1초 전 (이미 지남)
    const rows = buildAuthListRows_func({
      accounts: [
        {
          name: 'default',
          userDataDirPath: '/d',
          parseResult: {
            email: 'x@x.com',
            userTierId: null,
            userTierName: null,
            familyQuotaSummaries: [
              { familyName: 'GEMINI', remainingPercentage: 60, exhausted: false, resetTime: pastIso },
            ],
          },
        },
      ],
      activeAccountName: 'default',
      now: new Date(),
    });

    const gemini = rows[0].familySummaries.find((f) => f.familyName === 'GEMINI');
    expect(gemini!.progressBar).toBe('██████████ 99%');
  });

  test('5. g1-ultra-tier → "Ultra" tier suffix', () => {
    const rows = buildAuthListRows_func({
      accounts: [
        {
          name: 'default',
          userDataDirPath: '/d',
          parseResult: {
            email: 'u@x.com',
            userTierId: 'g1-ultra-tier',
            userTierName: 'Google AI Ultra',
            familyQuotaSummaries: [],
          },
        },
      ],
      activeAccountName: 'default',
      now: new Date(),
    });
    expect(rows[0].emailDisplay).toBe('u (Ultra)');
  });

  test('6. g1-pro-tier → "Pro" tier suffix', () => {
    const rows = buildAuthListRows_func({
      accounts: [
        {
          name: 'default',
          userDataDirPath: '/d',
          parseResult: {
            email: 'u@x.com',
            userTierId: 'g1-pro-tier',
            userTierName: null,
            familyQuotaSummaries: [],
          },
        },
      ],
      activeAccountName: 'default',
      now: new Date(),
    });
    expect(rows[0].emailDisplay).toBe('u (Pro)');
  });

  test('7. forbidden 계정은 emailDisplay에 [FORBIDDEN] 마크를 표시한다', () => {
    const rows = buildAuthListRows_func({
      accounts: [
        {
          name: 'user-01',
          userDataDirPath: '/u1',
          parseResult: {
            email: 'user@example.com',
            userTierId: 'g1-pro-tier',
            userTierName: null,
            familyQuotaSummaries: [],
            accountStatus: 'forbidden',
          },
        },
      ],
      activeAccountName: 'user-01',
      now: new Date(),
    });

    expect(rows[0].emailDisplay).toContain('[FORBIDDEN]');
  });
});

describe('buildParseResultFromQuotaCache_func', () => {
  test('maps quota cache into auth list parse result shape', () => {
    const result_var = buildParseResultFromQuotaCache_func({
      email: 'user@example.com',
      subscriptionTier: 'g1-pro-tier',
      families: {
        GEMINI: {
          remaining_pct: 45,
          reset_time: '2026-04-16T10:00:00Z',
        },
      },
      accountStatus: 'active',
    });

    expect(result_var.email).toBe('user@example.com');
    expect(result_var.userTierId).toBe('g1-pro-tier');
    expect(result_var.familyQuotaSummaries).toEqual([
      {
        familyName: 'GEMINI',
        remainingPercentage: 45,
        exhausted: false,
        resetTime: '2026-04-16T10:00:00Z',
      },
    ]);
  });
});

// ──── renderAuthListText_func ─────────────────────────────────────

describe('renderAuthListText_func', () => {
  test('1. active 계정에 * 표시', () => {
    const rows: AuthListRow[] = [
      {
        active: true,
        index: 1,
        name: 'default',
        emailDisplay: 'user@gmail.com (Ultra)',
        familySummaries: [],
      },
    ];

    const text = renderAuthListText_func({ rows });
    expect(text).toContain('*');
    expect(text).toContain('#');
    expect(text).toContain('1');
    expect(text).toContain('user@gmail.com');
  });

  test('2. 비활성 계정에 공백 표시', () => {
    const rows: AuthListRow[] = [
      { active: false, index: 1, name: 'user-01', emailDisplay: '-', familySummaries: [] },
    ];

    const text = renderAuthListText_func({ rows });
    expect(text).not.toContain('*  1');
    expect(text).toContain('  1  -');
  });

  test('3. family quota 표시', () => {
    const rows: AuthListRow[] = [
      {
        active: true,
        index: 1,
        name: 'default',
        emailDisplay: 'u@x.com',
        familySummaries: [
          { familyName: 'GEMINI', progressBar: '████████░░ 87%', resetDisplay: '4h 53m' },
          { familyName: 'CLAUDE', progressBar: '██░░░░░░░░ 23%', resetDisplay: '0h 28m' },
        ],
      },
    ];

    const text = renderAuthListText_func({ rows });
    expect(text).toContain('GEMINI');
    expect(text).toContain('████████░░ 87%');
    expect(text).toContain('4h 53m');
    expect(text).toContain('CLAUDE');
    expect(text).toContain('██░░░░░░░░ 23%');
  });
});
