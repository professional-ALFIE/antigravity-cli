#!/usr/bin/env bun

/**
 * Antigravity CLI — 오케스트레이션 허브 (src/main.ts)
 *
 * Claude Code의 main.tsx에 대응하는 파일.
 * 전체 흐름을 한 파일에서 따라갈 수 있어야 한다 (handoff §Claude Code 구조).
 *
 * 실행 흐름 (plan L244~310):
 *  1. argv 파싱 (--model, --json, --resume, --background 등)
 *  2. process.cwd() → workspaceRootPath, workspaceUris[0] 고정
 *  3. config 로드
 *  4. --model alias 해석
 *  5. metadata 생성
 *  6. fake extension server 시작
 *  7. LS spawn (metadata → stdin)
 *  8. discovery file 대기
 *  9. USS topic 구독 대기 (uss-oauth, uss-enterprisePreferences)
 * 10. bundle 로드
 * 11. LS client 생성
 * 12. 분기: 새 대화 / resume list / resume send
 * 13. trackBackgroundConversationCreated (--background 아니면)
 * 14. cleanup: fake server stop → LS SIGTERM → SIGKILL
 *
 * 핵심 설계 원칙:
 * - StreamAgentStateUpdates는 트리거로만 쓴다 (handoff §1)
 * - GetCascadeTrajectorySteps가 진실 원본이다 (handoff §1)
 * - transcript append는 step 증가 감지마다 수행한다 (plan L288~291)
 * - --json 출력은 같은 JSONL 한 줄을 stdout으로 중계한다 (plan L361)
 * - cwd = workspaceRootPath = workspaceUris[0] (handoff §5)
 * - LS 1:1 one-shot: 1 호출 → 1 LS spawn → 사용 → 종료 (handoff §6)
 * - 주석 밀도 ~30% (spec L48~61)
 */

import { spawn, type ChildProcess } from 'node:child_process';
import https from 'node:https';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  resolveHeadlessBackendConfig,
  type HeadlessBackendConfig,
} from './utils/config.js';
import {
  buildMetadataArtifact,
  createMetadataFields,
} from './utils/makeMetadata.js';
import {
  ensureProjectDir,
  getProjectDir,
  getTranscriptPath,
} from './utils/sessionStoragePortable.js';
import { FakeExtensionServer } from './services/fakeExtensionServer.js';
import {
  buildStartCascadeRequestProto,
  buildSendUserCascadeMessageRequestProto,
  buildSendAllQueuedMessagesRequestProto,
  buildSignalExecutableIdleRequestProto,
  buildStartChatClientRequestStreamRequestProto,
  callConnectProtoRpc,
  callConnectRpc,
  decodeStartCascadeResponseProto,
  decodeSendUserCascadeMessageResponseProto,
  startConnectProtoStream,
  waitForDiscoveryFile,
  CLIENT_TRAJECTORY_VERBOSITY_PROD_UI,
  CASCADE_RUN_STATUS_IDLE,
  type ConnectProtoStreamHandle,
  type CascadeConfigProtoOptions,
  type DiscoveryInfo,
} from './services/connectRpc.js';
import {
  loadAntigravityBundle_func,
  createLanguageServerClient_func,
} from './services/bundleRuntime.js';
import {
  createObservedConversationState_func,
  applyAgentStateUpdate_func,
  hasIdleRunningIdleTransition_func,
  recoverObservedResponseText_func,
  type ObservedUpdateSummary,
} from './services/observeStream.js';
import {
  StateDbReader,
} from './services/stateVscdb.js';
import {
  discoverLiveLanguageServer_func,
  findRunningAntigravityApps_func,
  type LiveLsConnection,
  type RunningAntigravityAppInfo,
} from './services/liveAttach.js';
import {
  discoverAccounts_func,
  getActiveAccountName_func,
  setActiveAccountName_func,
  getStateDbPath_func,
  getDefaultCliDir_func,
  getDefaultDataDir_func,
} from './services/accounts.js';
import {
  buildAuthListRows_func,
  renderAuthListText_func,
} from './services/authList.js';
import {
  authLogin_func,
} from './services/authLogin.js';
import {
  StateDbReader as StateDbReaderForAuth,
  type UserStatusSummary,
  type ModelFamilyQuotaSummary,
  type ModelCreditsSummary,
} from './services/stateVscdb.js';

// ─────────────────────────────────────────────────────────────
// Phase 9-1: 모델 alias 해석
// 근거: v0.1.3_stage00_주인님_handoff.md L284~296
// alias → 내부 placeholder → enum 숫자값
// ─────────────────────────────────────────────────────────────

/** 모델 alias → placeholder 매핑. model-resolver.ts (line 8) 에서 이관. */
const MODEL_ALIAS_TABLE: Record<string, { placeholder: string; enumValue: number }> = {
  // 긴 이름
  'claude-opus-4.6': { placeholder: 'MODEL_PLACEHOLDER_M26', enumValue: 1026 },
  'claude-sonnet-4.6': { placeholder: 'MODEL_PLACEHOLDER_M35', enumValue: 1035 },
  'gemini-3.1-pro-high': { placeholder: 'MODEL_PLACEHOLDER_M37', enumValue: 1037 },
  'gemini-3.1-pro': { placeholder: 'MODEL_PLACEHOLDER_M36', enumValue: 1036 },
  'gemini-3-flash': { placeholder: 'MODEL_PLACEHOLDER_M18', enumValue: 1018 },
  // 짧은 별칭
  'opus': { placeholder: 'MODEL_PLACEHOLDER_M26', enumValue: 1026 },
  'sonnet': { placeholder: 'MODEL_PLACEHOLDER_M35', enumValue: 1035 },
  'pro-high': { placeholder: 'MODEL_PLACEHOLDER_M37', enumValue: 1037 },
  'pro': { placeholder: 'MODEL_PLACEHOLDER_M36', enumValue: 1036 },
  'flash': { placeholder: 'MODEL_PLACEHOLDER_M18', enumValue: 1018 },
};

const MODEL_CANONICAL_NAME_BY_ENUM: Record<number, string> = {
  1026: 'claude-opus-4.6',
  1035: 'claude-sonnet-4.6',
  1037: 'gemini-3.1-pro-high',
  1036: 'gemini-3.1-pro',
  1018: 'gemini-3-flash',
};

const DEFAULT_MODEL_NAME = 'claude-opus-4.6';
/** fallback 기본 모델: 공식 CLI와 동일하게 opus. */
const DEFAULT_MODEL_ENUM = 1026;

export function resolveCanonicalModelNameFromEnum_func(model_enum_var: number | null): string | null {
  if (model_enum_var == null) {
    return null;
  }

  return MODEL_CANONICAL_NAME_BY_ENUM[model_enum_var] ?? null;
}

async function resolvePreferredModelNameFromStateDb_func(state_db_path_var: string): Promise<string> {
  const reader_var = new StateDbReader(state_db_path_var);
  try {
    const selected_model_enum_var = await reader_var.extractLastSelectedModelEnum();
    return resolveCanonicalModelNameFromEnum_func(selected_model_enum_var) ?? DEFAULT_MODEL_NAME;
  } catch {
    return DEFAULT_MODEL_NAME;
  } finally {
    await reader_var.close();
  }
}

function resolveModelAlias_func(alias_var: string | undefined): number {
  if (!alias_var) {
    return DEFAULT_MODEL_ENUM;
  }
  const entry_var = MODEL_ALIAS_TABLE[alias_var.toLowerCase()];
  if (!entry_var) {
    // 숫자를 직접 넣은 경우도 허용
    const parsed_var = Number(alias_var);
    if (Number.isFinite(parsed_var) && parsed_var > 0) {
      return parsed_var;
    }
    throw new Error(
      `Unknown model alias: "${alias_var}". ` +
      `Available: ${Object.keys(MODEL_ALIAS_TABLE).join(', ')}`,
    );
  }
  return entry_var.enumValue;
}

// ─────────────────────────────────────────────────────────────
// Step 1: argv 파싱
// plan L247: --model, --json, --resume, --background 등
// ─────────────────────────────────────────────────────────────

interface CliOptions {
  prompt: string | null;
  model: string | undefined;
  json: boolean;
  resume: boolean;
  resumeCascadeId: string | null;
  background: boolean;
  help: boolean;
  timeoutMs: number;
}

export class CliFatalError extends Error {
  constructor(message_var: string) {
    super(message_var);
    this.name = 'CliFatalError';
  }
}

function failCli_func(message_var: string): never {
  throw new CliFatalError(message_var);
}

type ErrorWithJsonLifecycleSessionId = Error & {
  jsonLifecycleSessionId_var?: string;
};

export function attachJsonLifecycleSessionId_func(
  error_var: unknown,
  session_id_var: string,
): ErrorWithJsonLifecycleSessionId {
  const normalized_error_var = error_var instanceof Error
    ? error_var as ErrorWithJsonLifecycleSessionId
    : new Error(String(error_var)) as ErrorWithJsonLifecycleSessionId;

  if (!normalized_error_var.jsonLifecycleSessionId_var) {
    normalized_error_var.jsonLifecycleSessionId_var = session_id_var;
  }

  return normalized_error_var;
}

export function extractJsonLifecycleSessionId_func(error_var: unknown): string | undefined {
  if (error_var instanceof Error) {
    return (error_var as ErrorWithJsonLifecycleSessionId).jsonLifecycleSessionId_var;
  }

  return undefined;
}

export function formatFatalErrorForStderr_func(error_var: unknown): string {
  if (error_var instanceof CliFatalError) {
    return error_var.message;
  }

  return error_var instanceof Error
    ? error_var.stack ?? error_var.message
    : String(error_var);
}

// ── JSON lifecycle events (--json 모드 전용) ──
// Gemini CLI의 init/result 패턴을 따르되, Antigravity 고유 step은 그대로 유지.
// cokacdir provider는 이 3개 이벤트만 보고 세션 상태를 관리한다.

export function buildJsonInitEvent_func(
  cascade_id_var: string,
  model_var: string,
  cwd_var: string,
  is_resume_var: boolean,
): {
  type: 'init';
  session_id: string;
  cascadeId: string;
  model: string;
  cwd: string;
  resume: boolean;
} {
  return {
    type: 'init',
    session_id: cascade_id_var,
    cascadeId: cascade_id_var,
    model: model_var,
    cwd: cwd_var,
    resume: is_resume_var,
  };
}

function emitJsonInit_func(
  cascade_id_var: string,
  model_var: string,
  cwd_var: string,
  is_resume_var: boolean,
): void {
  console.log(JSON.stringify(
    buildJsonInitEvent_func(cascade_id_var, model_var, cwd_var, is_resume_var),
  ));
}

export function buildJsonDoneEvent_func(
  cascade_id_var: string,
): {
  type: 'done';
  session_id: string;
  cascadeId: string;
  exit_code: 0;
} {
  return {
    type: 'done',
    session_id: cascade_id_var,
    cascadeId: cascade_id_var,
    exit_code: 0,
  };
}

function emitJsonDone_func(
  cascade_id_var: string,
): void {
  console.log(JSON.stringify(buildJsonDoneEvent_func(cascade_id_var)));
}

export function buildJsonErrorEvent_func(
  message_var: string,
  cascade_id_var?: string,
): {
  type: 'error';
  session_id: string | null;
  cascadeId: string | null;
  message: string;
  exit_code: 1;
} {
  return {
    type: 'error',
    session_id: cascade_id_var ?? null,
    cascadeId: cascade_id_var ?? null,
    message: message_var,
    exit_code: 1,
  };
}

export function emitJsonError_func(
  message_var: string,
  cascade_id_var?: string,
): void {
  console.log(JSON.stringify(buildJsonErrorEvent_func(message_var, cascade_id_var)));
}

const DOCUMENTED_MODEL_NAMES = [
  'claude-opus-4.6',
  'claude-sonnet-4.6',
  'gemini-3.1-pro-high',
  'gemini-3.1-pro',
  'gemini-3-flash',
] as const;

// ── 미구현 CLI 표면 감지 (spec 성공 조건 9: silent fallback 금지) ──
// 이 표면들은 Bridge HTTP API에 의존하므로 headless에서 불가.
// positional prompt로 흘러가면 안 되므로 먼저 차단한다.
const UNSUPPORTED_SUBCOMMANDS = ['server', 'commands', 'agent'] as const;
const UNSUPPORTED_FLAGS = ['--async'] as const;

function checkUnsupportedSurface_func(argv_var: string[]): string | null {
  // 서브커맨드 감지: 모든 non-flag 토큰을 검사한다.
  // 첫 번째만 보면 `--model flash server status`에서 server를 놓침.
  for (const arg_var of argv_var) {
    if (arg_var.startsWith('-')) continue;
    if ((UNSUPPORTED_SUBCOMMANDS as readonly string[]).includes(arg_var)) {
      return `"${arg_var}" subcommand is not supported in headless mode (requires Bridge HTTP API).`;
    }
  }
  // --async 감지
  for (const flag_var of UNSUPPORTED_FLAGS) {
    if (argv_var.includes(flag_var)) {
      return `"${flag_var}" flag is not supported in headless mode (requires Bridge HTTP API).`;
    }
  }
  return null;
}

function buildModelHelpLines_func(default_model_name_var: string = DEFAULT_MODEL_NAME): string {
  return DOCUMENTED_MODEL_NAMES
    .map((model_var, index_var) => (
      `                        ${model_var}${model_var === default_model_name_var ? ' (default from IDE last-used)' : ''}`
    ))
    .join('\n');
}

