/**
 * authList.ts — `agcl auth list` 렌더링 및 데이터 컴포지션.
 *
 * 플랜 §Step 4:
 * - progress bar 공식: 10 cells, █ = remaining, ░ = used
 * - TTY: 선택 프롬프트 (별도 entrypoint에서 readline 사용)
 * - non-TTY / JSON: 그냥 출력
 */

import type { AccountInfo } from './accounts.js';
import type { UserStatusSummary, ModelFamilyQuotaSummary } from './stateVscdb.js';

// ─── 타입 ──────────────────────────────────────────────────────

export interface ModelFamilySummaryDisplay {
  familyName: string;
  progressBar: string;
  /** "Xh Ym" 형식. reset 없으면 null. */
  resetDisplay: string | null;
}

export interface AuthListRow {
  active: boolean;
  index: number;
  name: string;
  /** "user@example.com (Tier)" 또는 "-" */
  emailDisplay: string;
  familySummaries: ModelFamilySummaryDisplay[];
}

interface ParseResultLike {
  email: string;
  userTierId: string | null;
  userTierName: string | null;
  familyQuotaSummaries: ModelFamilyQuotaSummary[];
  accountStatus?: string | null;
}

export function buildParseResultFromQuotaCache_func(options_var: {
  email: string;
  subscriptionTier: string | null;
  families: Record<string, {
    remaining_pct: number | null;
    reset_time: string | null;
  }>;
  accountStatus: string | null;
}): ParseResultLike {
  return {
    email: options_var.email,
    userTierId: options_var.subscriptionTier,
    userTierName: options_var.subscriptionTier,
    familyQuotaSummaries: Object.entries(options_var.families).map(([familyName_var, family_var]) => ({
      familyName: familyName_var,
      remainingPercentage: family_var.remaining_pct,
      exhausted: family_var.remaining_pct === 0,
      resetTime: family_var.reset_time,
    })),
    accountStatus: options_var.accountStatus,
  };
}

interface AccountWithParseResult {
  name: string;
  userDataDirPath: string;
  parseResult: ParseResultLike | null;
}

interface BuildAuthListRowsOptions {
  accounts: AccountWithParseResult[];
  activeAccountName: string;
  now: Date;
}

interface FormatQuotaProgressBarOptions {
  remainingPercentage: number | null;
  resetTime: string | null;
  isStale: boolean;
}

interface RenderAuthListTextOptions {
  rows: AuthListRow[];
}

// ─── Progress Bar 렌더링 ───────────────────────────────────────

const FILLED_CELL = '█';
const EMPTY_CELL = '░';
const TOTAL_CELLS = 10;

/**
 * 플랜 §Progress bar rendering rule.
 * 우선순위 (first match wins):
 * 1. unknown → [--------] ??%
 * 2. pct >= 100 → ██████████ 99%
 * 3. isStale → ██████████ 99%
 * 4. pct <= 0 → ░░░░░░░░░░ 00%
 * 5. otherwise → filled = floor(pct/10), display = round(pct)
 */
export function formatQuotaProgressBar_func(options_var: FormatQuotaProgressBarOptions): string {
  const { remainingPercentage: pct_var, isStale: is_stale_var } = options_var;

  if (pct_var === null) {
    return '[--------] ??%';
  }

  if (pct_var >= 100) {
    return `${FILLED_CELL.repeat(TOTAL_CELLS)} 99%`;
  }

  if (is_stale_var) {
    return `${FILLED_CELL.repeat(TOTAL_CELLS)} 99%`;
  }

  if (pct_var <= 0) {
    return `${EMPTY_CELL.repeat(TOTAL_CELLS)} 00%`;
  }

  const filled_cells_var = Math.floor(pct_var / 10);
  const empty_cells_var = TOTAL_CELLS - filled_cells_var;
  const display_pct_var = String(Math.round(pct_var)).padStart(2, '0');
  return `${FILLED_CELL.repeat(filled_cells_var)}${EMPTY_CELL.repeat(empty_cells_var)} ${display_pct_var}%`;
}

// ─── Tier suffix 변환 ─────────────────────────────────────────

function resolveTierSuffix_func(user_tier_id_var: string | null, user_tier_name_var: string | null): string | null {
  const source_var = (user_tier_name_var ?? user_tier_id_var ?? '').toLowerCase();
  if (source_var.includes('ultra')) return 'Ultra';
  if (source_var.includes('pro')) return 'Pro';
  if (source_var.includes('free') || source_var.includes('basic')) return 'Free';
  return null;
}

// ─── Reset time 표시 ─────────────────────────────────────────

function formatResetDisplay_func(reset_time_var: string | null, now_var: Date): string | null {
  if (!reset_time_var) return null;

  const reset_date_var = new Date(reset_time_var);
  const diff_ms_var = reset_date_var.getTime() - now_var.getTime();
  if (diff_ms_var <= 0) return null;

  const diff_seconds_var = Math.floor(diff_ms_var / 1000);
  const hours_var = Math.floor(diff_seconds_var / 3600);
  const minutes_var = Math.floor((diff_seconds_var % 3600) / 60);
  return `${hours_var}h ${String(minutes_var).padStart(2, '0')}m`;
}

// ─── buildAuthListRows_func ───────────────────────────────────