export function buildRootHelp_func(default_model_name_var: string = DEFAULT_MODEL_NAME): string {
  const model_lines_var = buildModelHelpLines_func(default_model_name_var);

  return [
    'Usage: antigravity-cli [options] [message]',
    '',
    'Headless CLI to control Antigravity language server directly',
    '',
    'Options:',
    '  -m, --model <model>   Set conversation model',
    model_lines_var,
    '  -r, --resume               List sessions',
    '      --resume [cascadeId]   Resume a session by cascadeId',
    '                             (cascadeId is the session identifier, formatted as a UUID)',
    '      --timeout-ms <number>  Override timeout in milliseconds',
    '  -b, --background           Skip UI surfaced registration',
    '  -j, --json                 Output in JSON format',
    '  -h, --help                 display help for command',
    '',
    'Examples:',
    `  $ antigravity-cli 'hello'                               Single-quoted message`,
    `  $ antigravity-cli "hello"                               Double-quoted message`,
    `  $ antigravity-cli hello world                           Unquoted (joined automatically)`,
    `  $ antigravity-cli 'review this code'                    Create new conversation`,
    '  $ antigravity-cli -r                                    List workspace sessions',
    `  $ antigravity-cli -r <cascadeId> 'continue'             Send message to existing session`,
    `  $ antigravity-cli -b 'background task'                  Skip UI surfaced registration`,
    `  $ antigravity-cli -j 'summarize this'                   Print transcript events as JSONL`,
    '',
    'Stdin Support:',
    '  Pipe prompt via stdin to avoid shell escaping issues:',
    `    echo "hello!" | antigravity-cli`,
    `    cat prompt.txt | antigravity-cli`,
    '  Or use "-" as explicit stdin marker:',
    `    antigravity-cli -`,
    `    antigravity-cli -r <cascadeId> -`,
    '',
    'Commands:',
    '  auth list                    List accounts with GEMINI/CLAUDE quota status',
    '  auth login                   Add a new managed account via Antigravity app',
    '',
    'Root Mode:',
    '  - New and resumed conversations talk to the Antigravity language server directly',
    '  - If --background is omitted, local tracking and UI surfaced post-processing are attempted',
    '  - --resume list only shows sessions for the current workspace, with full UUIDs',
    '  - Multiple positional arguments are joined with spaces automatically',
  ].join('\n');
}

const STDIN_PROMPT_MARKER = '-';

async function readStdinText_func(): Promise<string> {
  const chunks_var: Buffer[] = [];
  for await (const chunk_var of process.stdin) {
    chunks_var.push(Buffer.from(chunk_var));
  }
  return Buffer.concat(chunks_var).toString('utf-8').trim();
}

export function collectPositionalArgs_func(argv_var: string[]): string[] {
  const positionals_var: string[] = [];

  for (let index_var = 0; index_var < argv_var.length; index_var += 1) {
    const arg_var = argv_var[index_var];

    if (
      arg_var === '--model'
      || arg_var === '-m'
      || arg_var === '--timeout-ms'
    ) {
      index_var += 1;
      continue;
    }

    if (arg_var === '-r' || arg_var === '--resume') {
      const next_var = argv_var[index_var + 1];
      if (next_var && !next_var.startsWith('-')) {
        index_var += 1;
      }
      continue;
    }

    if (arg_var.startsWith('-')) {
      continue;
    }

    positionals_var.push(arg_var);
  }

  return positionals_var;
}

// ─────────────────────────────────────────────────────────────
// Phase 1: Auth Root Command
// ─────────────────────────────────────────────────────────────

type RootCommand =
  | { kind: 'chat'; argv: string[] }
  | { kind: 'auth'; argv: string[] };

type AuthSubcommand = 'list' | 'login';

interface AuthCliOptions {
  subcommand: AuthSubcommand;
  json: boolean;
}

export function detectRootCommand_func(argv_var: string[]): RootCommand {
  // process args에서 첫 번째 non-flag 토큰이 'auth'이면 auth 분기
  // pre-auth flags는 auth argv에 포함시킨다 (예: agcl --json auth list)
  for (let i_var = 0; i_var < argv_var.length; i_var += 1) {
    const arg_var = argv_var[i_var];
    if (arg_var.startsWith('-')) continue;
    if (arg_var === 'auth') {
      const pre_flags_var = argv_var.slice(0, i_var);
      const post_args_var = argv_var.slice(i_var + 1);
      return { kind: 'auth', argv: [...pre_flags_var, ...post_args_var] };
    }
    break; // non-flag, non-auth token → chat path
  }
  return { kind: 'chat', argv: argv_var };
}

function parseAuthArgv_func(argv_var: string[]): AuthCliOptions | null {
  let subcommand_var: AuthSubcommand | null = null;
  let json_var = false;

  for (const arg_var of argv_var) {
    if (arg_var === '--json') {
      json_var = true;
      continue;
    }
    if (arg_var === 'list' && !subcommand_var) {
      subcommand_var = 'list';
      continue;
    }
    if (arg_var === 'login' && !subcommand_var) {
      subcommand_var = 'login';
      continue;
    }
  }

  if (!subcommand_var) return null;
  return { subcommand: subcommand_var, json: json_var };
}

async function handleAuthCommand_func(argv_var: string[]): Promise<void> {
  const auth_cli_var = parseAuthArgv_func(argv_var);

  if (!auth_cli_var) {
    process.stderr.write('Usage: agcl auth <subcommand> [options]\n');
    process.stderr.write('Subcommands: list, login\n');
    process.exitCode = 1;
    return;
  }

  const cli_dir_var = getDefaultCliDir_func();
  const default_data_dir_var = getDefaultDataDir_func();

  if (auth_cli_var.subcommand === 'list') {
    await handleAuthList_func({ cliDir: cli_dir_var, defaultDataDir: default_data_dir_var, json: auth_cli_var.json });
    return;
  }

  if (auth_cli_var.subcommand === 'login') {
    await handleAuthLogin_func({ cliDir: cli_dir_var, defaultDataDir: default_data_dir_var });
    return;
  }
}

interface AuthListHandlerOptions {
  cliDir: string;
  defaultDataDir: string;
  json: boolean;
}

// ─── live > persisted: GetUserStatus JSON fetch ──────────────

/** live LS에 GetUserStatus JSON 호출. 실패 시 null. */
async function fetchLiveGetUserStatusJson_func(
  port_var: number,
  csrf_token_var: string,
  cert_path_var: string,
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve_var) => {
    const url_var = `https://127.0.0.1:${port_var}/exa.language_server_pb.LanguageServerService/GetUserStatus`;
    let ca_var: Buffer | undefined;
    try { ca_var = readFileSync(cert_path_var); } catch { /* ignore */ }

    const req_var = https.request(
      url_var,
      {
        method: 'POST',
        headers: {
          'Connect-Protocol-Version': '1',
          'Content-Type': 'application/json',
          'x-codeium-csrf-token': csrf_token_var,
        },
        rejectUnauthorized: false,
        ca: ca_var,
        timeout: 3000,
      },
      (res_var) => {
        let body_var = '';
        res_var.setEncoding('utf8');
        res_var.on('data', (chunk_var) => { body_var += chunk_var; });
        res_var.on('end', () => {
          if (res_var.statusCode !== 200) { resolve_var(null); return; }
          try {
            const parsed_var = JSON.parse(body_var);
            resolve_var(typeof parsed_var === 'object' && parsed_var !== null ? parsed_var : null);
          } catch { resolve_var(null); }
        });
      },
    );
    req_var.on('error', () => resolve_var(null));
    req_var.on('timeout', () => { req_var.destroy(); resolve_var(null); });
    req_var.write('{}');
    req_var.end();
  });
}

/** GEMINI/CLAUDE family 판별 (stateVscdb.ts의 resolveModelFamilyName_func와 동일 규칙). */
function resolveModelFamilyFromLabel_func(label_var: string): string | null {
  const lower_var = label_var.toLowerCase();
  if (lower_var.includes('gemini')) return 'GEMINI';
  if (lower_var.includes('claude')) return 'CLAUDE';
  return null;
}

/** GetUserStatus JSON 응답 → UserStatusSummary. */
export function parseLiveUserStatusJsonToSummary_func(
  json_var: Record<string, unknown>,
): UserStatusSummary | null {
  const user_status_var = json_var.userStatus as Record<string, unknown> | undefined;
  if (!user_status_var || typeof user_status_var !== 'object') return null;

  const email_var = (user_status_var.email as string) ?? '';
  const user_tier_var = user_status_var.userTier as Record<string, unknown> | undefined;
  const user_tier_id_var = (user_tier_var?.id as string) ?? null;
  const user_tier_name_var = (user_tier_var?.name as string) ?? null;

  const cmd_var = user_status_var.cascadeModelConfigData as Record<string, unknown> | undefined;
  const configs_var = (cmd_var?.clientModelConfigs as Array<Record<string, unknown>>) ?? [];

  // family별 집계 (GEMINI/CLAUDE만, disabled 제외)
  const family_map_var = new Map<string, { minRemaining: number | null; earliestResetIso: string | null }>();

  for (const cfg_var of configs_var) {
    if (cfg_var.disabled === true) continue;
    const label_var = (cfg_var.label as string) ?? '';
    const family_var = resolveModelFamilyFromLabel_func(label_var);
    if (!family_var) continue;

    const qi_var = cfg_var.quotaInfo as Record<string, unknown> | undefined;
    const remaining_var = typeof qi_var?.remainingFraction === 'number'
      ? qi_var.remainingFraction as number
      : null;
    const reset_var = typeof qi_var?.resetTime === 'string'
      ? qi_var.resetTime as string
      : null;

    const existing_var = family_map_var.get(family_var);
    if (!existing_var) {
      family_map_var.set(family_var, { minRemaining: remaining_var, earliestResetIso: reset_var });
    } else {
      const merged_var = existing_var.minRemaining === null
        ? remaining_var
        : remaining_var === null
          ? existing_var.minRemaining
          : Math.min(existing_var.minRemaining, remaining_var);
      const earlier_var = existing_var.earliestResetIso === null ? reset_var
        : reset_var === null ? existing_var.earliestResetIso
        : existing_var.earliestResetIso < reset_var ? existing_var.earliestResetIso : reset_var;
      family_map_var.set(family_var, { minRemaining: merged_var, earliestResetIso: earlier_var });
    }
  }

  const family_summaries_var: ModelFamilyQuotaSummary[] = [];
  for (const [name_var, data_var] of family_map_var.entries()) {
    const pct_var = data_var.minRemaining !== null ? Math.round(data_var.minRemaining * 100) : null;
    family_summaries_var.push({
      familyName: name_var,
      remainingPercentage: pct_var,
      exhausted: data_var.minRemaining === 0,
      resetTime: data_var.earliestResetIso,
    });
  }

  return {
    email: email_var,
    userTierId: user_tier_id_var,
    userTierName: user_tier_name_var,
    familyQuotaSummaries: family_summaries_var,
  };
}

export function findLiveAuthAccountByUserDataDir_func(
  accounts_var: Array<{ name: string; userDataDirPath: string }>,
  running_apps_var: RunningAntigravityAppInfo[],
): string | null {
  const distinct_user_data_dirs_var = [...new Set(
    running_apps_var.map((app_var) => path.resolve(app_var.userDataDirPath)),
  )];

  if (distinct_user_data_dirs_var.length !== 1) {
    return null;
  }

  const matching_accounts_var = accounts_var.filter(
    (account_var) => path.resolve(account_var.userDataDirPath) === distinct_user_data_dirs_var[0],
  );

  return matching_accounts_var.length === 1
    ? matching_accounts_var[0].name
    : null;
}

export function findLiveAuthAccountByEmailFallback_func(
  accounts_var: Array<{ name: string; parseResult: UserStatusSummary | null }>,
  live_summary_var: UserStatusSummary | null,
): string | null {
  const live_email_var = live_summary_var?.email?.trim() ?? '';
  if (live_email_var.length === 0) {
    return null;
  }

  const matching_accounts_var = accounts_var.filter(
    (account_var) => account_var.parseResult?.email === live_email_var,
  );

  return matching_accounts_var.length === 1
    ? matching_accounts_var[0].name
    : null;
}

async function handleAuthList_func(options_var: AuthListHandlerOptions): Promise<void> {
  const { cliDir: cli_dir_var, defaultDataDir: default_data_dir_var, json: json_var } = options_var;

  const accounts_var = await discoverAccounts_func({ defaultDataDir: default_data_dir_var, cliDir: cli_dir_var });
  const active_name_var = await getActiveAccountName_func({ cliDir: cli_dir_var });

  // 활성 계정이 discovered 목록에 없으면 default로 fallback
  const resolved_active_var = accounts_var.some((a_var) => a_var.name === active_name_var)
    ? active_name_var
    : 'default';

  // ── live > persisted: live LS가 있으면 GetUserStatus 실시간 값 사용 ──
  const config_var = resolveHeadlessBackendConfig();
  let live_summary_var: UserStatusSummary | null = null;
  let running_apps_var: RunningAntigravityAppInfo[] = [];
  try {
    const live_var = await discoverLiveLanguageServer_func(
      config_var.workspaceRootPath,
      { certPath: config_var.certPath, workspaceId: config_var.workspaceId },
    );
    if (live_var) {
      running_apps_var = findRunningAntigravityApps_func(config_var.appPath);
      const json_response_var = await fetchLiveGetUserStatusJson_func(
        live_var.port,
        live_var.csrfToken,
        config_var.certPath,
      );
      if (json_response_var) {
        live_summary_var = parseLiveUserStatusJsonToSummary_func(json_response_var);
      }
    }
  } catch {
    // live 실패 시 persisted fallback — 치명적이지 않음
  }

  // 각 계정의 persisted parse result 수집
  const persisted_accounts_var = await Promise.all(
    accounts_var.map(async (account_var) => {
      const db_path_var = getStateDbPath_func({ userDataDirPath: account_var.userDataDirPath });
      let persisted_var: UserStatusSummary | null = null;
      if (existsSync(db_path_var)) {
        try {
          const reader_var = new StateDbReaderForAuth(db_path_var);
          persisted_var = await reader_var.extractUserStatusSummary_func();
          await reader_var.close();
        } catch {
          // parse 실패 — null
        }
      }

      return { ...account_var, parseResult: persisted_var };
    }),
  );

  const live_account_name_var = live_summary_var
    ? findLiveAuthAccountByUserDataDir_func(accounts_var, running_apps_var)
      ?? findLiveAuthAccountByEmailFallback_func(persisted_accounts_var, live_summary_var)
    : null;

  const accounts_with_result_var = live_summary_var && live_account_name_var
    ? persisted_accounts_var.map((account_var) => (
      account_var.name === live_account_name_var
        ? { ...account_var, parseResult: live_summary_var }
        : account_var
    ))
    : persisted_accounts_var;

  if (json_var) {
    const json_output_var = accounts_with_result_var.map((a_var, i_var) => ({
      index: i_var + 1,
      active: a_var.name === resolved_active_var,
      name: a_var.name,
      userDataDirPath: a_var.userDataDirPath,
      email: a_var.parseResult?.email ?? null,
      userTierId: a_var.parseResult?.userTierId ?? null,
      userTierName: a_var.parseResult?.userTierName ?? null,
      familyQuotaSummaries: a_var.parseResult?.familyQuotaSummaries ?? [],
    }));
    process.stdout.write(JSON.stringify(json_output_var, null, 2) + '\n');
    return;
  }

  const rows_var = buildAuthListRows_func({
    accounts: accounts_with_result_var,
    activeAccountName: resolved_active_var,
    now: new Date(),
  });

  // TTY 여부와 관계없이 텍스트 출력 (TTY readline 선택은 추후 enhancement)
  process.stdout.write(renderAuthListText_func({ rows: rows_var }) + '\n');

  if (process.stdin.isTTY && process.stdout.isTTY) {
    const selected_var = await readTtySelection_func(rows_var.length);
    if (selected_var !== null) {
      const selected_account_var = rows_var[selected_var - 1];
      if (selected_account_var) {
        await setActiveAccountName_func({ cliDir: cli_dir_var, accountName: selected_account_var.name });
        process.stdout.write(`\nActive account → ${selected_account_var.name}\n`);
      }
    }
  }
}

async function readTtySelection_func(max_var: number): Promise<number | null> {
  return new Promise<number | null>((resolve_var) => {
    process.stdout.write(`\nSelect account [1-${max_var}] or press Enter to keep current: `);
    process.stdin.setEncoding('utf8');
    process.stdin.resume();

    const onData_var = (chunk_var: string) => {
      const trimmed_var = chunk_var.trim();
      process.stdin.pause();
      process.stdin.removeListener('data', onData_var);
      if (!trimmed_var) {
        resolve_var(null);
        return;
      }
      const num_var = parseInt(trimmed_var, 10);
      if (Number.isNaN(num_var) || num_var < 1 || num_var > max_var) {
        resolve_var(null);
        return;
      }
      resolve_var(num_var);
    };

    process.stdin.on('data', onData_var);
  });
}

interface AuthLoginHandlerOptions {
  cliDir: string;
  defaultDataDir: string;
}

async function handleAuthLogin_func(options_var: AuthLoginHandlerOptions): Promise<void> {
  const { cliDir: cli_dir_var, defaultDataDir: default_data_dir_var } = options_var;

  process.stderr.write('Opening Antigravity for login...\n');

  const result_var = await authLogin_func({
    cliDir: cli_dir_var,
    defaultDataDir: default_data_dir_var,
  });

  if (result_var.status === 'success') {
    process.stdout.write(`Logged in as account: ${result_var.accountName}\n`);
    return;
  }

  if (result_var.status === 'timeout') {
    process.stderr.write(`Login timed out for account: ${result_var.accountName}\n`);
    process.exitCode = 1;
    return;
  }

  if (result_var.status === 'cancelled') {
    process.stderr.write('Login cancelled.\n');
    process.exitCode = 1;
    return;
  }

  if (result_var.status === 'open_failed') {
    process.stderr.write(`Failed to open Antigravity: ${result_var.message}\n`);
    process.exitCode = 1;
    return;
  }
}

export function parseArgv_func(argv_var: string[]): CliOptions {

  const options_var: CliOptions = {
    prompt: null,
    model: undefined,
    json: false,
    resume: false,
    resumeCascadeId: null,
    background: false,
    help: false,
    timeoutMs: 120_000,
  };

  for (let index_var = 0; index_var < argv_var.length; index_var += 1) {
    const arg_var = argv_var[index_var];

    if (arg_var === '--model' || arg_var === '-m') {
      options_var.model = argv_var[index_var + 1];
      index_var += 1;
      continue;
    }
    if (arg_var === '--json' || arg_var === '-j') {
      options_var.json = true;
      continue;
    }
    if (arg_var === '-r' || arg_var === '--resume') {
      options_var.resume = true;
      // -r <cascadeId> "message" 패턴 처리
      const next_var = argv_var[index_var + 1];
      if (next_var && !next_var.startsWith('-')) {
        options_var.resumeCascadeId = next_var;
        index_var += 1;
      }
      continue;
    }
    if (arg_var === '--background' || arg_var === '-b') {
      options_var.background = true;
      continue;
    }
    if (arg_var === '--help' || arg_var === '-h') {
      options_var.help = true;
      continue;
    }
    if (arg_var === '--timeout-ms') {
      options_var.timeoutMs = Number(argv_var[index_var + 1]);
      index_var += 1;
      continue;
    }
    // positional argument = prompt (여러 개면 공백으로 합침)
    if (!arg_var.startsWith('-')) {
      options_var.prompt = options_var.prompt === null
        ? arg_var
        : `${options_var.prompt} ${arg_var}`;
    }
  }

  return options_var;
}

// ─────────────────────────────────────────────────────────────
// 공유 유틸리티: 조건 대기, topic 대기, 터미네이션
// headless_runtime.ts에서 이관 (검증된 코드)
// ─────────────────────────────────────────────────────────────

async function waitForCondition_func<T>(options_var: {
  timeoutMs: number;
  pollIntervalMs?: number;
  label: string;
  probe: () => Promise<T>;
  isReady: (value_var: T) => boolean;
}): Promise<T> {
  const deadline_var = Date.now() + options_var.timeoutMs;
  const poll_interval_ms_var = options_var.pollIntervalMs ?? 250;

  while (Date.now() < deadline_var) {
    const value_var = await options_var.probe();
    if (options_var.isReady(value_var)) {
      return value_var;
    }
    await new Promise((resolve_var) => setTimeout(resolve_var, poll_interval_ms_var));
  }

  throw new Error(`${options_var.label} was not ready within ${options_var.timeoutMs}ms.`);
}

async function waitForTopics_func(
  server_var: FakeExtensionServer,
  required_topics_var: string[],
  timeout_ms_var: number,
): Promise<string[]> {
  return waitForCondition_func({
    timeoutMs: timeout_ms_var,
    pollIntervalMs: 200,
    label: 'required unified-state subscriptions',
    probe: async () => {
      const observed_var: string[] = [];
      for (const req_var of server_var.requests) {
        if (req_var.topicName) {
          observed_var.push(req_var.topicName);
        }
      }
      return [...new Set(observed_var)];
    },
    isReady: (topics_var) =>
      required_topics_var.every((topic_var) => topics_var.includes(topic_var)),
  });
}

/** LS 종료: SIGTERM → 500ms 대기 → SIGKILL (headless_runtime.ts L104~114 이관) */
async function terminateChild_func(child_var: ChildProcess): Promise<void> {
  if (child_var.exitCode != null) {
    return;
  }
  child_var.kill('SIGTERM');
  await new Promise((resolve_var) => setTimeout(resolve_var, 500));
  if (child_var.exitCode == null) {
    child_var.kill('SIGKILL');
  }
}

// ─────────────────────────────────────────────────────────────
// transcript JSONL append
// 순서 의존: getTranscriptPath()로 경로를 고정한 뒤,
// step이 증가할 때마다 이 함수로 한 줄씩 append한다.
// --json이면 같은 줄을 stdout에도 emit한다 (plan L361).
// ─────────────────────────────────────────────────────────────

function appendTranscriptLine_func(
  transcript_path_var: string,
  payload_var: unknown,
  emit_to_stdout_var: boolean,
): void {
  const line_var = serializeJsonLine_func(payload_var);
  appendFileSync(transcript_path_var, `${line_var}\n`, 'utf8');
  if (emit_to_stdout_var) {
    process.stdout.write(`${line_var}\n`);
  }
}

function serializeJsonLine_func(payload_var: unknown): string {
  return JSON.stringify(payload_var, (_key_var, value_var) =>
    typeof value_var === 'bigint' ? value_var.toString() : value_var,
  );
}

const ANSI_BRIGHT_EMERALD_VAR = '\x1b[38;5;49m';
const ANSI_RESET_VAR = '\x1b[0m';

function canUseAnsiColor_func(): boolean {
  return !!process.stdout.isTTY && process.env.NO_COLOR == null && process.env.TERM !== 'dumb';
}

function colorBrightEmerald_func(text_var: string, use_color_var: boolean): string {
  return use_color_var ? `${ANSI_BRIGHT_EMERALD_VAR}${text_var}${ANSI_RESET_VAR}` : text_var;
}

function formatTranscriptPathForDisplay_func(
  transcript_path_var: string,
  home_dir_path_var: string,
): string {
  if (transcript_path_var === home_dir_path_var) {
    return '~';
  }

  const home_prefix_var = `${home_dir_path_var}${path.sep}`;
  if (transcript_path_var.startsWith(home_prefix_var)) {
    return `~${transcript_path_var.slice(home_dir_path_var.length)}`;
  }

  return transcript_path_var;
}

export function buildSessionContinuationNotice_func(options_var: {
  cascadeId_var: string;
  transcriptPath_var: string;
  homeDirPath_var: string;
  useColor_var: boolean;
}): string {
  const display_transcript_path_var = formatTranscriptPathForDisplay_func(
    options_var.transcriptPath_var,
    options_var.homeDirPath_var,
  );
  const cascade_id_label_var = colorBrightEmerald_func(
    'cascadeId',
    options_var.useColor_var,
  );
  const transcript_path_label_var = colorBrightEmerald_func(
    'transcript_path',
    options_var.useColor_var,
  );
  const resume_command_var = colorBrightEmerald_func(
    `antigravity-cli --resume ${options_var.cascadeId_var}`,
    options_var.useColor_var,
  );

  return [
    `${cascade_id_label_var}: ${options_var.cascadeId_var}`,
    `${transcript_path_label_var}: ${display_transcript_path_var}`,
    '',
    `To continue this session, run ${resume_command_var} '<message>'`,
  ].join('\n');
}

function printSessionContinuationNotice_func(
  cascade_id_var: string,
  transcript_path_var: string,
  home_dir_path_var: string,
): void {
  const notice_var = buildSessionContinuationNotice_func({
    cascadeId_var: cascade_id_var,
    transcriptPath_var: transcript_path_var,
    homeDirPath_var: home_dir_path_var,
    useColor_var: canUseAnsiColor_func(),
  });
  process.stdout.write(`\n${notice_var}\n`);
}

// ─────────────────────────────────────────────────────────────
// 로컬 conversation tracking (RPC fallback)
//
// trackBackgroundConversationCreated RPC는 미확인이므로,
// 로컬 conversations.jsonl에 { cascadeId, createdAt, prompt } 기록.
// -r 목록 조회 시 이 파일도 참조하여 empty list 문제를 방지한다.
// ─────────────────────────────────────────────────────────────

function trackConversationLocally_func(
  workspace_root_path_var: string,
  cascade_id_var: string | null,
  prompt_var: string | null,
  model_var: string,
): void {
  try {
    const project_dir_var = getProjectDir(workspace_root_path_var);
    mkdirSync(project_dir_var, { recursive: true });
    const conversations_path_var = path.join(project_dir_var, 'conversations.jsonl');
    const record_var = {
      cascadeId: cascade_id_var,
      prompt: prompt_var?.slice(0, 120) ?? null,
      createdAt: new Date().toISOString(),
      model: model_var,
    };
    appendFileSync(conversations_path_var, `${JSON.stringify(record_var)}\n`, 'utf8');
  } catch {
    // tracking 실패는 치명적이지 않음
  }
}

// 로컬 conversations.jsonl에서 대화 목록을 읽는다.
function readLocalConversations_func(
  workspace_root_path_var: string,
): Array<{ cascadeId: string | null; prompt: string | null; createdAt: string; model: string }> {
  try {
    const project_dir_var = getProjectDir(workspace_root_path_var);
    const conversations_path_var = path.join(project_dir_var, 'conversations.jsonl');
    if (!existsSync(conversations_path_var)) return [];
    const content_var = readFileSync(conversations_path_var, 'utf8');
    return content_var.split('\n')
      .filter((line_var) => line_var.trim())
      .map((line_var) => JSON.parse(line_var));
  } catch {
    return [];
  }
}

// 로컬 conversations.jsonl dedupe.
//
// 로컬 fallback 파일은 "대화 하나당 1줄"이 아니라 "사용할 때마다 append" 구조다.
// 그래서 같은 cascadeId가 여러 번 기록될 수 있다.
// resume list 출력에서는 같은 cascadeId를 여러 번 보여줄 이유가 없으므로,
// cascadeId 기준으로 가장 최근(createdAt 최대) 1건만 남긴다.
//
// cascadeId가 null인 레코드는 새 대화 생성 중 실패/구버전 흔적일 수 있으므로
// dedupe 키를 만들 수 없다. 이 경우는 원본 그대로 유지한다.
export function dedupeLocalConversationRecords_func(
  records_var: Array<{ cascadeId: string | null; prompt: string | null; createdAt: string; model: string }>,
): Array<{ cascadeId: string | null; prompt: string | null; createdAt: string; model: string }> {
  const latest_by_id_var = new Map<string, { cascadeId: string | null; prompt: string | null; createdAt: string; model: string }>();
  const without_id_var: Array<{ cascadeId: string | null; prompt: string | null; createdAt: string; model: string }> = [];

  for (const record_var of records_var) {
    if (!record_var.cascadeId) {
      without_id_var.push(record_var);
      continue;
    }

    const existing_var = latest_by_id_var.get(record_var.cascadeId);
    if (!existing_var || existing_var.createdAt < record_var.createdAt) {
      latest_by_id_var.set(record_var.cascadeId, record_var);
    }
  }

  return [...latest_by_id_var.values(), ...without_id_var]
    .sort((left_var, right_var) => right_var.createdAt.localeCompare(left_var.createdAt));
}