/**
 * 계정 목록에서 AuthListRow[]를 생성한다.
 * - parseResult null → emailDisplay="-", familySummaries=[]
 * - isStale: resetTime <= now → stale clamp
 */
export function buildAuthListRows_func(options_var: BuildAuthListRowsOptions): AuthListRow[] {
  const { accounts: accounts_var, activeAccountName: active_name_var, now: now_var } = options_var;

  return accounts_var.map((account_var, i_var) => {
    const parse_result_var = account_var.parseResult;

    if (!parse_result_var) {
      return {
        active: account_var.name === active_name_var,
        index: i_var + 1,
        name: account_var.name,
        emailDisplay: '-',
        familySummaries: [],
      };
    }

    const tier_suffix_var = resolveTierSuffix_func(parse_result_var.userTierId, parse_result_var.userTierName);
    // @domain 제거 — local part만 표시
    const email_local_var = parse_result_var.email
      ? parse_result_var.email.replace(/@.*$/, '')
      : null;
    const email_display_var = email_local_var
      ? (tier_suffix_var ? `${email_local_var} (${tier_suffix_var})` : email_local_var)
      : '-';
    const decorated_email_display_var = parse_result_var.accountStatus === 'forbidden'
      ? `${email_display_var} [FORBIDDEN]`
      : email_display_var;

    const family_summaries_var: ModelFamilySummaryDisplay[] = parse_result_var.familyQuotaSummaries.map((fq_var) => {
      const is_stale_var = fq_var.resetTime !== null && new Date(fq_var.resetTime).getTime() <= now_var.getTime();
      const progress_bar_var = formatQuotaProgressBar_func({
        remainingPercentage: fq_var.remainingPercentage,
        resetTime: fq_var.resetTime,
        isStale: is_stale_var,
      });
      const reset_display_var = is_stale_var ? null : formatResetDisplay_func(fq_var.resetTime, now_var);

      return {
        familyName: fq_var.familyName,
        progressBar: progress_bar_var,
        resetDisplay: reset_display_var,
      };
    });

    return {
      active: account_var.name === active_name_var,
      index: i_var + 1,
      name: account_var.name,
      emailDisplay: decorated_email_display_var,
      familySummaries: family_summaries_var,
    };
  });
}

// ─── renderAuthListText_func ──────────────────────────────────

/**
 * 플랜 §Preferred text format:
 * ❯ default  nsk1221aaa (Ultra)  ██████████ 99% (4h 53m)  ░░░░░░░░░░ 00% (0h 28m)  ← current
 */
export function renderAuthListText_func(options_var: RenderAuthListTextOptions): string {
  const { rows: rows_var } = options_var;

  // 고정 열: 계획 §2 target display shape — GEMINI, CLAUDE
  const FIXED_FAMILY_COLUMNS = ['GEMINI', 'CLAUDE'] as const;
  const sorted_families_var = FIXED_FAMILY_COLUMNS;

  const SEP = '  '; // 두 칸 구분

  // 열 폭: 실제 content 기준 (SEP가 두 칸 간격 제공)
  const number_col_width_var = Math.max(1, ...rows_var.map((r_var) => String(r_var.index).length));
  const email_col_width_var = Math.max(16, ...rows_var.map((r_var) => r_var.emailDisplay.length));

  // quota 열별 content 미리 계산
  const quota_cells_var = rows_var.map((row_var) =>
    sorted_families_var.map((family_var) => {
      const summary_var = row_var.familySummaries.find((f_var) => f_var.familyName === family_var);
      if (!summary_var) return '-';
      const bar_var = summary_var.progressBar;
      const reset_var = summary_var.resetDisplay ? ` (${summary_var.resetDisplay})` : '';
      return `${bar_var}${reset_var}`;
    }),
  );

  // 각 quota 열의 최대 폭
  const quota_col_widths_var = sorted_families_var.map((_, col_var) =>
    Math.max(sorted_families_var[col_var].length, ...quota_cells_var.map((cells_var) => cells_var[col_var].length)),
  );

  const lines_var: string[] = [];

  // 헤더 행
  const header_quota_var = sorted_families_var
    .map((f_var, i_var) => (i_var < sorted_families_var.length - 1 ? f_var.padEnd(quota_col_widths_var[i_var]) : f_var))
    .join(SEP);
  const header_var = `  ${'#'.padEnd(number_col_width_var)}${SEP}${'EMAIL ID (Plan)'.padEnd(email_col_width_var)}${SEP}${header_quota_var}`;
  lines_var.push(header_var);

  for (let i_var = 0; i_var < rows_var.length; i_var += 1) {
    const row_var = rows_var[i_var];
    const active_marker_var = row_var.active ? '*' : ' ';
    const number_str_var = String(row_var.index).padEnd(number_col_width_var);
    const email_str_var = row_var.emailDisplay.padEnd(email_col_width_var);

    const family_str_var = quota_cells_var[i_var]
      .map((cell_var, col_var) => (col_var < sorted_families_var.length - 1 ? cell_var.padEnd(quota_col_widths_var[col_var]) : cell_var))
      .join(SEP);

    const line_var = `${active_marker_var} ${number_str_var}${SEP}${email_str_var}${SEP}${family_str_var}`;
    lines_var.push(line_var);
  }

  return lines_var.join('\n');
}