// GetAllCascadeTrajectories 응답 shape 정규화.
//
// 관찰된 실제 응답은 두 계열이 있다.
// 1) stage57 초기 구현이 가정한 legacy shape:
//    { cascadeTrajectories: { [cascadeId]: summaryLikeObject } }
// 2) 현재 LS 1.20.6에서 관찰한 실제 shape:
//    { trajectorySummaries: { [cascadeId]: summaryObject } }
//
// resume list가 빈 목록으로 보였던 직접 원인은
// main.ts가 (1)만 읽고 (2)를 버렸기 때문이다.
// 이 helper는 두 shape를 모두 받아 동일한 entry 배열로 맞춘다.
export function extractTrajectorySummaryEntries_func(
  response_body_var: unknown,
): Array<[string, Record<string, unknown>]> {
  if (!response_body_var || typeof response_body_var !== 'object' || Array.isArray(response_body_var)) {
    return [];
  }

  const body_var = response_body_var as Record<string, unknown>;
  const map_var = body_var.trajectorySummaries ?? body_var.cascadeTrajectories;
  if (!map_var || typeof map_var !== 'object' || Array.isArray(map_var)) {
    return [];
  }

  return Object.entries(map_var as Record<string, unknown>)
    .filter((entry_var): entry_var is [string, Record<string, unknown>] => (
      !!entry_var[1] && typeof entry_var[1] === 'object' && !Array.isArray(entry_var[1])
    ));
}

// trajectory summary/workspace 필드에서 workspace URI를 한 군데로 모은다.
//
// 현재 확인된 필드 소스:
// - top-level workspaceUris
// - trajectoryMetadata.workspaceUris
// - workspaces[].workspaceFolderAbsoluteUri
// - workspaces[].gitRootAbsoluteUri
//
// 기존 review finding대로, top-level workspaceUris만 보면
// 실제 CLI가 쓰는 workspace 필터와 어긋난다.
// 따라서 resume list는 nested workspaces까지 모두 읽어야 한다.
export function collectTrajectoryWorkspaceUris_func(
  trajectory_record_var: Record<string, unknown>,
): string[] {
  const uri_set_var = new Set<string>();

  const appendUris_func = (value_var: unknown): void => {
    if (!Array.isArray(value_var)) {
      return;
    }
    for (const uri_var of value_var) {
      if (typeof uri_var === 'string' && uri_var) {
        uri_set_var.add(uri_var);
      }
    }
  };

  appendUris_func(trajectory_record_var.workspaceUris);

  const trajectory_metadata_var = trajectory_record_var.trajectoryMetadata;
  if (trajectory_metadata_var && typeof trajectory_metadata_var === 'object' && !Array.isArray(trajectory_metadata_var)) {
    appendUris_func((trajectory_metadata_var as Record<string, unknown>).workspaceUris);
  }

  const workspaces_var = trajectory_record_var.workspaces;
  if (Array.isArray(workspaces_var)) {
    for (const workspace_var of workspaces_var) {
      if (!workspace_var || typeof workspace_var !== 'object' || Array.isArray(workspace_var)) {
        continue;
      }
      const workspace_record_var = workspace_var as Record<string, unknown>;
      const folder_uri_var = workspace_record_var.workspaceFolderAbsoluteUri;
      const git_root_uri_var = workspace_record_var.gitRootAbsoluteUri;
      if (typeof folder_uri_var === 'string' && folder_uri_var) {
        uri_set_var.add(folder_uri_var);
      }
      if (typeof git_root_uri_var === 'string' && git_root_uri_var) {
        uri_set_var.add(git_root_uri_var);
      }
    }
  }

  return [...uri_set_var];
}

// 공식 Bridge의 `POST /api/ls/track/:id`에 대응하는 headless 측 best-effort 후처리.
//
// packages/extension/src/server/routes/ls.ts 는 새 대화/이어쓰기 직후
// UpdateConversationAnnotations({ lastUserViewTime }, mergeAnnotations: true)
// 를 보내서 background UI surfaced 경로를 탄다.
//
// 현재 headless는 standalone LS라서 이것만으로 IDE surfaced가 100% 보장되진 않지만,
// 적어도 "공식 경로에서 빠져 있던 후처리"는 맞춰 두는 편이 옳다.
//
// antigravity-cli 구현용 주석:
// standalone LS 인스턴스 안에서는 새 대화가 약 6초 뒤
// GetAllCascadeTrajectories summary에 나타났다.
// 그 summary.workspaces 는 정상적으로 채워졌다.
//
// 그러나 같은 인스턴스에 UpdateConversationAnnotations(lastUserViewTime)를 보내도
// summary.annotations / GetCascadeTrajectory.annotations 는 계속 null이었다.
//
// 따라서 이 호출은 "공식 경로와 맞추는 보완책"이지,
// "이것만 넣으면 later IDE UI surfaced가 보장된다"는 근거는 아직 없다.
// 실패해도 대화 본문 생성 자체는 성공해야 하므로 best-effort로만 다룬다.
async function trackConversationVisibility_func(
  discovery_var: DiscoveryInfo,
  config_var: HeadlessBackendConfig,
  cascade_id_var: string,
  timeout_ms_var: number,
): Promise<UiSurfacedPostProcessResult> {
  try {
    await callConnectRpc({
      discovery: discovery_var,
      protocol: 'https',
      certPath: config_var.certPath,
      method: 'UpdateConversationAnnotations',
      payload: {
        cascadeId: cascade_id_var,
        annotations: {
          lastUserViewTime: new Date().toISOString(),
        },
        mergeAnnotations: true,
      },
      timeoutMs: timeout_ms_var,
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'UpdateConversationAnnotations failed' };
  }
}

// standalone LS later-open surfaced용 fallback hydration.
//
// antigravity-cli 구현용 주석:
// 실제 workbench는 later-open 시 db.subscribe("trajectorySummaries")로
// trajectorySummariesProvider를 채운다.
//
// 그런데 standalone LS 단순 재현에서는
// browser/agent/override/modelCredits topic은 와도
// trajectorySummaries PushUnifiedStateSyncUpdate는 안 오는 경우가 있었다.
//
// 그래서 LS push만 기다리면 later-open UI surfaced가 닫히지 않는다.
// 여기서는 GetAllCascadeTrajectories의 summary를
// 실제 CascadeTrajectorySummary protobuf bytes(base64)로 재직렬화해서
// state.vscdb의 antigravityUnifiedStateSync.trajectorySummaries에 직접 넣는다.
async function hydrateSurfacedStateToStateDb_func(
  discovery_var: DiscoveryInfo,
  config_var: HeadlessBackendConfig,
  cascade_id_var: string,
  timeout_ms_var: number,
): Promise<UiSurfacedPostProcessResult> {
  try {
    const summary_entry_var = await waitForCondition_func({
      timeoutMs: Math.min(timeout_ms_var, 3_000),
      pollIntervalMs: 500,
      label: 'trajectory summary hydration candidate',
      probe: async () => {
        const summaries_result_var = await callConnectRpc({
          discovery: discovery_var,
          protocol: 'https',
          certPath: config_var.certPath,
          method: 'GetAllCascadeTrajectories',
          payload: {},
          timeoutMs: timeout_ms_var,
        });

        return extractTrajectorySummaryEntries_func(
          summaries_result_var.responseBody,
        ).find(([entry_cascade_id_var]) => entry_cascade_id_var === cascade_id_var) ?? null;
      },
      isReady: (entry_var) => !!entry_var,
    });

    const bundle_var = loadAntigravityBundle_func({
      extensionBundlePath: path.join(config_var.distPath, 'extension.js'),
    });
    const summary_message_var = bundle_var.createMessage_func(
      bundle_var.schemas.cascadeTrajectorySummary,
      summary_entry_var[1],
    );
    const summary_bytes_var = Buffer.from(
      bundle_var.toBinary_func(bundle_var.schemas.cascadeTrajectorySummary, summary_message_var),
    );
    const state_db_reader_var = new StateDbReader(config_var.stateDbPath);
    try {
      const sidebar_workspace_row_var = await state_db_reader_var.createSidebarWorkspaceTopicRowAtomicUpsert_func(
        config_var.workspaceRootUri,
      );
      if (!sidebar_workspace_row_var) {
        return { ok: false, reason: 'sidebar workspace row unavailable' };
      }

      await state_db_reader_var.upsertTopicRowValuesAtomic([
        {
          topicName: 'trajectorySummaries',
          rowKey: cascade_id_var,
          rowValue: summary_bytes_var.toString('base64'),
        },
        sidebar_workspace_row_var,
      ]);
    } finally {
      await state_db_reader_var.close();
    }

    return { ok: true };
  } catch (error_var) {
    return {
      ok: false,
      reason: error_var instanceof Error ? error_var.message : String(error_var),
    };
  }
}

export type UiSurfacedPostProcessResult =
  | { ok: true }
  | { ok: false; reason: string };

function normalizeUiSurfacedReason_func(reason_var: string): string {
  const normalized_reason_var = reason_var.replace(/\s+/g, ' ').trim();
  return normalized_reason_var || 'unknown';
}

export function buildUiSurfacedWarningMessage_func(
  cascade_id_var: string,
  reason_var: string,
): string {
  return `[warn][ui-surfaced] cascadeId=${cascade_id_var} reason=${normalizeUiSurfacedReason_func(reason_var)} ui_visibility=degraded`;
}

function reportUiSurfacedWarning_func(
  cascade_id_var: string,
  result_var: UiSurfacedPostProcessResult,
): void {
  if (result_var.ok) {
    return;
  }

  console.error(buildUiSurfacedWarningMessage_func(cascade_id_var, result_var.reason));
}

function reportCleanupWarning_func(
  label_var: string,
  error_var: unknown,
): void {
  const reason_var = error_var instanceof Error ? error_var.message : String(error_var);
  console.error(`[warn][cleanup] ${label_var} failed: ${reason_var}`);
}

// ─────────────────────────────────────────────────────────────
// steps 기반 종료 판정: plannerResponse가 있는지 확인
//
// stream 상태 전이(IDLE→RUNNING→IDLE)가 관찰되지 않더라도,
// GetCascadeTrajectorySteps에서 plannerResponse step이 존재하면
// 답변이 이미 생성된 것으로 본다 (sc06 waitForPlannerResponses 동일 근거).
//
// 비동기 RPC 호출이므로 for-await 루프 안에서 조건부로만 호출한다.
// 최악의 경우(RPC 실패) false를 반환하여 기존 stream 종료 조건에 의존.
// ─────────────────────────────────────────────────────────────

function hasPlannerResponseInSteps_func(
  discovery_var: DiscoveryInfo,
  config_var: HeadlessBackendConfig,
  cascade_id_var: string,
  cli_var: CliOptions,
): boolean {
  // 동기 판정이 필요하므로, 가장 최근 재조회 결과를 캐시하는 방식은 복잡해진다.
  // 대신 이 함수는 관찰 루프가 이미 재조회한 step들을 기반으로
  // transcript 파일에서 plannerResponse가 있는지 빠르게 확인한다.
  try {
    const project_dir_var = getProjectDir(process.cwd());
    const transcript_path_var = path.join(project_dir_var, `${cascade_id_var}.jsonl`);
    if (!existsSync(transcript_path_var)) return false;
    const content_var = readFileSync(transcript_path_var, 'utf8');
    // transcript의 각 줄은 { index, step: { ... } } 형태.
    // step 안에 plannerResponse case가 있으면 답변 존재.
    return content_var.includes('"plannerResponse"');
  } catch {
    return false;
  }
}

export function recoverPlannerResponseTextFromSteps_func(
  steps_var: Array<Record<string, unknown>>,
): string | null {
  for (let index_var = steps_var.length - 1; index_var >= 0; index_var -= 1) {
    const step_var = steps_var[index_var];
    if (step_var.type !== 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
      continue;
    }

    const planner_response_var = step_var.plannerResponse;
    if (!planner_response_var || typeof planner_response_var !== 'object' || Array.isArray(planner_response_var)) {
      continue;
    }

    const planner_response_record_var = planner_response_var as Record<string, unknown>;
    for (const key_var of ['response', 'modifiedResponse', 'text'] as const) {
      const candidate_var = planner_response_record_var[key_var];
      if (typeof candidate_var === 'string' && candidate_var.trim()) {
        return candidate_var;
      }
    }
  }

  return null;
}

export function extractUserFacingErrorMessagesFromStep_func(
  step_var: Record<string, unknown>,
): string[] {
  if (step_var.type !== 'CORTEX_STEP_TYPE_ERROR_MESSAGE') {
    return [];
  }

  const error_message_var = step_var.errorMessage;
  if (!error_message_var || typeof error_message_var !== 'object' || Array.isArray(error_message_var)) {
    return [];
  }

  const error_record_var = (error_message_var as Record<string, unknown>).error;
  if (!error_record_var || typeof error_record_var !== 'object' || Array.isArray(error_record_var)) {
    return [];
  }

  const messages_var: string[] = [];
  for (const key_var of ['shortError', 'userErrorMessage'] as const) {
    const candidate_var = (error_record_var as Record<string, unknown>)[key_var];
    if (
      typeof candidate_var === 'string'
      && candidate_var.trim()
      && !messages_var.includes(candidate_var)
    ) {
      messages_var.push(candidate_var);
    }
  }

  return messages_var;
}

export function recoverLatestUserFacingErrorMessagesFromSteps_func(
  steps_var: Array<Record<string, unknown>>,
): string[] {
  for (let index_var = steps_var.length - 1; index_var >= 0; index_var -= 1) {
    const messages_var = extractUserFacingErrorMessagesFromStep_func(steps_var[index_var]);
    if (messages_var.length > 0) {
      return messages_var;
    }
  }

  return [];
}

export function shouldFetchStepsForUpdate_func(
  update_summary_var: Pick<ObservedUpdateSummary, 'mainStepsTotalLength' | 'stepIndices'>,
  fetched_step_count_var: number,
): boolean {
  // antigravity-cli 구현용 주석:
  // StreamAgentStateUpdates는 "새 step 추가"뿐 아니라
  // 같은 index의 planner step overwrite도 흘려보낸다.
  // 그래서 totalLength 증가만 보면 Opus의 thinking -> final response 갱신을 놓친다.
  // 다만 transcript/stdout append 단위는 stage57 문서대로 "새 step 증가"를 유지한다.
  // 즉 overwrite는 재조회 트리거로만 쓰고, append 이벤트로 승격하지 않는다.
  return update_summary_var.stepIndices.length > 0
    || (
      update_summary_var.mainStepsTotalLength != null
      && update_summary_var.mainStepsTotalLength > fetched_step_count_var
    );
}

type FetchedStepEntry = {
  index: number;
  step: Record<string, unknown>;
};

export type FetchedStepAppendState = {
  lastAppendedIndex_var: number;
  lastFetchedStepCount_var: number;
  pendingTailEntry_var: FetchedStepEntry | null;
};

export function createFetchedStepAppendState_func(
  last_appended_index_var = -1,
): FetchedStepAppendState {
  return {
    lastAppendedIndex_var: last_appended_index_var,
    lastFetchedStepCount_var: Math.max(last_appended_index_var + 1, 0),
    pendingTailEntry_var: null,
  };
}

export function collectFetchedStepEvents_func(
  steps_var: Array<Record<string, unknown>>,
  append_state_var: FetchedStepAppendState,
): {
  transcriptEntries_var: FetchedStepEntry[];
  stdoutEntries_var: FetchedStepEntry[];
  nextState_var: FetchedStepAppendState;
  responseText_var: string | null;
  latestErrorMessages_var: string[];
} {
  const append_entries_var: FetchedStepEntry[] = [];
  const last_finalizable_index_var = steps_var.length - 2;
  const first_unappended_index_var = append_state_var.lastAppendedIndex_var + 1;

  if (last_finalizable_index_var >= first_unappended_index_var) {
    for (let index_var = first_unappended_index_var; index_var <= last_finalizable_index_var; index_var += 1) {
      append_entries_var.push({
        index: index_var,
        step: steps_var[index_var],
      });
    }
  }

  const last_appended_index_var = append_entries_var.length > 0
    ? append_entries_var[append_entries_var.length - 1].index
    : append_state_var.lastAppendedIndex_var;
  const tail_index_var = steps_var.length - 1;
  const pending_tail_entry_var = tail_index_var > last_appended_index_var
    ? {
        index: tail_index_var,
        step: steps_var[tail_index_var],
      }
    : null;

  return {
    transcriptEntries_var: append_entries_var,
    stdoutEntries_var: append_entries_var,
    nextState_var: {
      lastAppendedIndex_var: last_appended_index_var,
      lastFetchedStepCount_var: steps_var.length,
      pendingTailEntry_var: pending_tail_entry_var,
    },
    responseText_var: recoverPlannerResponseTextFromSteps_func(steps_var),
    latestErrorMessages_var: recoverLatestUserFacingErrorMessagesFromSteps_func(steps_var),
  };
}

export function flushPendingTailStepEvent_func(
  append_state_var: FetchedStepAppendState,
): {
  transcriptEntries_var: FetchedStepEntry[];
  stdoutEntries_var: FetchedStepEntry[];
  nextState_var: FetchedStepAppendState;
} {
  const pending_entry_var = append_state_var.pendingTailEntry_var;
  if (!pending_entry_var || pending_entry_var.index <= append_state_var.lastAppendedIndex_var) {
    return {
      transcriptEntries_var: [],
      stdoutEntries_var: [],
      nextState_var: {
        ...append_state_var,
        pendingTailEntry_var: null,
      },
    };
  }

  return {
    transcriptEntries_var: [pending_entry_var],
    stdoutEntries_var: [pending_entry_var],
    nextState_var: {
      lastAppendedIndex_var: pending_entry_var.index,
      lastFetchedStepCount_var: Math.max(
        append_state_var.lastFetchedStepCount_var,
        pending_entry_var.index + 1,
      ),
      pendingTailEntry_var: null,
    },
  };
}

function appendFetchedStepEvents_func(
  transcript_path_var: string,
  step_entries_var: FetchedStepEntry[],
  emit_to_stdout_var: boolean,
  emit_plain_error_messages_var: boolean,
): void {
  for (const entry_var of step_entries_var) {
    appendTranscriptLine_func(transcript_path_var, entry_var, false);
  }

  if (emit_to_stdout_var) {
    for (const entry_var of step_entries_var) {
      process.stdout.write(`${serializeJsonLine_func(entry_var)}\n`);
    }
  }

  if (emit_plain_error_messages_var) {
    for (const entry_var of step_entries_var) {
      const error_messages_var = extractUserFacingErrorMessagesFromStep_func(entry_var.step);
      if (error_messages_var.length === 0) {
        continue;
      }

      process.stderr.write('\n');
      for (const message_var of error_messages_var) {
        process.stderr.write(`${message_var}\n`);
      }
    }
  }
}

function createFetchedStepAppendStateFromTranscript_func(
  transcript_path_var: string,
): FetchedStepAppendState {
  if (!existsSync(transcript_path_var)) {
    return createFetchedStepAppendState_func();
  }

  try {
    const existing_content_var = readFileSync(transcript_path_var, 'utf8');
    let last_appended_index_var = -1;

    for (const line_var of existing_content_var.split('\n')) {
      if (!line_var.trim()) {
        continue;
      }
      const parsed_var = JSON.parse(line_var) as { index?: unknown };
      if (typeof parsed_var.index === 'number' && Number.isInteger(parsed_var.index)) {
        last_appended_index_var = Math.max(last_appended_index_var, parsed_var.index);
      }
    }

    return createFetchedStepAppendState_func(last_appended_index_var);
  } catch {
    return createFetchedStepAppendState_func();
  }
}

function serializeFetchedStepAppendStateSignature_func(
  append_state_var: FetchedStepAppendState,
): string {
  return serializeJsonLine_func(append_state_var);
}

function isPendingTailStillRunning_func(
  append_state_var: FetchedStepAppendState,
): boolean {
  return append_state_var.pendingTailEntry_var?.step.status === 'CORTEX_STEP_STATUS_RUNNING';
}

async function fetchAndAppendSteps_func(
  discovery_var: DiscoveryInfo,
  config_var: HeadlessBackendConfig,
  cli_var: CliOptions,
  cascade_id_var: string,
  transcript_path_var: string,
  append_state_var: FetchedStepAppendState,
  flush_pending_tail_var = false,
): Promise<{
  nextState_var: FetchedStepAppendState;
  responseText_var: string | null;
  latestErrorMessages_var: string[];
}> {
  const steps_result_var = await callConnectRpc({
    discovery: discovery_var,
    protocol: 'https',
    certPath: config_var.certPath,
    method: 'GetCascadeTrajectorySteps',
    payload: {
      cascadeId: cascade_id_var,
      verbosity: CLIENT_TRAJECTORY_VERBOSITY_PROD_UI,
    },
    timeoutMs: cli_var.timeoutMs,
  });

  const steps_body_var = steps_result_var.responseBody as {
    steps?: Array<Record<string, unknown>>;
  };
  const steps_var = steps_body_var.steps ?? [];

  const step_event_plan_var = collectFetchedStepEvents_func(
    steps_var,
    append_state_var,
  );

  appendFetchedStepEvents_func(
    transcript_path_var,
    step_event_plan_var.transcriptEntries_var,
    cli_var.json,
    !cli_var.json,
  );

  let next_state_var = step_event_plan_var.nextState_var;
  if (flush_pending_tail_var) {
    const flush_plan_var = flushPendingTailStepEvent_func(next_state_var);
    appendFetchedStepEvents_func(
      transcript_path_var,
      flush_plan_var.transcriptEntries_var,
      cli_var.json,
      !cli_var.json,
    );
    next_state_var = flush_plan_var.nextState_var;
  }

  return {
    nextState_var: next_state_var,
    responseText_var: step_event_plan_var.responseText_var,
    latestErrorMessages_var: step_event_plan_var.latestErrorMessages_var,
  };
}

async function stabilizePendingTailBeforeFlush_func(
  discovery_var: DiscoveryInfo,
  config_var: HeadlessBackendConfig,
  cli_var: CliOptions,
  cascade_id_var: string,
  transcript_path_var: string,
  append_state_var: FetchedStepAppendState,
): Promise<{
  nextState_var: FetchedStepAppendState;
  responseText_var: string | null;
  latestErrorMessages_var: string[];
}> {
  // 종료 직전 tail 1개는 overwrite-only update를 더 받을 수 있다.
  // 같은 steps 스냅샷이 연속 두 번 보일 때까지 짧게 재조회한 뒤 flush한다.
  const stabilization_timeout_ms_var = Math.min(5_000, cli_var.timeoutMs);
  const deadline_var = Date.now() + stabilization_timeout_ms_var;
  let latest_state_var = append_state_var;
  let latest_response_var: string | null = null;
  let latest_error_messages_var: string[] = [];
  let previous_signature_var = serializeFetchedStepAppendStateSignature_func(append_state_var);
  let observed_non_running_tail_var = !isPendingTailStillRunning_func(append_state_var);

  while (Date.now() < deadline_var) {
    await new Promise((resolve_var) => setTimeout(resolve_var, 250));

    try {
      const fetch_result_var = await fetchAndAppendSteps_func(
        discovery_var,
        config_var,
        cli_var,
        cascade_id_var,
        transcript_path_var,
        latest_state_var,
        false,
      );
      latest_state_var = fetch_result_var.nextState_var;
      latest_response_var = fetch_result_var.responseText_var ?? latest_response_var;
      latest_error_messages_var = fetch_result_var.latestErrorMessages_var.length > 0
        ? fetch_result_var.latestErrorMessages_var
        : latest_error_messages_var;

      const current_signature_var = serializeFetchedStepAppendStateSignature_func(latest_state_var);
      const pending_tail_running_var = isPendingTailStillRunning_func(latest_state_var);
      if (!pending_tail_running_var && observed_non_running_tail_var && current_signature_var === previous_signature_var) {
        break;
      }
      observed_non_running_tail_var = !pending_tail_running_var;
      previous_signature_var = current_signature_var;
    } catch {
      break;
    }
  }

  return {
    nextState_var: latest_state_var,
    responseText_var: latest_response_var,
    latestErrorMessages_var: latest_error_messages_var,
  };
}


// ─────────────────────────────────────────────────────────────
// main() — 오케스트레이션 엔트리
// ─────────────────────────────────────────────────────────────

export async function main(argv_var: string[]): Promise<void> {
  // ── Root command 감지 (auth는 parseArgv 이전에 처리한다) ──
  // 이유: parseArgv_func()가 argv를 prompt text로 합치기 때문에,
  // `agcl auth list` → `auth list` prompt로 해석될 수 있다.
  const root_cmd_var = detectRootCommand_func(argv_var);
  if (root_cmd_var.kind === 'auth') {
    await handleAuthCommand_func(root_cmd_var.argv);
    return;
  }

  // ── Step 1: argv 파싱 ──
  const cli_var = parseArgv_func(argv_var);

  // ── Step 2: config + preferred model 로드 ──
  const config_var = resolveHeadlessBackendConfig();
  const preferred_model_name_var = await resolvePreferredModelNameFromStateDb_func(config_var.stateDbPath);

  if (cli_var.help) {
    console.log(buildRootHelp_func(preferred_model_name_var));
    return;
  }

  // ── Stdin prompt 해석 ──
  // 명시적 "-" 마커 또는 pipe 자동감지로 stdin에서 prompt를 읽는다.
  if (cli_var.prompt === STDIN_PROMPT_MARKER || (cli_var.prompt === null && !cli_var.resume && !cli_var.help && !process.stdin.isTTY)) {
    const stdin_text_var = await readStdinText_func();
    if (!stdin_text_var) {
      failCli_func('[error] stdin was empty');
    }
    cli_var.prompt = stdin_text_var;
  }

  // ── Step 3: cwd → workspace 고정 ──
  // 전제 조건: process.cwd()가 절대 경로여야 함.
  // 이 값은 workspaceRootPath, workspaceUris[0], transcript 저장에 모두 사용됨 (handoff §5).
  const workspace_root_path_var = process.cwd();
  const workspace_root_uri_var = `file://${workspace_root_path_var}`;
  // workspace_root_uri_var는 StartCascade, resume list 필터 등에서 사용됨.

  // ── Step 4: model alias 해석 ──
  const effective_model_name_var = cli_var.model ?? preferred_model_name_var;
  let model_enum_var: number;
  try {
    model_enum_var = resolveModelAlias_func(effective_model_name_var);
  } catch (error_var) {
    failCli_func(error_var instanceof Error ? error_var.message : String(error_var));
  }

  // ── resume list 분기 (빠른 경로) ──
  // resume list는 LS를 띄워서 GetAllCascadeTrajectories를 호출해야 하므로
  // 아래 LS spawn 이후 분기점에서 처리한다.
  // (prompt 없이 -r만 온 경우)

  // ── validate: 미구현 표면 차단 (spec 성공 조건 9) ──
  const unsupported_error_var = checkUnsupportedSurface_func(argv_var);
  if (unsupported_error_var) {
    failCli_func(
      [
        `[error] ${unsupported_error_var}`,
        'Supported: antigravity-cli "message" | --model/-m | --json/-j | -r/--resume | --background/-b | --help/-h',
      ].join('\n'),
    );
  }

  // ── validate: prompt가 없고 resume도 아니면 에러 ──
  if (!cli_var.prompt && !cli_var.resume) {
    failCli_func(
      [
        'Usage: antigravity-cli "message"',
        '       antigravity-cli --model flash "message"',
        '       antigravity-cli -r',
        '       antigravity-cli -r <cascadeId> "message"',
      ].join('\n'),
    );
  }

  // ── [D] validate: resume send에 prompt 없으면 LS 띄우기 전에 차단 ──
  // 이전에는 handleResumeSend_func 안에서 검증했으나,
  // 그러면 LS spawn + USS + chat stream이 이미 완료된 후에야 에러가 발생했다.
  if (cli_var.resume && cli_var.resumeCascadeId && !cli_var.prompt) {
    failCli_func(
      [
        'Resume send requires a prompt.',
        'Usage: antigravity-cli -r <cascadeId> "your message"',
        'To list conversations: antigravity-cli -r',
      ].join('\n'),
    );
  }

  // ── Live LS discovery → live or offline path ──
  // plan §4.1: discoverLiveLS() → IF found: handleLivePath_func → ELSE: runOfflineSession_func
  const live_connection_var = await discoverLiveLanguageServer_func(
    workspace_root_path_var,
    config_var,
  );

  if (live_connection_var) {
    process.stderr.write('[info] live attach matched\n');
    // fallback 경계는 live attach discovery 단계까지만 허용한다.
    // attach가 성립한 뒤의 read/write RPC 실패는 offline으로 숨기지 않는다.
    await handleLivePath_func(
      live_connection_var,
      config_var,
      workspace_root_path_var,
      cli_var,
      model_enum_var,
      effective_model_name_var,
    );
    return;
  }

  process.stderr.write('[info] live attach unavailable, falling back to offline\n');

  // ── Offline session: spawn own LS, run full flow ──
  await runOfflineSession_func(
    config_var,
    workspace_root_path_var,
    cli_var,
    model_enum_var,
    effective_model_name_var,
  );
}

// ─────────────────────────────────────────────────────────────
// handleLivePath_func — live LS 직접 연결 경로
//
// plan §4.2: 직접 RPC로 대화를 진행한다.
// FakeExtensionServer, LS spawn, discovery wait, USS topic wait 모두 건너뜀.
// state.vscdb hydration은 수행하지 않음 (IDE가 소유).
// ─────────────────────────────────────────────────────────────

async function handleLivePath_func(
  live_connection_var: LiveLsConnection,
  config_var: HeadlessBackendConfig,
  workspace_root_path_var: string,
  cli_var: CliOptions,
  model_enum_var: number,
  effective_model_name_var: string,
): Promise<void> {
  const discovery_var = live_connection_var.discovery;

  // ── live path: 실행 분기 ──
  // resume list는 live path에서도 지원 (read-only이므로 mutating RPC 아님)
  if (cli_var.resume && !cli_var.resumeCascadeId && !cli_var.prompt) {
    // read-only 경로도 live attach 이후에는 offline과 섞지 않는다.
    await handleResumeList_func(discovery_var, config_var, workspace_root_path_var, cli_var);
    return;
  }

  if (cli_var.resume && cli_var.resumeCascadeId) {
    // ── resume send via live path ──
    await handleLiveResumeSend_func(
      live_connection_var, config_var, workspace_root_path_var,
      cli_var, model_enum_var, effective_model_name_var,
    );
    return;
  }

  if (cli_var.prompt) {
    // ── new conversation via live path ──
    await handleLiveNewConversation_func(
      live_connection_var, config_var, workspace_root_path_var,
      cli_var, model_enum_var, effective_model_name_var,
    );
    return;
  }
}

// ── live path: 새 대화 ──
async function handleLiveNewConversation_func(
  live_connection_var: LiveLsConnection,
  config_var: HeadlessBackendConfig,
  workspace_root_path_var: string,
  cli_var: CliOptions,
  model_enum_var: number,
  effective_model_name_var: string,
): Promise<void> {
  const discovery_var = live_connection_var.discovery;

  // StartCascade는 mutating RPC다.
  // 호출이 시작된 뒤 timeout/ECONNRESET/응답 누락이 나도 서버 측 생성 여부를 확정할 수 없으므로
  // live attach 이후에는 절대 offline fallback하지 않는다.
  //
  // 즉 "live attach matched" 이후에는 실패를 숨기기 위해 offline으로 갈아타지 않는다.
  // 여기서 fallback을 허용하면, 이미 서버 측에 생성된 live conversation 위에
  // offline conversation을 하나 더 만들 수 있어서 중복 세션/중복 메시지 문제가 생긴다.
  const start_result_var = await callConnectProtoRpc({
    discovery: discovery_var,
    protocol: 'https',
    certPath: config_var.certPath,
    method: 'StartCascade',
    requestBody: buildStartCascadeRequestProto({
      workspaceUris: [`file://${workspace_root_path_var}`],
    }),
    timeoutMs: cli_var.timeoutMs,
    responseDecoder: decodeStartCascadeResponseProto,
  });

  const cascade_id_var = (start_result_var.responseBody as { cascadeId: string | null }).cascadeId ?? '';
  if (!cascade_id_var) {
    throw new Error('StartCascade did not return cascadeId.');
  }

  if (!cli_var.background) {
    trackConversationLocally_func(
      workspace_root_path_var, cascade_id_var,
      cli_var.prompt ?? null, effective_model_name_var,
    );
  }

  ensureProjectDir(workspace_root_path_var);
  const transcript_path_var = getTranscriptPath(workspace_root_path_var, cascade_id_var);

  const cascade_config_var: CascadeConfigProtoOptions = {
    planModel: model_enum_var,
    requestedModel: { kind: 'model', value: model_enum_var },
    agenticMode: true,
  };

  // SendUserCascadeMessage
  const send_result_var = await callConnectProtoRpc({
    discovery: discovery_var,
    protocol: 'https',
    certPath: config_var.certPath,
    method: 'SendUserCascadeMessage',
    requestBody: buildSendUserCascadeMessageRequestProto({
      cascadeId: cascade_id_var,
      text: cli_var.prompt!,
      cascadeConfig: cascade_config_var,
    }),
    timeoutMs: cli_var.timeoutMs,
    responseDecoder: decodeSendUserCascadeMessageResponseProto,
  });

  const send_decoded_var = send_result_var.responseBody as { queued: boolean };

  // --json init (lifecycle event)
  // 세션과 첫 메시지 전송이 성립한 직후, queue 처리보다 먼저 emit한다.
  if (cli_var.json) {
    emitJsonInit_func(cascade_id_var, effective_model_name_var, workspace_root_path_var, false);
  }

  try {
    if (!cli_var.background) {
      reportUiSurfacedWarning_func(
        cascade_id_var,
        await trackConversationVisibility_func(
          discovery_var, config_var, cascade_id_var, cli_var.timeoutMs,
        ),
      );
    }

    // queued 분기
    if (send_decoded_var.queued) {
      await waitForCondition_func({
        timeoutMs: cli_var.timeoutMs,
        pollIntervalMs: 1000,
        label: 'waiting-idle-before-flush-live',
        probe: async () => {
          const traj_var = await callConnectRpc({
            discovery: discovery_var,
            protocol: 'https',
            certPath: config_var.certPath,
            method: 'GetCascadeTrajectory',
            payload: { cascadeId: cascade_id_var, verbosity: CLIENT_TRAJECTORY_VERBOSITY_PROD_UI },
            timeoutMs: cli_var.timeoutMs,
          });
          return (traj_var.responseBody as { status?: unknown }).status;
        },
        isReady: (status_var) => status_var === CASCADE_RUN_STATUS_IDLE || status_var === 'CASCADE_RUN_STATUS_IDLE',
      });

      await callConnectProtoRpc({
        discovery: discovery_var,
        protocol: 'https',
        certPath: config_var.certPath,
        method: 'SendAllQueuedMessages',
        requestBody: buildSendAllQueuedMessagesRequestProto({
          cascadeId: cascade_id_var,
          cascadeConfig: cascade_config_var,
        }),
        timeoutMs: cli_var.timeoutMs,
      });
    }

    // 관찰 루프 (shared)
    await observeAndAppendSteps_func(
      discovery_var, config_var, cli_var,
      cascade_id_var, transcript_path_var,
    );

    // --json done (lifecycle event) — surfaced 후처리 전에 emit
    if (cli_var.json) {
      emitJsonDone_func(cascade_id_var);
    }

    // ❌ NO state.vscdb hydration — IDE owns its own DB (plan §2)
    // antigravity-cli 구현용 주석:
    // live path는 "이미 떠 있는 IDE LS의 상태"에 붙는 경로다.
    // 따라서 여기서 CLI가 별도로 state.vscdb를 만지면
    // IDE 본체의 unified-state owner와 이중 기록 경쟁을 만들 수 있다.
    // live path의 책임은 RPC + transcript/local tracking까지만이고,
    // Workspaces/UI 쪽 persisted state는 IDE가 자기 경로로 처리하게 둔다.

    if (!cli_var.json) {
      printSessionContinuationNotice_func(
        cascade_id_var, transcript_path_var, config_var.homeDirPath,
      );
    }
  } catch (error_var) {
    throw attachJsonLifecycleSessionId_func(error_var, cascade_id_var);
  }
}

// ── live path: resume send ──
async function handleLiveResumeSend_func(
  live_connection_var: LiveLsConnection,
  config_var: HeadlessBackendConfig,
  workspace_root_path_var: string,
  cli_var: CliOptions,
  model_enum_var: number,
  effective_model_name_var: string,
): Promise<void> {
  const discovery_var = live_connection_var.discovery;
  const cascade_id_var = cli_var.resumeCascadeId!;
  const prompt_var = cli_var.prompt;

  // ── mutating RPC 경계: SendUserCascadeMessage ──
  // resume send는 cascadeId validation이 의미적 에러이므로 fallback 금지 (plan §5.2)
  //
  // 새 대화와 마찬가지로, live attach 이후 resume-send 실패를 offline으로 감추면
  // 같은 user input이 live/offline 양쪽에 이중 반영될 수 있다.
  // 따라서 live path의 mutating RPC는 "실패하면 그대로 실패"가 원칙이다.

  if (!cli_var.background) {
    trackConversationLocally_func(
      workspace_root_path_var, cascade_id_var,
      prompt_var ?? null, effective_model_name_var,
    );
  }

  ensureProjectDir(workspace_root_path_var);
  const transcript_path_var = getTranscriptPath(workspace_root_path_var, cascade_id_var);

  const cascade_config_var: CascadeConfigProtoOptions = {
    planModel: model_enum_var,
    requestedModel: { kind: 'model', value: model_enum_var },
    agenticMode: true,
  };

  const send_result_var = await callConnectProtoRpc({
    discovery: discovery_var,
    protocol: 'https',
    certPath: config_var.certPath,
    method: 'SendUserCascadeMessage',
    requestBody: buildSendUserCascadeMessageRequestProto({
      cascadeId: cascade_id_var,
      text: prompt_var,
      cascadeConfig: cascade_config_var,
    }),
    timeoutMs: cli_var.timeoutMs,
    responseDecoder: decodeSendUserCascadeMessageResponseProto,
  });

  const send_decoded_var = send_result_var.responseBody as { queued: boolean };

  // --json init (lifecycle event)
  // resume도 실제 메시지 전송이 accepted된 직후 emit한다.
  if (cli_var.json) {
    emitJsonInit_func(cascade_id_var, effective_model_name_var, workspace_root_path_var, true);
  }

  try {
    if (!cli_var.background) {
      reportUiSurfacedWarning_func(
        cascade_id_var,
        await trackConversationVisibility_func(
          discovery_var, config_var, cascade_id_var, cli_var.timeoutMs,
        ),
      );
    }

    // queued 분기
    if (send_decoded_var.queued) {
      await waitForCondition_func({
        timeoutMs: cli_var.timeoutMs,
        pollIntervalMs: 1000,
        label: 'waiting-idle-before-flush-live-resume',
        probe: async () => {
          const traj_var = await callConnectRpc({
            discovery: discovery_var,
            protocol: 'https',
            certPath: config_var.certPath,
            method: 'GetCascadeTrajectory',
            payload: { cascadeId: cascade_id_var, verbosity: CLIENT_TRAJECTORY_VERBOSITY_PROD_UI },
            timeoutMs: cli_var.timeoutMs,
          });
          return (traj_var.responseBody as { status?: unknown }).status;
        },
        isReady: (status_var) => status_var === CASCADE_RUN_STATUS_IDLE || status_var === 'CASCADE_RUN_STATUS_IDLE',
      });

      await callConnectProtoRpc({
        discovery: discovery_var,
        protocol: 'https',
        certPath: config_var.certPath,
        method: 'SendAllQueuedMessages',
        requestBody: buildSendAllQueuedMessagesRequestProto({
          cascadeId: cascade_id_var,
          cascadeConfig: cascade_config_var,
        }),
        timeoutMs: cli_var.timeoutMs,
      });
    }

    // 관찰 루프 (shared)
    await observeAndAppendSteps_func(
      discovery_var, config_var, cli_var,
      cascade_id_var, transcript_path_var,
    );

    // --json done (lifecycle event) — surfaced 후처리 전에 emit
    if (cli_var.json) {
      emitJsonDone_func(cascade_id_var);
    }

    // ❌ NO state.vscdb hydration — IDE owns its own DB (plan §2)

    if (!cli_var.json) {
      printSessionContinuationNotice_func(
        cascade_id_var, transcript_path_var, config_var.homeDirPath,
      );
    }
  } catch (error_var) {
    throw attachJsonLifecycleSessionId_func(error_var, cascade_id_var);
  }
}

// ─────────────────────────────────────────────────────────────
// runOfflineSession_func — standalone LS spawn + full flow
//
// main()에서 추출된 Steps 5-14.
// live LS가 없을 때 자체 LS를 띄워서 대화를 진행한다.
// 동작은 추출 전과 100% 동일하다.
// ─────────────────────────────────────────────────────────────

async function runOfflineSession_func(
  config_var: HeadlessBackendConfig,
  workspace_root_path_var: string,
  cli_var: CliOptions,
  model_enum_var: number,
  effective_model_name_var: string,
): Promise<void> {
  // ── Step 5: metadata 생성 ──
  const state_db_reader_var = new StateDbReader(config_var.stateDbPath);
  const oauth_token_var = await state_db_reader_var.extractOAuthAccessToken();
  await state_db_reader_var.close();
  if (!oauth_token_var) {
    failCli_func(
      [
        'OAuth access token not found in state.vscdb.',
        'Antigravity IDE에서 한 번 이상 로그인해야 합니다.',
      ].join('\n'),
    );
  }
  const metadata_var = buildMetadataArtifact(createMetadataFields(config_var, { apiKey: oauth_token_var }));

  // ── Step 6: fake extension server 시작 ──
  const fake_server_var = new FakeExtensionServer({
    stateDbPath: config_var.stateDbPath,
    workspaceRootUri: config_var.workspaceRootUri,
  });
  await fake_server_var.start();

  // ── Step 7: LS spawn ──
  const stderr_chunks_var: Buffer[] = [];
  const start_time_ms_var = Date.now();
  const child_var = spawn(
    config_var.languageServerPath,
    [
      '--enable_lsp',
      `--csrf_token=${randomUUID()}`,
      `--extension_server_port=${fake_server_var.port}`,
      `--extension_server_csrf_token=${randomUUID()}`,
      '--persistent_mode',
      `--workspace_id=${config_var.workspaceId}`,
      '--app_data_dir',
      'antigravity',
      '--random_port',
      '--cloud_code_endpoint=https://cloudcode-pa.googleapis.com',
    ],
    {
      cwd: workspace_root_path_var,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOME: config_var.homeDirPath },
    },
  );

  child_var.stderr.on('data', (chunk_var) => {
    stderr_chunks_var.push(Buffer.isBuffer(chunk_var) ? chunk_var : Buffer.from(chunk_var));
  });

  const child_spawn_error_promise_var = new Promise<never>((_, reject_var) => {
    child_var.once('error', (error_var) => {
      const normalized_error_var = error_var instanceof Error
        ? error_var
        : new Error(String(error_var));
      reject_var(new Error(
        `Failed to spawn language server at ${config_var.languageServerPath}: ${normalized_error_var.message}`,
      ));
    });
  });

  child_var.stdin.write(metadata_var.binary);
  child_var.stdin.end();

  try {
    // ── Step 8: discovery file 대기 ──
    let discovery_result_var: { discoveryPath: string; discovery: DiscoveryInfo };
    try {
      discovery_result_var = await Promise.race([
        waitForDiscoveryFile({
          daemonDirPath: config_var.daemonDirPath,
          pid: child_var.pid,
          startTimeMs: start_time_ms_var,
          timeoutMs: cli_var.timeoutMs,
        }),
        child_spawn_error_promise_var,
      ]) as { discoveryPath: string; discovery: DiscoveryInfo };
    } catch (error_var) {
      const stderr_text_var = Buffer.concat(stderr_chunks_var).toString('utf8').trim();
      const child_state_var = `exitCode=${child_var.exitCode ?? 'null'}, signalCode=${child_var.signalCode ?? 'null'}`;
      const cause_text_var = error_var instanceof Error ? error_var.message : String(error_var);
      throw new Error(
        `${cause_text_var}\n[ls child] ${child_state_var}`
        + (stderr_text_var ? `\n[ls stderr]\n${stderr_text_var}` : ''),
      );
    }
    const discovery_var = discovery_result_var.discovery;

    // ── Step 9: USS topic 구독 대기 ──
    await waitForTopics_func(
      fake_server_var,
      ['uss-oauth', 'uss-enterprisePreferences'],
      cli_var.timeoutMs,
    );

    // ── Step 10~11: chat client stream 열기 ──
    let chat_stream_var: ConnectProtoStreamHandle | null = null;
    try {
      chat_stream_var = startConnectProtoStream({
        discovery: discovery_var,
        protocol: 'https',
        certPath: config_var.certPath,
        method: 'StartChatClientRequestStream',
        requestBody: buildStartChatClientRequestStreamRequestProto(),
        timeoutMs: cli_var.timeoutMs,
        onFrame: () => {},
      });
      await chat_stream_var.responseStarted;
      await Promise.race([
        chat_stream_var.firstFrame,
        new Promise<never>((_, reject_var) =>
          setTimeout(() => reject_var(new Error('chat stream first frame timed out')), 5000),
        ),
      ]);
    } catch {
      console.error('[warn] Chat stream first attempt failed, retrying in 1s...');
      await new Promise((r) => setTimeout(r, 1000));
      try {
        chat_stream_var?.close();
        chat_stream_var = startConnectProtoStream({
          discovery: discovery_var,
          protocol: 'https',
          certPath: config_var.certPath,
          method: 'StartChatClientRequestStream',
          requestBody: buildStartChatClientRequestStreamRequestProto(),
        });
        await chat_stream_var.responseStarted;
        await Promise.race([
          chat_stream_var.firstFrame,
          new Promise<never>((_, reject_var) =>
            setTimeout(() => reject_var(new Error('chat stream retry timed out')), 5000),
          ),
        ]);
      } catch {
        console.error('[warn] Chat stream retry also failed. LS may stall on RUNNING.');
      }
    }

    // ── Step 12: 실행 분기 ──
    if (cli_var.resume && !cli_var.resumeCascadeId && !cli_var.prompt) {
      await handleResumeList_func(discovery_var, config_var, workspace_root_path_var, cli_var);
    } else if (cli_var.resume && cli_var.resumeCascadeId) {
      await handleResumeSend_func(
        discovery_var, config_var, workspace_root_path_var, cli_var,
        model_enum_var, effective_model_name_var,
      );
    } else if (cli_var.prompt) {
      await handleNewConversation_func(
        discovery_var, config_var, workspace_root_path_var, cli_var,
        model_enum_var, effective_model_name_var,
      );
    }

    // ── chat stream cleanup ──
    try { chat_stream_var?.close(); } catch { /* best-effort */ }

  } finally {
    // ── Step 14: cleanup ──
    try {
      await fake_server_var.stop();
    } catch (error_var) {
      reportCleanupWarning_func('fake extension server stop', error_var);
    }

    try {
      await terminateChild_func(child_var);
    } catch (error_var) {
      reportCleanupWarning_func('language server terminate', error_var);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 12a: 새 대화
// StartCascade → SendUserCascadeMessage → 관찰 루프
//   { StreamAgentStateUpdates 트리거 → GetCascadeTrajectorySteps 재조회
//     → steps[] 증가 감지 → transcript append → --json emit }
// → IDLE 전이 → 최종 응답 출력
// ─────────────────────────────────────────────────────────────

async function handleNewConversation_func(
  discovery_var: DiscoveryInfo,
  config_var: HeadlessBackendConfig,
  workspace_root_path_var: string,
  cli_var: CliOptions,
  model_enum_var: number,
  effective_model_name_var: string,
): Promise<void> {
  // StartCascade: 새 대화 생성
  const start_result_var = await callConnectProtoRpc({
    discovery: discovery_var,
    protocol: 'https',
    certPath: config_var.certPath,
    method: 'StartCascade',
    requestBody: buildStartCascadeRequestProto({
      workspaceUris: [`file://${workspace_root_path_var}`],
    }),
    timeoutMs: cli_var.timeoutMs,
    responseDecoder: decodeStartCascadeResponseProto,
  });

  const cascade_id_var = (start_result_var.responseBody as { cascadeId: string | null }).cascadeId;
  if (!cascade_id_var) {
    throw new Error('StartCascade did not return cascadeId.');
  }

  // [B] 새 대화의 실제 cascadeId를 로컬 tracking에 기록
  if (!cli_var.background) {
    trackConversationLocally_func(
      workspace_root_path_var, cascade_id_var,
      cli_var.prompt ?? null, effective_model_name_var,
    );
  }

  // transcript 경로 확보
  ensureProjectDir(workspace_root_path_var);
  const transcript_path_var = getTranscriptPath(workspace_root_path_var, cascade_id_var);

  // cascadeConfig 구성
  const cascade_config_var: CascadeConfigProtoOptions = {
    planModel: model_enum_var,
    requestedModel: {
      kind: 'model',
      value: model_enum_var,
    },
    agenticMode: true,
  };

  // SendUserCascadeMessage: 첫 메시지 전송
  const send_result_var = await callConnectProtoRpc({
    discovery: discovery_var,
    protocol: 'https',
    certPath: config_var.certPath,
    method: 'SendUserCascadeMessage',
    requestBody: buildSendUserCascadeMessageRequestProto({
      cascadeId: cascade_id_var,
      text: cli_var.prompt!,
      cascadeConfig: cascade_config_var,
    }),
    timeoutMs: cli_var.timeoutMs,
    responseDecoder: decodeSendUserCascadeMessageResponseProto,
  });

  const send_decoded_var = send_result_var.responseBody as { queued: boolean };

  // --json init (lifecycle event)
  // queue 대기/flush보다 먼저 emit해서 외부 consumer가 세션을 즉시 추적할 수 있게 한다.
  if (cli_var.json) {
    emitJsonInit_func(cascade_id_var, effective_model_name_var, workspace_root_path_var, false);
  }

  try {
    // queued: true인 경우 IDLE 대기 후 flush (sc06_multiturn.ts L466~487 이관)
    if (send_decoded_var.queued) {
      await waitForCondition_func({
        timeoutMs: cli_var.timeoutMs,
        pollIntervalMs: 1000,
        label: 'waiting-idle-before-flush',
        probe: async () => {
          const trajectory_var = await callConnectRpc({
            discovery: discovery_var,
            protocol: 'https',
            certPath: config_var.certPath,
            method: 'GetCascadeTrajectory',
            payload: { cascadeId: cascade_id_var, verbosity: CLIENT_TRAJECTORY_VERBOSITY_PROD_UI },
            timeoutMs: cli_var.timeoutMs,
          });
          return (trajectory_var.responseBody as { status?: unknown }).status;
        },
        isReady: (status_var) => status_var === CASCADE_RUN_STATUS_IDLE || status_var === 'CASCADE_RUN_STATUS_IDLE',
      });

      await callConnectProtoRpc({
        discovery: discovery_var,
        protocol: 'https',
        certPath: config_var.certPath,
        method: 'SendAllQueuedMessages',
        requestBody: buildSendAllQueuedMessagesRequestProto({
          cascadeId: cascade_id_var,
          cascadeConfig: cascade_config_var,
        }),
        timeoutMs: cli_var.timeoutMs,
      });
    }

    // 관찰 루프: step 증가 감지 → transcript append → --json emit
    // 핵심: StreamAgentStateUpdates는 트리거, GetCascadeTrajectorySteps가 원본 (handoff §1)
    let observe_error_var: unknown = null;
    try {
      await observeAndAppendSteps_func(
        discovery_var, config_var, cli_var,
        cascade_id_var, transcript_path_var,
      );
    } catch (error_var) {
      observe_error_var = error_var;
    }

    // --json done (lifecycle event) — surfaced 후처리 전에 emit
    // done은 observe 단계가 성공적으로 끝난 경우에만 emit한다.
    // observe 에러는 done 없이 re-throw되어 최종 catch의 error 이벤트로 내려간다.
    if (cli_var.json && !observe_error_var) {
      emitJsonDone_func(cascade_id_var);
    }

    if (!cli_var.background) {
      reportUiSurfacedWarning_func(
        cascade_id_var,
        await trackConversationVisibility_func(
          discovery_var,
          config_var,
          cascade_id_var,
          cli_var.timeoutMs,
        ),
      );
      reportUiSurfacedWarning_func(
        cascade_id_var,
        await hydrateSurfacedStateToStateDb_func(
          discovery_var,
          config_var,
          cascade_id_var,
          cli_var.timeoutMs,
        ),
      );
    }

    if (observe_error_var) {
      throw observe_error_var;
    }

    if (!cli_var.json) {
      printSessionContinuationNotice_func(
        cascade_id_var,
        transcript_path_var,
        config_var.homeDirPath,
      );
    }
  } catch (error_var) {
    throw attachJsonLifecycleSessionId_func(error_var, cascade_id_var);
  }
}

// ─────────────────────────────────────────────────────────────
// 12b: resume list
// GetAllCascadeTrajectories → workspace 기준 필터 → 출력
// ─────────────────────────────────────────────────────────────

async function handleResumeList_func(
  discovery_var: DiscoveryInfo,
  config_var: HeadlessBackendConfig,
  workspace_root_path_var: string,
  cli_var: CliOptions,
): Promise<void> {
  const result_var = await callConnectRpc({
    discovery: discovery_var,
    protocol: 'https',
    certPath: config_var.certPath,
    method: 'GetAllCascadeTrajectories',
    payload: {},
    timeoutMs: cli_var.timeoutMs,
  });

  // workspace 기준 필터: workspaceUri가 현재 cwd와 일치하는 것만 표시
  const workspace_uri_var = `file://${workspace_root_path_var}`;
  const entries_var = extractTrajectorySummaryEntries_func(result_var.responseBody);
  let found_count_var = 0;

  for (const [cascade_id_var, trajectory_var] of entries_var) {
    const trajectory_record_var = trajectory_var;
    const all_uris_var = collectTrajectoryWorkspaceUris_func(trajectory_record_var);
    if (all_uris_var.length > 0 && !all_uris_var.includes(workspace_uri_var)) {
      continue;
    }

    const status_var = trajectory_record_var.status ?? 'unknown';
    const title_var = trajectory_record_var.title ?? trajectory_record_var.summary ?? '';
    console.log(`  ${cascade_id_var}  [${status_var}]  ${title_var}`);
    found_count_var += 1;
  }

  // [C] RPC에 없는 대화도 로컬 conversations.jsonl에서 보충
  const local_records_var = dedupeLocalConversationRecords_func(
    readLocalConversations_func(workspace_root_path_var),
  );
  const rpc_ids_var = new Set(entries_var.map(([cascade_id_var]) => cascade_id_var));
  for (const local_var of local_records_var) {
    if (local_var.cascadeId && !rpc_ids_var.has(local_var.cascadeId)) {
      console.log(`  ${local_var.cascadeId}  [local]  ${local_var.prompt ?? '(no prompt)'}`);
      found_count_var += 1;
    }
  }

  if (found_count_var === 0) {
    console.log(`No conversations found for workspace: ${workspace_root_path_var}`);
  }
}

// ─────────────────────────────────────────────────────────────
// 12c: resume send
// SendUserCascadeMessage(cascadeId) → 관찰 루프
// ─────────────────────────────────────────────────────────────

async function handleResumeSend_func(
  discovery_var: DiscoveryInfo,
  config_var: HeadlessBackendConfig,
  workspace_root_path_var: string,
  cli_var: CliOptions,
  model_enum_var: number,
  effective_model_name_var: string,
): Promise<void> {
  const cascade_id_var = cli_var.resumeCascadeId!;
  // [D] prompt 검증은 LS spawn 전(main Step 1 직후)으로 이동됨.
  // 여기에 도달하면 cli_var.prompt는 항상 존재한다.
  const prompt_var = cli_var.prompt;

  // [B] resume send도 로컬 tracking에 기록
  if (!cli_var.background) {
    trackConversationLocally_func(
      workspace_root_path_var, cascade_id_var,
      prompt_var ?? null, effective_model_name_var,
    );
  }

  ensureProjectDir(workspace_root_path_var);
  const transcript_path_var = getTranscriptPath(workspace_root_path_var, cascade_id_var);

  const cascade_config_var: CascadeConfigProtoOptions = {
    planModel: model_enum_var,
    requestedModel: {
      kind: 'model',
      value: model_enum_var,
    },
    agenticMode: true,
  };

  const send_result_var = await callConnectProtoRpc({
    discovery: discovery_var,
    protocol: 'https',
    certPath: config_var.certPath,
    method: 'SendUserCascadeMessage',
    requestBody: buildSendUserCascadeMessageRequestProto({
      cascadeId: cascade_id_var,
      text: prompt_var,
      cascadeConfig: cascade_config_var,
    }),
    timeoutMs: cli_var.timeoutMs,
    responseDecoder: decodeSendUserCascadeMessageResponseProto,
  });

  const send_decoded_var = send_result_var.responseBody as { queued: boolean };

  // --json init (lifecycle event)
  // resume도 queue 대기/flush 전에 emit한다.
  if (cli_var.json) {
    emitJsonInit_func(cascade_id_var, effective_model_name_var, workspace_root_path_var, true);
  }

  try {
    // queued 분기 (12a와 동일한 로직)
    if (send_decoded_var.queued) {
      await waitForCondition_func({
        timeoutMs: cli_var.timeoutMs,
        pollIntervalMs: 1000,
        label: 'waiting-idle-before-flush-resume',
        probe: async () => {
          const traj_var = await callConnectRpc({
            discovery: discovery_var,
            protocol: 'https',
            certPath: config_var.certPath,
            method: 'GetCascadeTrajectory',
            payload: { cascadeId: cascade_id_var, verbosity: CLIENT_TRAJECTORY_VERBOSITY_PROD_UI },
            timeoutMs: cli_var.timeoutMs,
          });
          return (traj_var.responseBody as { status?: unknown }).status;
        },
        isReady: (status_var) => status_var === CASCADE_RUN_STATUS_IDLE || status_var === 'CASCADE_RUN_STATUS_IDLE',
      });

      await callConnectProtoRpc({
        discovery: discovery_var,
        protocol: 'https',
        certPath: config_var.certPath,
        method: 'SendAllQueuedMessages',
        requestBody: buildSendAllQueuedMessagesRequestProto({
          cascadeId: cascade_id_var,
          cascadeConfig: cascade_config_var,
        }),
        timeoutMs: cli_var.timeoutMs,
      });
    }

    // 관찰 루프 (12a와 동일)
    let observe_error_var: unknown = null;
    try {
      await observeAndAppendSteps_func(
        discovery_var, config_var, cli_var,
        cascade_id_var, transcript_path_var,
      );
    } catch (error_var) {
      observe_error_var = error_var;
    }

    // --json done (lifecycle event) — surfaced 후처리 전에 emit
    // observe 에러는 done 없이 최종 catch의 error 이벤트로 승격한다.
    if (cli_var.json && !observe_error_var) {
      emitJsonDone_func(cascade_id_var);
    }

    if (!cli_var.background) {
      reportUiSurfacedWarning_func(
        cascade_id_var,
        await trackConversationVisibility_func(
          discovery_var,
          config_var,
          cascade_id_var,
          cli_var.timeoutMs,
        ),
      );
      reportUiSurfacedWarning_func(
        cascade_id_var,
        await hydrateSurfacedStateToStateDb_func(
          discovery_var,
          config_var,
          cascade_id_var,
          cli_var.timeoutMs,
        ),
      );
    }

    if (observe_error_var) {
      throw observe_error_var;
    }

    if (!cli_var.json) {
      printSessionContinuationNotice_func(
        cascade_id_var,
        transcript_path_var,
        config_var.homeDirPath,
      );
    }
  } catch (error_var) {
    throw attachJsonLifecycleSessionId_func(error_var, cascade_id_var);
  }
}

// ─────────────────────────────────────────────────────────────
// 관찰 루프: stream 트리거 → trajectory 재조회 → step append
//
// 핵심 설계 (plan L287~291):
// - StreamAgentStateUpdates update가 올 때마다 → 트리거
// - GetCascadeTrajectorySteps 재조회 → 진실 원본
// - known_step_count보다 늘었으면 → 새 step만 transcript append
// - --json이면 같은 JSONL 한 줄을 stdout에도 emit한다
//
// collectAgentStateStream_func는 isDone_func가 동기 전용이라
// update마다 비동기 재조회를 못 넣는다.
// 그래서 여기서 직접 for-await 루프를 풀어쓴다.
// ─────────────────────────────────────────────────────────────

async function observeAndAppendSteps_func(
  discovery_var: DiscoveryInfo,
  config_var: HeadlessBackendConfig,
  cli_var: CliOptions,
  cascade_id_var: string,
  transcript_path_var: string,
): Promise<void> {
  // [A] transcript에 이미 기록된 index를 기준으로 append 상태를 복원한다.
  // pending tail은 디스크에 저장하지 않으므로, 현재 런타임 fetch 스냅샷에서만 관리한다.
  let append_state_var = createFetchedStepAppendStateFromTranscript_func(transcript_path_var);
  let final_response_var: string | null = null;
  let latest_error_messages_var: string[] = [];

  // 진행 표시 (성공 조건 3: 스트리밍 UX)
  const spinner_interval_var = setInterval(() => {
    if (!cli_var.json) {
      process.stderr.write('.');
    }
  }, 1000);

  // bundle 로드 + client 생성 (observeStream.ts collectAgentStateStream_func 내부 로직 직접 사용)
  const bundle_var = loadAntigravityBundle_func({
    extensionBundlePath: path.join(config_var.distPath, 'extension.js'),
  });
  const client_var = createLanguageServerClient_func({
    bundle_var,
    config_var: { certPath: config_var.certPath },
    discovery_var: discovery_var,
    protocol_var: 'https',
  });

  // StreamAgentStateUpdates request 생성
  const stream_request_var = bundle_var.createMessage_func(
    bundle_var.schemas.streamAgentStateUpdatesRequest,
    {
      conversationId: cascade_id_var,
      subscriberId: `observe-${randomUUID()}`,
    },
  );

  const state_var = createObservedConversationState_func();
  const abort_controller_var = new AbortController();
  let timed_out_var = false;
  let stream_error_var: unknown = null;

  const timeout_var = setTimeout(() => {
    timed_out_var = true;
    abort_controller_var.abort();
  }, cli_var.timeoutMs);

  try {
    // ── for-await: 매 update마다 재조회 + append ──
    for await (const message_var of client_var.streamAgentStateUpdates(
      stream_request_var,
      { signal: abort_controller_var.signal },
    )) {
      const update_raw_var = (message_var as Record<string, unknown>)?.update;
      if (!update_raw_var) {
        continue;
      }

      // 상태 갱신 (step overwrite + status history)
      const update_summary_var = applyAgentStateUpdate_func(state_var, update_raw_var);

      // ── 핵심: stream update는 트리거, append 결정은 fetch 스냅샷으로만 한다 ──
      // fetch 시점의 마지막 step 1개는 항상 pending tail로 보류한다.
      if (shouldFetchStepsForUpdate_func(update_summary_var, append_state_var.lastFetchedStepCount_var)) {
        try {
          const fetch_result_var = await fetchAndAppendSteps_func(
            discovery_var,
            config_var,
            cli_var,
            cascade_id_var,
            transcript_path_var,
            append_state_var,
          );
          append_state_var = fetch_result_var.nextState_var;
          final_response_var = fetch_result_var.responseText_var ?? final_response_var;
          latest_error_messages_var = fetch_result_var.latestErrorMessages_var.length > 0
            ? fetch_result_var.latestErrorMessages_var
            : latest_error_messages_var;
        } catch {
          // 재조회 실패는 치명적이지 않음 — 다음 트리거에서 재시도
        }
      }

      // ── 종료 조건 (2가지, 먼저 만족되는 쪽) ──
      // 조건 1: stream 상태 전이 IDLE → RUNNING → IDLE (기존)
      if (hasIdleRunningIdleTransition_func(state_var)) {
        break;
      }
      // 조건 2: steps 기반 종료 — status가 IDLE이고 plannerResponse step이 존재
      // stream 전이가 관찰되지 않더라도 steps 원본에 답변이 찍혔으면 완료로 본다.
      // sc06_multiturn.ts의 waitForPlannerResponses_func 판정과 동일한 근거.
      if (
        (state_var.latestStatus === 'CASCADE_RUN_STATUS_IDLE' || state_var.latestStatus === CASCADE_RUN_STATUS_IDLE)
        && append_state_var.lastFetchedStepCount_var > 0
        && (final_response_var != null || hasPlannerResponseInSteps_func(discovery_var, config_var, cascade_id_var, cli_var))
      ) {
        break;
      }
    }
  } catch (error_var) {
    // AbortError는 정상 종료
    const is_abort_var = error_var instanceof Error
      && (error_var.name === 'AbortError' || error_var.message.includes('aborted'));
    if (!is_abort_var) {
      stream_error_var = error_var;
    }
  } finally {
    clearTimeout(timeout_var);
    abort_controller_var.abort();
    clearInterval(spinner_interval_var);
    if (!cli_var.json) {
      process.stderr.write('\n');
    }
  }

  // ── 스트림 종료/abort 후 최종 재조회: timeout이어도 반드시 한 번은 steps를 다시 본다 ──
  // antigravity-cli 구현용 주석:
  // 이전 구현은 timeout으로 AbortError가 나면 이 final fetch 블록 자체가 건너뛰어졌다.
  // 그래서 stream이 먼저 끊기고 steps에는 이미 답이 생긴 케이스도
  // 무조건 "Stream observation timed out"로 끝날 수 있었다.
  try {
    const final_fetch_result_var = await fetchAndAppendSteps_func(
      discovery_var,
      config_var,
      cli_var,
      cascade_id_var,
      transcript_path_var,
      append_state_var,
      false,
    );
    append_state_var = final_fetch_result_var.nextState_var;
    final_response_var = final_fetch_result_var.responseText_var ?? final_response_var;
    latest_error_messages_var = final_fetch_result_var.latestErrorMessages_var.length > 0
      ? final_fetch_result_var.latestErrorMessages_var
      : latest_error_messages_var;

    const stabilized_result_var = await stabilizePendingTailBeforeFlush_func(
      discovery_var,
      config_var,
      cli_var,
      cascade_id_var,
      transcript_path_var,
      append_state_var,
    );
    append_state_var = stabilized_result_var.nextState_var;
    final_response_var = stabilized_result_var.responseText_var ?? final_response_var;
    latest_error_messages_var = stabilized_result_var.latestErrorMessages_var.length > 0
      ? stabilized_result_var.latestErrorMessages_var
      : latest_error_messages_var;

    const final_flush_plan_var = flushPendingTailStepEvent_func(append_state_var);
    appendFetchedStepEvents_func(
      transcript_path_var,
      final_flush_plan_var.transcriptEntries_var,
      cli_var.json,
      !cli_var.json,
    );
    append_state_var = final_flush_plan_var.nextState_var;
  } catch {
    // best-effort
  }

  // stream state 쪽 response ?? modifiedResponse도 마지막에 한 번 더 본다.
  final_response_var = final_response_var ?? recoverObservedResponseText_func(state_var);

  if (stream_error_var) {
    throw stream_error_var;
  }
  if (timed_out_var && !final_response_var) {
    throw new Error(`Stream observation timed out after ${cli_var.timeoutMs}ms.`);
  }

  // ── 최종 응답 출력 ──
  if (final_response_var) {
    if (!cli_var.json) {
      console.log(final_response_var);
    }
  } else if (latest_error_messages_var.length === 0) {
    console.error('[warn] No response text recovered from trajectory.');
  }
}

// ─────────────────────────────────────────────────────────────
// 엔트리 (direct 실행 지원)
// ─────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const is_json_mode_direct_var = process.argv.includes('--json') || process.argv.includes('-j');
  main(process.argv.slice(2)).catch((error_var) => {
    const message_var = formatFatalErrorForStderr_func(error_var);
    console.error(message_var);
    if (is_json_mode_direct_var) {
      emitJsonError_func(
        error_var instanceof Error ? error_var.message : String(error_var),
        extractJsonLifecycleSessionId_func(error_var),
      );
    }
    process.exitCode = 1;
  });
}
