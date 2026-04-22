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
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
  hasObservedTerminalSuccess_func,
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
  getAccount_func,
  getCurrentAccountId_func,
  listAccounts_func,
  setCurrentAccountId_func,
  updateAccountQuotaState_func,
  updateAccountPreTurnSnapshot_func,
  updateAccountRotationState_func,
  updateAccountWakeupHistory_func,
  getStateDbPath_func,
  getDefaultCliDir_func,
  getDefaultDataDir_func,
} from './services/accounts.js';
import {
  buildAuthListTextRenderStages_func,
  buildAuthListRows_func,
  buildParseResultFromQuotaCache_func,
  needsQuotaRefresh_func,
  renderAuthListText_func,
  type AuthListRow,
} from './services/authList.js';
import {
  authLogin_func,
} from './services/authLogin.js';
import {
  applyDeviceProfile_func,
  resolveFingerprintEnvironmentPaths_func,
} from './services/fingerprint.js';
import {
  injectAuthToStateDb_func,
} from './services/authInject.js';
import {
  clearPendingSwitchIntent_func,
  decideAutoRotate_func,
  loadPendingSwitchIntent_func,
  savePendingSwitchIntent_func,
} from './services/rotate.js';
import {
  fetchQuotaForAccounts_func,
  forceRefreshAllQuotas_func,
} from './services/quotaClient.js';
import {
  evaluateSeamlessSwitchFeasibility_func,
} from './services/seamlessSwitch.js';
import {
  executeWakeup_func,
  filterWakeupCandidates_func,
} from './services/wakeup.js';
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

const DEFAULT_CLI_TIMEOUT_MS_var = 15_000;
const OFFLINE_BOOTSTRAP_TIMEOUT_MS_var = 5_000;

export class CliFatalError extends Error {
  constructor(message_var: string) {
    super(message_var);
    this.name = 'CliFatalError';
  }
}

export class ReplayCancelledError extends CliFatalError {
  readonly exitCode_var = 130;

  constructor(message_var = 'Cancelled by user (SIGINT).') {
    super(message_var);
    this.name = 'ReplayCancelledError';
  }
}

export function resolveOfflineBootstrapTimeoutMs_func(cli_timeout_ms_var: number): number {
  return Math.min(cli_timeout_ms_var, OFFLINE_BOOTSTRAP_TIMEOUT_MS_var);
}

export function buildOfflineLanguageServerArgs_func(options_var: {
  extensionServerPort: number;
  workspaceId: string;
  csrfToken: string;
  extensionServerCsrfToken: string;
}): string[] {
  return [
    '--enable_lsp',
    `--csrf_token=${options_var.csrfToken}`,
    `--extension_server_port=${options_var.extensionServerPort}`,
    `--extension_server_csrf_token=${options_var.extensionServerCsrfToken}`,
    '--persistent_mode',
    `--workspace_id=${options_var.workspaceId}`,
    '--app_data_dir',
    'antigravity',
    '--http_server_port=0',
    '--https_server_port=0',
    '--cloud_code_endpoint=https://cloudcode-pa.googleapis.com',
  ];
}

export function buildPrematureLanguageServerExitMessage_func(options_var: {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  stderrText: string;
}): string {
  return `Language server exited prematurely (exitCode=${options_var.exitCode ?? 'null'}, signal=${options_var.signalCode ?? 'null'})`
    + (options_var.stderrText ? `\n[ls stderr]\n${options_var.stderrText}` : '');
}

function failCli_func(message_var: string): never {
  throw new CliFatalError(message_var);
}

type ErrorWithJsonLifecycleSessionId = Error & {
  jsonLifecycleSessionId_var?: string;
  exitCode_var?: number;
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

export function getExitCodeFromError_func(error_var: unknown): number {
  if (error_var instanceof Error) {
    const exit_code_var = (error_var as ErrorWithJsonLifecycleSessionId).exitCode_var;
    if (typeof exit_code_var === 'number' && Number.isInteger(exit_code_var)) {
      return exit_code_var;
    }
  }

  return 1;
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
    '  -r, --resume               List recent sessions (up to 30)',
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
    '  $ antigravity-cli -r                                    List recent workspace sessions',
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
    '  auth refresh                 Force full cloud quota sync for all accounts',
    '  auth login                   Add a new managed account via Antigravity app',
    '',
    'Root Mode:',
    '  - New and resumed conversations talk to the Antigravity language server directly',
    '  - If --background is omitted, local tracking and UI surfaced post-processing are attempted',
    '  - --resume list shows the 30 most recent sessions for the current workspace, with full UUIDs and timestamps',
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

type AuthSubcommand = 'list' | 'refresh' | 'login';

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

export function parseAuthArgv_func(argv_var: string[]): AuthCliOptions | null {
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
    if (arg_var === 'refresh' && !subcommand_var) {
      subcommand_var = 'refresh';
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
    process.stderr.write('Subcommands: list, refresh, login\n');
    process.exitCode = 1;
    return;
  }

  const cli_dir_var = getDefaultCliDir_func();
  const default_data_dir_var = getDefaultDataDir_func();

  if (auth_cli_var.subcommand === 'list') {
    await handleAuthList_func({ cliDir: cli_dir_var, defaultDataDir: default_data_dir_var, json: auth_cli_var.json });
    return;
  }

  if (auth_cli_var.subcommand === 'refresh') {
    await handleAuthRefresh_func({ cliDir: cli_dir_var, defaultDataDir: default_data_dir_var, json: auth_cli_var.json });
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

interface ResolvedAuthAccountEntry {
  name: string;
  userDataDirPath: string;
  email: string | null;
  accountStatus: string | null;
  token: {
    access_token: string;
    refresh_token: string | null;
    expires_in: number;
    expiry_timestamp: number;
    token_type: string;
    project_id: string | null;
  } | null;
  quota_cache: {
    subscription_tier: string | null;
    families: Record<string, { remaining_pct: number | null; reset_time: string | null }>;
    fetch_error: string | null;
    cached_at: number | null;
    last_source: 'cloud' | 'state_vscdb' | null;
    offline_quota_verified_at: number | null;
  } | null;
}

function resolveAuthAccountUserDataDirPath_func(options_var: {
  cliDir: string;
  defaultDataDir: string;
  accountName: string;
}): string {
  return /^user-\d+$/.test(options_var.accountName)
    ? path.join(options_var.cliDir, 'user-data', options_var.accountName)
    : options_var.defaultDataDir;
}

async function loadAuthAccountEntries_func(options_var: {
  cliDir: string;
  defaultDataDir: string;
}): Promise<ResolvedAuthAccountEntry[]> {
  const store_accounts_var = await listAccounts_func({ cliDir: options_var.cliDir });
  if (store_accounts_var.length > 0) {
    return store_accounts_var.map((account_var) => ({
      name: account_var.id,
      userDataDirPath: resolveAuthAccountUserDataDirPath_func({
        cliDir: options_var.cliDir,
        defaultDataDir: options_var.defaultDataDir,
        accountName: account_var.id,
      }),
      email: account_var.email,
      accountStatus: account_var.account_status,
      token: account_var.token,
      quota_cache: {
        subscription_tier: account_var.quota_cache.subscription_tier,
        families: account_var.quota_cache.families,
        fetch_error: account_var.quota_cache.fetch_error,
        cached_at: account_var.quota_cache.cached_at,
        last_source: account_var.quota_cache.last_source,
        offline_quota_verified_at: account_var.quota_cache.offline_quota_verified_at,
      },
    }));
  }

  const legacy_accounts_var = await discoverAccounts_func({
    defaultDataDir: options_var.defaultDataDir,
    cliDir: options_var.cliDir,
  });
  return legacy_accounts_var.map((account_var) => ({
    ...account_var,
    email: null,
    accountStatus: null,
    token: null,
      quota_cache: null,
    }));
  }

async function fetchAndPersistQuotaResults_func(options_var: {
  cliDir: string;
  accounts: ResolvedAuthAccountEntry[];
  forceRefresh: boolean;
}): Promise<Array<{
  account: {
    id: string;
    email: string;
    accountStatus: string;
    token: NonNullable<ResolvedAuthAccountEntry['token']>;
    cacheDir: string;
  };
  result: Awaited<ReturnType<typeof fetchQuotaForAccounts_func>>[number]['result'];
}>> {
  const fetchable_accounts_var = options_var.accounts
    .filter((account_var): account_var is ResolvedAuthAccountEntry & { token: NonNullable<ResolvedAuthAccountEntry['token']> } => account_var.token !== null)
    .map((account_var) => ({
      id: account_var.name,
      email: account_var.email ?? account_var.name,
      accountStatus: account_var.accountStatus ?? 'active',
      token: account_var.token,
      cacheDir: path.join(options_var.cliDir, 'cache', 'quota'),
    }));

  if (fetchable_accounts_var.length === 0) {
    return [];
  }

  const quota_results_var = options_var.forceRefresh
    ? await forceRefreshAllQuotas_func({ accounts: fetchable_accounts_var })
    : await fetchQuotaForAccounts_func({ accounts: fetchable_accounts_var });

  for (const quota_result_var of quota_results_var) {
    await updateAccountQuotaState_func({
      cliDir: options_var.cliDir,
      accountId: quota_result_var.account.id,
      cachedAtMs: quota_result_var.result.data.cachedAtMs,
      subscriptionTier: quota_result_var.result.data.subscriptionTier,
      projectId: quota_result_var.result.data.projectId,
      credits: quota_result_var.result.data.credits,
      families: quota_result_var.result.data.families,
      fetchError: quota_result_var.result.data.fetchError,
      accountStatus: quota_result_var.result.data.accountStatus,
      refreshedToken: quota_result_var.result.data.refreshedToken,
      lastSource: 'cloud',
      offlineQuotaVerifiedAt: null,
    });
  }

  return quota_results_var;
}

function buildAuthAccountsWithParseResult_func(options_var: {
  accounts: ResolvedAuthAccountEntry[];
  quotaResults: Array<{
    account: { id: string; email: string };
    result: { data: { subscriptionTier: string | null; families: Record<string, { remaining_pct: number | null; reset_time: string | null }>; accountStatus: string } };
  }>;
}): Array<{
  name: string;
  userDataDirPath: string;
  parseResult: ReturnType<typeof buildParseResultFromQuotaCache_func> | null;
}> {
  return options_var.accounts.map((account_var) => {
    const quota_result_var = options_var.quotaResults.find((item_var) => item_var.account.id === account_var.name);
    const parse_result_var = quota_result_var
      ? buildParseResultFromQuotaCache_func({
        email: quota_result_var.account.email,
        subscriptionTier: quota_result_var.result.data.subscriptionTier,
        families: quota_result_var.result.data.families,
        accountStatus: quota_result_var.result.data.accountStatus,
      })
      : account_var.quota_cache
        ? buildParseResultFromQuotaCache_func({
          email: account_var.email ?? account_var.name,
          subscriptionTier: account_var.quota_cache.subscription_tier,
          families: account_var.quota_cache.families,
          accountStatus: account_var.accountStatus,
        })
        : null;

    return {
      name: account_var.name,
      userDataDirPath: account_var.userDataDirPath,
      parseResult: parse_result_var,
    };
  });
}

function writeAuthListOutput_func(options_var: {
  accountsWithResult: Array<{
    name: string;
    userDataDirPath: string;
    parseResult: ReturnType<typeof buildParseResultFromQuotaCache_func> | null;
  }>;
  activeAccountName: string;
  json: boolean;
}): void {
  if (options_var.json) {
    const json_output_var = options_var.accountsWithResult.map((account_var, index_var) => ({
      index: index_var + 1,
      active: account_var.name === options_var.activeAccountName,
      name: account_var.name,
      userDataDirPath: account_var.userDataDirPath,
      email: account_var.parseResult?.email ?? null,
      userTierId: account_var.parseResult?.userTierId ?? null,
      userTierName: account_var.parseResult?.userTierName ?? null,
      familyQuotaSummaries: account_var.parseResult?.familyQuotaSummaries ?? [],
      accountStatus: account_var.parseResult?.accountStatus ?? null,
    }));
    process.stdout.write(JSON.stringify(json_output_var, null, 2) + '\n');
    return;
  }

  const rows_var = buildAuthListRows_func({
    accounts: options_var.accountsWithResult,
    activeAccountName: options_var.activeAccountName,
    now: new Date(),
  });
  process.stdout.write(renderAuthListText_func({ rows: rows_var }) + '\n');
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
  const accounts_var = await loadAuthAccountEntries_func({
    cliDir: cli_dir_var,
    defaultDataDir: default_data_dir_var,
  });
  const active_name_var = await getActiveAccountName_func({ cliDir: cli_dir_var });

  const resolved_active_var = accounts_var.some((a_var) => a_var.name === active_name_var)
    ? active_name_var
    : 'default';

  const cached_accounts_with_result_var = buildAuthAccountsWithParseResult_func({
    accounts: accounts_var,
    quotaResults: [],
  });
  const refresh_target_accounts_var = accounts_var.filter((account_var) => account_var.token !== null && needsQuotaRefresh_func({
    quotaCache: account_var.quota_cache,
    now: new Date(),
    requireCurrentAccountVerification: account_var.name === resolved_active_var,
  }));
  const schedule_wakeups_func = async (): Promise<void> => {
    scheduleNeededWakeupsBackground_func({
      accounts: await listAccounts_func({ cliDir: cli_dir_var }),
      workspaceRootPath: process.cwd(),
    });
  };

  if (refresh_target_accounts_var.length === 0) {
    if (json_var) {
      writeAuthListOutput_func({
        accountsWithResult: cached_accounts_with_result_var,
        activeAccountName: resolved_active_var,
        json: true,
      });
      await schedule_wakeups_func();
      return;
    }

    const cached_rows_var = buildAuthListRows_func({
      accounts: cached_accounts_with_result_var,
      activeAccountName: resolved_active_var,
      now: new Date(),
    });

    if (process.stdin.isTTY && process.stdout.isTTY) {
      await schedule_wakeups_func();
      const selected_account_name_var = await interactiveAuthListSelect_func(cached_rows_var);
      if (selected_account_name_var !== null) {
        const selected_account_var = cached_rows_var.find((row_var) => row_var.name === selected_account_name_var);
        if (selected_account_var) {
          const apply_result_var = await applyAuthListSelection_func({
            cliDir: cli_dir_var,
            defaultDataDir: default_data_dir_var,
            accountId: selected_account_var.name,
          });
          process.stdout.write(`Active account → ${selected_account_var.name}\n`);
          if (apply_result_var.restartRequired) {
            process.stderr.write('Live Antigravity session detected. Restart the app to apply the new account.\n');
          }
        }
      }
      return;
    }

    process.stdout.write(renderAuthListText_func({ rows: cached_rows_var }) + '\n');
    await schedule_wakeups_func();
    return;
  }

  const load_refreshed_auth_list_func = async (): Promise<{
    accountsWithResult: Array<{
      name: string;
      userDataDirPath: string;
      parseResult: ReturnType<typeof buildParseResultFromQuotaCache_func> | null;
    }>;
    rows: AuthListRow[];
  }> => {
    const quota_results_var = await fetchAndPersistQuotaResults_func({
      cliDir: cli_dir_var,
      accounts: refresh_target_accounts_var,
      forceRefresh: false,
    });
    const accounts_with_result_var = buildAuthAccountsWithParseResult_func({
      accounts: accounts_var,
      quotaResults: quota_results_var,
    });
    return {
      accountsWithResult: accounts_with_result_var,
      rows: buildAuthListRows_func({
        accounts: accounts_with_result_var,
        activeAccountName: resolved_active_var,
        now: new Date(),
      }),
    };
  };

  if (json_var) {
    const refreshed_auth_list_var = await load_refreshed_auth_list_func();
    writeAuthListOutput_func({
      accountsWithResult: refreshed_auth_list_var.accountsWithResult,
      activeAccountName: resolved_active_var,
      json: true,
    });
    await schedule_wakeups_func();
    return;
  }

  const cached_rows_var = buildAuthListRows_func({
    accounts: cached_accounts_with_result_var,
    activeAccountName: resolved_active_var,
    now: new Date(),
  });
  const refreshed_auth_list_promise_var = load_refreshed_auth_list_func();
  await schedule_wakeups_func();

  if (process.stdin.isTTY && process.stdout.isTTY) {
    const selected_account_name_var = await interactiveAuthListSelect_func(
      cached_rows_var,
      refreshed_auth_list_promise_var.then((result_var) => result_var.rows),
    );
    if (selected_account_name_var !== null) {
      const refreshed_auth_list_var = await refreshed_auth_list_promise_var;
      const selected_account_var = refreshed_auth_list_var.rows.find((row_var) => row_var.name === selected_account_name_var);
      if (selected_account_var) {
        const apply_result_var = await applyAuthListSelection_func({
          cliDir: cli_dir_var,
          defaultDataDir: default_data_dir_var,
          accountId: selected_account_var.name,
        });
        process.stdout.write(`Active account → ${selected_account_var.name}\n`);
        if (apply_result_var.restartRequired) {
          process.stderr.write('Live Antigravity session detected. Restart the app to apply the new account.\n');
        }
      }
    }
    return;
  }

  const cached_stage_text_var = buildAuthListTextRenderStages_func({
    cachedRows: cached_rows_var,
    refreshedRows: null,
  })[0];
  process.stdout.write(`${cached_stage_text_var}\n`);
  const refreshed_auth_list_var = await refreshed_auth_list_promise_var;
  const refreshed_stage_text_var = buildAuthListTextRenderStages_func({
    cachedRows: cached_rows_var,
    refreshedRows: refreshed_auth_list_var.rows,
  })[1];
  if (refreshed_stage_text_var) {
    process.stdout.write(`${refreshed_stage_text_var}\n`);
  }
}

async function handleAuthRefresh_func(options_var: AuthListHandlerOptions): Promise<void> {
  const accounts_var = await loadAuthAccountEntries_func({
    cliDir: options_var.cliDir,
    defaultDataDir: options_var.defaultDataDir,
  });
  const active_name_var = await getActiveAccountName_func({ cliDir: options_var.cliDir });
  const resolved_active_var = accounts_var.some((account_var) => account_var.name === active_name_var)
    ? active_name_var
    : 'default';

  const quota_results_var = await fetchAndPersistQuotaResults_func({
    cliDir: options_var.cliDir,
    accounts: accounts_var,
    forceRefresh: true,
  });
  const accounts_with_result_var = buildAuthAccountsWithParseResult_func({
    accounts: accounts_var,
    quotaResults: quota_results_var,
  });

  writeAuthListOutput_func({
    accountsWithResult: accounts_with_result_var,
    activeAccountName: resolved_active_var,
    json: options_var.json,
  });
  scheduleNeededWakeupsBackground_func({
    accounts: await listAccounts_func({ cliDir: options_var.cliDir }),
    workspaceRootPath: process.cwd(),
  });
}

function resolveUserDataDirForActiveAccount_func(options_var: {
  cliDir: string;
  activeAccountName: string;
}): string | undefined {
  return /^user-\d+$/.test(options_var.activeAccountName)
    ? path.join(options_var.cliDir, 'user-data', options_var.activeAccountName)
    : undefined;
}

async function applyAccountSelectionWithRollback_func(options_var: {
  cliDir: string;
  defaultDataDir: string;
  targetAccountId: string;
  injectAuth: typeof injectAuthToStateDb_func;
  applyDeviceProfile: typeof applyDeviceProfile_func;
}): Promise<void> {
  const previous_account_id_var = await getCurrentAccountId_func({ cliDir: options_var.cliDir });
  const previous_account_var = previous_account_id_var
    ? await getAccount_func({ cliDir: options_var.cliDir, accountId: previous_account_id_var })
    : null;
  const target_account_var = await getAccount_func({
    cliDir: options_var.cliDir,
    accountId: options_var.targetAccountId,
  });
  if (!target_account_var) {
    throw new Error(`Account not found: ${options_var.targetAccountId}`);
  }
  if (!target_account_var.token.refresh_token) {
    throw new Error(`Account requires re-authentication: ${options_var.targetAccountId}`);
  }

  await options_var.injectAuth({
    stateDbPath: getStateDbPath_func({ userDataDirPath: options_var.defaultDataDir }),
    accessToken: target_account_var.token.access_token,
    refreshToken: target_account_var.token.refresh_token,
    expiryTimestampSeconds: target_account_var.token.expiry_timestamp,
  });

  try {
    if (target_account_var.device_profile) {
      options_var.applyDeviceProfile({
        cliDir: options_var.cliDir,
        fingerprintId: target_account_var.fingerprint_id,
        profile: target_account_var.device_profile,
        paths: resolveFingerprintEnvironmentPaths_func(options_var.defaultDataDir),
      });
    }
  } catch (error_var) {
    if (previous_account_var?.token.refresh_token) {
      await options_var.injectAuth({
        stateDbPath: getStateDbPath_func({ userDataDirPath: options_var.defaultDataDir }),
        accessToken: previous_account_var.token.access_token,
        refreshToken: previous_account_var.token.refresh_token,
        expiryTimestampSeconds: previous_account_var.token.expiry_timestamp,
      });
      if (previous_account_var.device_profile) {
        try {
          options_var.applyDeviceProfile({
            cliDir: options_var.cliDir,
            fingerprintId: previous_account_var.fingerprint_id,
            profile: previous_account_var.device_profile,
            paths: resolveFingerprintEnvironmentPaths_func(options_var.defaultDataDir),
          });
        } catch {
          // rollback is best-effort; preserve the original partial-failure reason
        }
      }
    }
    throw new Error(
      `Fingerprint apply failed after auth inject for ${options_var.targetAccountId}: ${
        error_var instanceof Error ? error_var.message : String(error_var)
      }`,
    );
  }

  await setCurrentAccountId_func({
    cliDir: options_var.cliDir,
    accountId: target_account_var.id,
  });
}

export async function applyAuthListSelection_func(options_var: {
  cliDir: string;
  defaultDataDir: string;
  accountId: string;
  injectAuth?: typeof injectAuthToStateDb_func;
  applyDeviceProfile?: typeof applyDeviceProfile_func;
  discoverLiveLanguageServer?: typeof discoverLiveLanguageServer_func;
}): Promise<{ restartRequired: boolean }> {
  const injectAuth_var = options_var.injectAuth ?? injectAuthToStateDb_func;
  const applyDeviceProfile_var = options_var.applyDeviceProfile ?? applyDeviceProfile_func;
  await applyAccountSelectionWithRollback_func({
    cliDir: options_var.cliDir,
    defaultDataDir: options_var.defaultDataDir,
    targetAccountId: options_var.accountId,
    injectAuth: injectAuth_var,
    applyDeviceProfile: applyDeviceProfile_var,
  });

  const config_var = resolveHeadlessBackendConfig();
  const discoverLiveLanguageServer_var = options_var.discoverLiveLanguageServer ?? discoverLiveLanguageServer_func;
  const live_connection_var = await discoverLiveLanguageServer_var(
    config_var.workspaceRootPath,
    { certPath: config_var.certPath, workspaceId: config_var.workspaceId },
  ).catch(() => null);
  const seamless_feasibility_var = evaluateSeamlessSwitchFeasibility_func({
    hasPluginTransport: false,
    hasLiveLanguageServer: live_connection_var !== null,
    hasUnifiedStatePushPath: false,
  });
  const selected_account_var = await getAccount_func({
    cliDir: options_var.cliDir,
    accountId: options_var.accountId,
  });
  if (selected_account_var) {
    scheduleNeededWakeupsBackground_func({
      accounts: [selected_account_var],
      workspaceRootPath: config_var.workspaceRootPath,
    });
  }

  return {
    restartRequired: live_connection_var !== null && seamless_feasibility_var.recommendedFallback === 'full-switch',
  };
}

// ─── alternate screen 인터랙티브 선택기 ───────────────────────

const ESC_ALTERNATE_ON = '\x1b[?1049h';
const ESC_ALTERNATE_OFF = '\x1b[?1049l';
const ESC_CURSOR_HIDE = '\x1b[?25l';
const ESC_CURSOR_SHOW = '\x1b[?25h';
const ESC_HOME_CLEAR = '\x1b[H\x1b[2J';
const ESC_RESET = '\x1b[0m';
const ESC_DIM = '\x1b[2m';
const ESC_BOLD = '\x1b[1m';
const ESC_EMERALD = '\x1b[38;5;49m';   // 밝은 에메랄드 — Antigravity 브랜드 색상
const ESC_EMERALD_BOLD = '\x1b[1;38;5;49m';

/**
 * alternate screen에서 auth list를 보여주고 화살표로 선택.
 * Enter → 선택 (1-indexed), q/Ctrl+C → null.
 */
async function interactiveAuthListSelect_func(
  initial_rows_var: AuthListRow[],
  refreshed_rows_promise_var?: Promise<AuthListRow[]>,
): Promise<string | null> {
  let rows_var = initial_rows_var;
  let is_refreshing_var = Boolean(refreshed_rows_promise_var);

  // 시작 위치: 현재 active row, 없으면 0
  let cursor_var = rows_var.findIndex((r_var) => r_var.active);
  if (cursor_var < 0) cursor_var = 0;

  function render_func(): void {
    const rendered_var = renderAuthListText_func({ rows: rows_var });
    const lines_var = rendered_var.split('\n');
    const header_var = lines_var[0];
    let buf_var = ESC_HOME_CLEAR;

    // 타이틀
    buf_var += `${ESC_EMERALD_BOLD}Antigravity CLI — Account Manager${ESC_RESET}\n`;
    buf_var += `${ESC_DIM}Select an account to switch to. Current account is marked.${ESC_RESET}\n\n`;

    // 헤더
    buf_var += `${ESC_DIM}${header_var}${ESC_RESET}\n`;

    for (let i_var = 0; i_var < rows_var.length; i_var += 1) {
      const line_var = lines_var[i_var + 1] ?? '';
      const current_tag_var = rows_var[i_var].active ? `  ${ESC_DIM}← current${ESC_RESET}` : '';

      if (i_var === cursor_var) {
        buf_var += `${ESC_EMERALD_BOLD}❯ ${line_var.slice(2)}${ESC_RESET}${current_tag_var}\n`;
      } else {
        buf_var += `${line_var}${current_tag_var}\n`;
      }
    }

    buf_var += `\n  ${ESC_DIM}${is_refreshing_var ? 'Refreshing quota in background...' : '↑↓ Navigate  ⏎ Select  q Quit'}${ESC_RESET}\n`;
    process.stdout.write(buf_var);
  }

  // alternate screen 진입
  process.stdout.write(ESC_ALTERNATE_ON + ESC_CURSOR_HIDE);
  render_func();

  return new Promise<string | null>((resolve_var) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const cleanup_func = (): void => {
      process.stdin.removeListener('data', onData_var);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write(ESC_CURSOR_SHOW + ESC_ALTERNATE_OFF);
    };

    const onData_var = (key_var: string): void => {
      if (key_var === '\x1b[A') {
        // ↑
        cursor_var = Math.max(0, cursor_var - 1);
        render_func();
      } else if (key_var === '\x1b[B') {
        // ↓
        cursor_var = Math.min(rows_var.length - 1, cursor_var + 1);
        render_func();
      } else if (key_var === '\r' || key_var === '\n') {
        // Enter
        cleanup_func();
        resolve_var(rows_var[cursor_var]?.name ?? null);
      } else if (key_var === 'q' || key_var === '\x03') {
        // q or Ctrl+C
        cleanup_func();
        resolve_var(null);
      }
    };

    process.stdin.on('data', onData_var);
    if (refreshed_rows_promise_var) {
      void refreshed_rows_promise_var
        .then((refreshed_rows_var) => {
          rows_var = refreshed_rows_var;
          is_refreshing_var = false;
          cursor_var = Math.min(cursor_var, Math.max(refreshed_rows_var.length - 1, 0));
          render_func();
        })
        .catch(() => {
          is_refreshing_var = false;
          render_func();
        });
    }
  });
}

interface AuthLoginHandlerOptions {
  cliDir: string;
  defaultDataDir: string;
}

const INTERNAL_WAKEUP_MODE_ENV_VAR = 'AGCL_INTERNAL_WAKEUP';

function isMessageSendPath_func(cli_var: CliOptions): boolean {
  return Boolean(cli_var.prompt) || Boolean(cli_var.resume && cli_var.resumeCascadeId && cli_var.prompt);
}

function isInternalWakeupMode_func(): boolean {
  return process.env[INTERNAL_WAKEUP_MODE_ENV_VAR] === '1';
}

interface PostPromptQuotaData {
  cachedAtMs: number;
  subscriptionTier: string | null;
  projectId: string | null;
  credits: Array<Record<string, unknown>>;
  families: Record<string, { remaining_pct: number | null; reset_time: string | null }>;
  fetchError: { code: number | null; message: string } | null;
  accountStatus: string;
  refreshedToken?: {
    access_token: string;
    refresh_token: string | null;
    expires_in: number;
    expiry_timestamp: number;
    token_type: string;
    project_id: string | null;
  };
}

interface LocalQuotaSummary {
  subscriptionTier: string | null;
  families: Record<string, { remaining_pct: number | null; reset_time: string | null }>;
}

function areQuotaFamiliesEqual_func(
  left_families_var: Record<string, { remaining_pct: number | null; reset_time: string | null }>,
  right_families_var: Record<string, { remaining_pct: number | null; reset_time: string | null }>,
): boolean {
  const left_keys_var = Object.keys(left_families_var).sort();
  const right_keys_var = Object.keys(right_families_var).sort();
  if (left_keys_var.length !== right_keys_var.length) {
    return false;
  }

  for (let index_var = 0; index_var < left_keys_var.length; index_var += 1) {
    const left_key_var = left_keys_var[index_var];
    const right_key_var = right_keys_var[index_var];
    if (left_key_var !== right_key_var) {
      return false;
    }

    const left_family_var = left_families_var[left_key_var];
    const right_family_var = right_families_var[right_key_var];
    if (
      left_family_var?.remaining_pct !== right_family_var?.remaining_pct
      || left_family_var?.reset_time !== right_family_var?.reset_time
    ) {
      return false;
    }
  }

  return true;
}

function buildLocalQuotaData_func(options_var: {
  localQuota: LocalQuotaSummary;
  nowSeconds: number;
  projectId: string | null;
  accountStatus: string;
  credits?: Array<Record<string, unknown>>;
  refreshedToken?: PostPromptQuotaData['refreshedToken'];
}): PostPromptQuotaData {
  return {
    cachedAtMs: options_var.nowSeconds * 1000,
    subscriptionTier: options_var.localQuota.subscriptionTier,
    projectId: options_var.projectId,
    credits: options_var.credits ?? [],
    families: options_var.localQuota.families,
    fetchError: null,
    accountStatus: options_var.accountStatus,
    refreshedToken: options_var.refreshedToken,
  };
}

export function resolvePostPromptQuotaUpdate_func(options_var: {
  localQuota: LocalQuotaSummary | null;
  cloudQuota: PostPromptQuotaData | null;
  localQuotaTrusted: boolean;
  existingOfflineQuotaVerifiedAt: number | null;
  nowSeconds: number;
  fallbackProjectId?: string | null;
  fallbackAccountStatus?: string;
}): {
  nextQuotaData: PostPromptQuotaData | null;
  lastSource: 'cloud' | 'state_vscdb' | null;
  offlineQuotaVerifiedAt: number | null;
  needsCloudFetch: boolean;
} {
  if (!options_var.localQuota) {
    return options_var.cloudQuota
      ? {
        nextQuotaData: options_var.cloudQuota,
        lastSource: 'cloud',
        offlineQuotaVerifiedAt: null,
        needsCloudFetch: false,
      }
      : {
        nextQuotaData: null,
        lastSource: null,
        offlineQuotaVerifiedAt: null,
        needsCloudFetch: true,
      };
  }

  if (options_var.localQuotaTrusted) {
    return {
      nextQuotaData: buildLocalQuotaData_func({
        localQuota: options_var.localQuota,
        nowSeconds: options_var.nowSeconds,
        projectId: options_var.cloudQuota?.projectId ?? options_var.fallbackProjectId ?? null,
        accountStatus: options_var.cloudQuota?.accountStatus ?? options_var.fallbackAccountStatus ?? 'active',
        credits: options_var.cloudQuota?.credits,
        refreshedToken: options_var.cloudQuota?.refreshedToken,
      }),
      lastSource: 'state_vscdb',
      offlineQuotaVerifiedAt: options_var.existingOfflineQuotaVerifiedAt ?? options_var.nowSeconds,
      needsCloudFetch: false,
    };
  }

  if (!options_var.cloudQuota) {
    return {
      nextQuotaData: null,
      lastSource: null,
      offlineQuotaVerifiedAt: null,
      needsCloudFetch: true,
    };
  }

  const matches_cloud_var = options_var.localQuota.subscriptionTier === options_var.cloudQuota.subscriptionTier
    && areQuotaFamiliesEqual_func(options_var.localQuota.families, options_var.cloudQuota.families);

  if (matches_cloud_var) {
    return {
      nextQuotaData: buildLocalQuotaData_func({
        localQuota: options_var.localQuota,
        nowSeconds: options_var.nowSeconds,
        projectId: options_var.cloudQuota.projectId,
        accountStatus: options_var.cloudQuota.accountStatus,
        credits: options_var.cloudQuota.credits,
        refreshedToken: options_var.cloudQuota.refreshedToken,
      }),
      lastSource: 'state_vscdb',
      offlineQuotaVerifiedAt: options_var.nowSeconds,
      needsCloudFetch: false,
    };
  }

  return {
    nextQuotaData: options_var.cloudQuota,
    lastSource: 'cloud',
    offlineQuotaVerifiedAt: null,
    needsCloudFetch: false,
  };
}

async function capturePreTurnSnapshotIfNeeded_func(options_var: {
  cli: CliOptions;
  cliDir: string;
}): Promise<void> {
  if (!isMessageSendPath_func(options_var.cli) || isInternalWakeupMode_func()) {
    return;
  }

  const current_account_id_var = await getCurrentAccountId_func({ cliDir: options_var.cliDir });
  if (!current_account_id_var) {
    return;
  }

  const current_account_var = await getAccount_func({
    cliDir: options_var.cliDir,
    accountId: current_account_id_var,
  });
  if (!current_account_var) {
    return;
  }

  await updateAccountPreTurnSnapshot_func({
    cliDir: options_var.cliDir,
    accountId: current_account_id_var,
    snapshot: {
      families: Object.fromEntries(
        Object.entries(current_account_var.quota_cache.families).map(([family_name_var, family_var]) => [
          family_name_var,
          { remaining_pct: family_var.remaining_pct },
        ]),
      ),
      captured_at: Math.floor(Date.now() / 1000),
    },
  });
}

async function runPostPromptRotatePipeline_func(options_var: {
  cli: CliOptions;
  cliDir: string;
  defaultDataDir: string;
  stateDbPath?: string;
  requireOfflineQuotaVerification?: boolean;
  nowSeconds?: number;
}): Promise<void> {
  if (!isMessageSendPath_func(options_var.cli) || isInternalWakeupMode_func()) {
    return;
  }

  const current_account_id_var = await getCurrentAccountId_func({ cliDir: options_var.cliDir });
  if (!current_account_id_var) {
    return;
  }

  const current_account_var = await getAccount_func({
    cliDir: options_var.cliDir,
    accountId: current_account_id_var,
  });
  if (!current_account_var?.token.refresh_token) {
    return;
  }

  const now_seconds_var = options_var.nowSeconds ?? Math.floor(Date.now() / 1000);
  let local_quota_var: LocalQuotaSummary | null = null;
  if (options_var.stateDbPath) {
    const state_db_reader_var = new StateDbReader(options_var.stateDbPath);
    try {
      const extracted_local_quota_var = await state_db_reader_var.extractQuotaFromStateDb_func();
      if (extracted_local_quota_var && Object.keys(extracted_local_quota_var.families).length > 0) {
        local_quota_var = extracted_local_quota_var;
      }
    } finally {
      await state_db_reader_var.close();
    }
  }

  let quota_resolution_var = resolvePostPromptQuotaUpdate_func({
    localQuota: local_quota_var,
    cloudQuota: null,
    localQuotaTrusted: options_var.requireOfflineQuotaVerification !== true
      || current_account_var.quota_cache.offline_quota_verified_at !== null,
    existingOfflineQuotaVerifiedAt: current_account_var.quota_cache.offline_quota_verified_at,
    nowSeconds: now_seconds_var,
    fallbackProjectId: current_account_var.token.project_id,
    fallbackAccountStatus: current_account_var.account_status,
  });

  if (quota_resolution_var.needsCloudFetch) {
    const [quota_result_var] = await forceRefreshAllQuotas_func({
      accounts: [{
        id: current_account_var.id,
        email: current_account_var.email,
        accountStatus: current_account_var.account_status,
        token: current_account_var.token,
        cacheDir: path.join(options_var.cliDir, 'cache', 'quota'),
      }],
    });
    if (!quota_result_var) {
      return;
    }
    quota_resolution_var = resolvePostPromptQuotaUpdate_func({
      localQuota: local_quota_var,
      cloudQuota: quota_result_var.result.data,
      localQuotaTrusted: false,
      existingOfflineQuotaVerifiedAt: current_account_var.quota_cache.offline_quota_verified_at,
      nowSeconds: now_seconds_var,
      fallbackProjectId: current_account_var.token.project_id,
      fallbackAccountStatus: current_account_var.account_status,
    });
  }

  if (!quota_resolution_var.nextQuotaData) {
    return;
  }

  const updated_current_account_var = await updateAccountQuotaState_func({
    cliDir: options_var.cliDir,
    accountId: current_account_var.id,
    cachedAtMs: quota_resolution_var.nextQuotaData.cachedAtMs,
    subscriptionTier: quota_resolution_var.nextQuotaData.subscriptionTier,
    projectId: quota_resolution_var.nextQuotaData.projectId,
    credits: quota_resolution_var.nextQuotaData.credits,
    families: quota_resolution_var.nextQuotaData.families,
    fetchError: quota_resolution_var.nextQuotaData.fetchError,
    accountStatus: quota_resolution_var.nextQuotaData.accountStatus as Parameters<typeof updateAccountQuotaState_func>[0]['accountStatus'],
    refreshedToken: quota_resolution_var.nextQuotaData.refreshedToken,
    lastSource: quota_resolution_var.lastSource,
    offlineQuotaVerifiedAt: quota_resolution_var.offlineQuotaVerifiedAt,
  });
  if (!updated_current_account_var) {
    return;
  }

  const all_accounts_var = await listAccounts_func({ cliDir: options_var.cliDir });
  const effective_family_var = options_var.cli.model?.toLowerCase().includes('gemini')
    ? 'GEMINI'
    : 'CLAUDE';
  const decision_var = decideAutoRotate_func({
    currentAccountId: updated_current_account_var.id,
    effectiveFamily: effective_family_var,
    preTurnSnapshot: updated_current_account_var.quota_cache.pre_turn_snapshot,
    accounts: all_accounts_var.map((account_var) => ({
      id: account_var.id,
      email: account_var.email,
      accountStatus: account_var.account_status,
      lastUsed: account_var.last_used,
      subscriptionTier: account_var.quota_cache.subscription_tier,
      families: account_var.quota_cache.families,
      familyBuckets: account_var.rotation.family_buckets,
    })),
    nowSeconds: options_var.nowSeconds ?? Math.floor(Date.now() / 1000),
  });

  if (decision_var.updatedCurrentAccount) {
    await updateAccountRotationState_func({
      cliDir: options_var.cliDir,
      accountId: decision_var.updatedCurrentAccount.id,
      familyBuckets: decision_var.updatedCurrentAccount.familyBuckets,
      accountStatus: decision_var.updatedCurrentAccount.accountStatus as Parameters<typeof updateAccountRotationState_func>[0]['accountStatus'],
    });
  }

  if (!decision_var.pendingSwitch) {
    return;
  }

  const target_account_var = await getAccount_func({
    cliDir: options_var.cliDir,
    accountId: decision_var.pendingSwitch.target_account_id,
  });
  if (!target_account_var?.token.refresh_token) {
    return;
  }

  const pending_switch_record_var = {
    ...decision_var.pendingSwitch,
    fingerprint_id: target_account_var.fingerprint_id ?? null,
    service_machine_id: target_account_var.device_profile?.service_machine_id ?? null,
  };

  const apply_result_var = await applyAuthListSelection_func({
    cliDir: options_var.cliDir,
    defaultDataDir: options_var.defaultDataDir,
    accountId: target_account_var.id,
  });
  if (apply_result_var.restartRequired) {
    console.error(buildPostPromptRotateRestartWarningMessage_func(target_account_var.id));
  }
  await savePendingSwitchIntent_func({
    runtimeDir: path.join(options_var.cliDir, 'runtime'),
    value: pending_switch_record_var,
  });
}

async function performInternalWakeupTurn_func(options_var: {
  userDataDirPath?: string;
  workspaceRootPath: string;
}): Promise<'success' | 'timeout' | 'forbidden' | 'error'> {
  const wakeup_cli_var: CliOptions = {
    prompt: '.',
    model: DEFAULT_MODEL_NAME,
    json: false,
    resume: false,
    resumeCascadeId: null,
    background: true,
    help: false,
    timeoutMs: 60_000,
  };
  const previous_mode_var = process.env[INTERNAL_WAKEUP_MODE_ENV_VAR];
  process.env[INTERNAL_WAKEUP_MODE_ENV_VAR] = '1';

  try {
    await runOfflineSession_func(
      resolveHeadlessBackendConfig({ userDataDirPath: options_var.userDataDirPath }),
      options_var.workspaceRootPath,
      wakeup_cli_var,
      resolveModelAlias_func(DEFAULT_MODEL_NAME),
      DEFAULT_MODEL_NAME,
    );
    return 'success';
  } catch (error_var) {
    const message_var = error_var instanceof Error ? error_var.message : String(error_var);
    if (message_var.includes('403')) {
      return 'forbidden';
    }
    if (message_var.toLowerCase().includes('timeout')) {
      return 'timeout';
    }
    return 'error';
  } finally {
    if (previous_mode_var === undefined) {
      delete process.env[INTERNAL_WAKEUP_MODE_ENV_VAR];
    } else {
      process.env[INTERNAL_WAKEUP_MODE_ENV_VAR] = previous_mode_var;
    }
  }
}

async function executeWakeupForAccount_func(options_var: {
  accountId: string;
  workspaceRootPath: string;
}): Promise<void> {
  const cli_dir_var = getDefaultCliDir_func();
  const default_data_dir_var = getDefaultDataDir_func();
  const account_var = await getAccount_func({
    cliDir: cli_dir_var,
    accountId: options_var.accountId,
  });
  if (!account_var) {
    return;
  }

  const target_user_data_dir_var = resolveUserDataDirForActiveAccount_func({
    cliDir: cli_dir_var,
    activeAccountName: account_var.id,
  });
  const wakeup_user_data_dir_var = target_user_data_dir_var ?? default_data_dir_var;
  const previous_account_id_var = await getCurrentAccountId_func({ cliDir: cli_dir_var });
  const should_restore_var = wakeup_user_data_dir_var === default_data_dir_var
    && previous_account_id_var !== null
    && previous_account_id_var !== account_var.id;

  const wakeup_result_var = await executeWakeup_func({
    nowSeconds: Math.floor(Date.now() / 1000),
    account: {
      id: account_var.id,
      accountStatus: account_var.account_status,
      families: account_var.quota_cache.families,
      wakeupHistory: {
        last_attempt_at: account_var.wakeup_history.last_attempt_at,
        last_result: account_var.wakeup_history.last_result,
        attempt_count: account_var.wakeup_history.attempt_count,
      },
      token: {
        access_token: account_var.token.access_token,
        refresh_token: account_var.token.refresh_token,
        expiry_timestamp: account_var.token.expiry_timestamp,
      },
      fingerprintId: account_var.fingerprint_id,
      deviceProfile: account_var.device_profile,
    },
    injectAuth: async () => {
      if (!account_var.token.refresh_token) {
        throw new Error('refresh token missing');
      }
      await injectAuthToStateDb_func({
        stateDbPath: getStateDbPath_func({ userDataDirPath: wakeup_user_data_dir_var }),
        accessToken: account_var.token.access_token,
        refreshToken: account_var.token.refresh_token,
        expiryTimestampSeconds: account_var.token.expiry_timestamp,
      });
    },
    applyDeviceProfile: account_var.device_profile
      ? async () => {
        applyDeviceProfile_func({
          cliDir: cli_dir_var,
          fingerprintId: account_var.fingerprint_id,
          profile: account_var.device_profile!,
          paths: resolveFingerprintEnvironmentPaths_func(wakeup_user_data_dir_var),
        });
      }
      : undefined,
    performWarmupTurn: async () => await performInternalWakeupTurn_func({
      userDataDirPath: target_user_data_dir_var,
      workspaceRootPath: options_var.workspaceRootPath,
    }),
    persistResult: async (result_var) => {
      await updateAccountWakeupHistory_func({
        cliDir: cli_dir_var,
        accountId: account_var.id,
        result: result_var,
        nowSeconds: Math.floor(Date.now() / 1000),
      });
    },
  });

  if (should_restore_var && previous_account_id_var) {
    await applyAuthListSelection_func({
      cliDir: cli_dir_var,
      defaultDataDir: default_data_dir_var,
      accountId: previous_account_id_var,
    }).catch(() => undefined);
  }

  if (wakeup_result_var.status === 'forbidden') {
    await updateAccountWakeupHistory_func({
      cliDir: cli_dir_var,
      accountId: account_var.id,
      result: 'forbidden',
      nowSeconds: Math.floor(Date.now() / 1000),
    });
  }
}

function scheduleNeededWakeupsBackground_func(options_var: {
  accounts: Awaited<ReturnType<typeof listAccounts_func>>;
  workspaceRootPath: string;
}): void {
  const candidates_var = filterWakeupCandidates_func({
    nowSeconds: Math.floor(Date.now() / 1000),
    accounts: options_var.accounts.map((account_var) => ({
      id: account_var.id,
      accountStatus: account_var.account_status,
      families: account_var.quota_cache.families,
      wakeupHistory: {
        last_attempt_at: account_var.wakeup_history.last_attempt_at,
        last_result: account_var.wakeup_history.last_result,
        attempt_count: account_var.wakeup_history.attempt_count,
      },
    })),
  }).candidates;

  if (candidates_var.length === 0 || isInternalWakeupMode_func()) {
    return;
  }

  void (async () => {
    for (const candidate_var of candidates_var) {
      await executeWakeupForAccount_func({
        accountId: candidate_var.id,
        workspaceRootPath: options_var.workspaceRootPath,
      }).catch(() => undefined);
    }
  })();
}

export async function applyPendingSwitchIntentIfNeeded_func(options_var: {
  cli: CliOptions;
  runtimeDir: string;
  applySelection: (accountId: string) => Promise<void>;
  nowSeconds?: number;
}): Promise<{ applied: boolean; targetAccountId: string | null }> {
  // pending-switch.json은 applied record가 기본 의미다.
  // 이 helper는 테스트/명시적 helper 경로에서만 유지하고,
  // main runtime boot path에서는 replay 용도로 연결하지 않는다.
  if (!isMessageSendPath_func(options_var.cli)) {
    return { applied: false, targetAccountId: null };
  }

  const pending_switch_var = await loadPendingSwitchIntent_func({
    runtimeDir: options_var.runtimeDir,
    nowSeconds: options_var.nowSeconds ?? Math.floor(Date.now() / 1000),
  });
  if (!pending_switch_var) {
    return { applied: false, targetAccountId: null };
  }

  await options_var.applySelection(pending_switch_var.target_account_id);
  await clearPendingSwitchIntent_func({ runtimeDir: options_var.runtimeDir });
  return {
    applied: true,
    targetAccountId: pending_switch_var.target_account_id,
  };
}

export async function decideAndPersistAutoRotate_func(options_var: {
  cli: CliOptions;
  runtimeDir: string;
  loadAccounts: () => Promise<Array<{
    id: string;
    email: string;
    account_status: string;
    last_used: number;
    quota_cache: {
      subscription_tier: string | null;
      families: Record<string, { remaining_pct: number | null; reset_time: string | null }>;
      pre_turn_snapshot: {
        families: Record<string, { remaining_pct: number | null }>;
        captured_at: number;
      } | null;
    };
    rotation: {
      family_buckets: Record<string, string | null>;
    };
  }>>;
  currentAccountId?: string | null;
  nowSeconds?: number;
}): Promise<{ pendingSwitch: { target_account_id: string } | null; warning: string | null }> {
  if (!isMessageSendPath_func(options_var.cli)) {
    return { pendingSwitch: null, warning: null };
  }

  const accounts_var = await options_var.loadAccounts();
  const current_account_id_var = options_var.currentAccountId ?? (await getActiveAccountName_func({ cliDir: getDefaultCliDir_func() }));
  const effective_family_var = options_var.cli.model?.toLowerCase().includes('gemini')
    ? 'GEMINI'
    : 'CLAUDE';

  const decision_var = decideAutoRotate_func({
    currentAccountId: current_account_id_var,
    effectiveFamily: effective_family_var,
    preTurnSnapshot: accounts_var.find((account_var) => account_var.id === current_account_id_var)?.quota_cache.pre_turn_snapshot ?? null,
    accounts: accounts_var.map((account_var) => ({
      id: account_var.id,
      email: account_var.email,
      accountStatus: account_var.account_status,
      lastUsed: account_var.last_used,
      subscriptionTier: account_var.quota_cache.subscription_tier,
      families: account_var.quota_cache.families,
      familyBuckets: account_var.rotation.family_buckets,
    })),
    nowSeconds: options_var.nowSeconds ?? Math.floor(Date.now() / 1000),
  });

  if (decision_var.pendingSwitch) {
    await savePendingSwitchIntent_func({
      runtimeDir: options_var.runtimeDir,
      value: decision_var.pendingSwitch,
    });
  }

  return {
    pendingSwitch: decision_var.pendingSwitch,
    warning: decision_var.warning,
  };
}

async function handleAuthLogin_func(options_var: AuthLoginHandlerOptions): Promise<void> {
  const { cliDir: cli_dir_var, defaultDataDir: default_data_dir_var } = options_var;

  process.stderr.write('Opening browser for login...\n');

  const result_var = await authLogin_func({
    cliDir: cli_dir_var,
    defaultDataDir: default_data_dir_var,
    onAuthUrl: (url_var) => {
      process.stderr.write(`Open this URL to continue login:\n${url_var}\n`);
    },
  });

  if (result_var.status === 'success') {
    process.stdout.write(`Logged in as ${result_var.email}\n`);
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

  if (result_var.status === 'error') {
    process.stderr.write(`Login failed for account ${result_var.accountName}: ${result_var.message}\n`);
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
    timeoutMs: DEFAULT_CLI_TIMEOUT_MS_var,
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
  abortSignal_var?: AbortSignal;
}): Promise<T> {
  const deadline_var = Date.now() + options_var.timeoutMs;
  const poll_interval_ms_var = options_var.pollIntervalMs ?? 250;

  while (Date.now() < deadline_var) {
    if (options_var.abortSignal_var?.aborted) {
      throw new ReplayCancelledError();
    }
    const value_var = await options_var.probe();
    if (options_var.isReady(value_var)) {
      return value_var;
    }
    await sleepWithAbort_func(poll_interval_ms_var, options_var.abortSignal_var);
  }

  throw new Error(`${options_var.label} was not ready within ${options_var.timeoutMs}ms.`);
}

async function sleepWithAbort_func(
  delay_ms_var: number,
  abort_signal_var?: AbortSignal,
): Promise<void> {
  if (abort_signal_var?.aborted) {
    throw new ReplayCancelledError();
  }

  await new Promise<void>((resolve_var, reject_var) => {
    const timeout_var = setTimeout(() => {
      cleanup_var();
      resolve_var();
    }, delay_ms_var);

    const on_abort_var = () => {
      cleanup_var();
      reject_var(new ReplayCancelledError());
    };

    const cleanup_var = () => {
      clearTimeout(timeout_var);
      abort_signal_var?.removeEventListener('abort', on_abort_var);
    };

    abort_signal_var?.addEventListener('abort', on_abort_var, { once: true });
  });
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

type LocalConversationRecord = {
  cascadeId: string | null;
  prompt: string | null;
  createdAt: string;
  model: string;
};

type ResumeListEntrySource = 'rpc' | 'local';

type ResumeListEntry = {
  cascadeId: string;
  status: string;
  title: string;
  source: ResumeListEntrySource;
  sortTimestampMs: number | null;
  displayTime: string;
};

const RESUME_LIST_MAX_ITEMS_var = 30;
const RESUME_LIST_UNKNOWN_TIME_LABEL_var = '(unknown time)';
const RESUME_LIST_TIMESTAMP_KEYS_var = [
  'updatedAt',
  'lastUpdatedAt',
  'modifiedAt',
  'lastMessageAt',
  'lastUserMessageAt',
  'lastAssistantMessageAt',
  'createdAt',
  'startedAt',
  'timestamp',
  'lastUserViewTime',
] as const;

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
): LocalConversationRecord[] {
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
  records_var: LocalConversationRecord[],
): LocalConversationRecord[] {
  const latest_by_id_var = new Map<string, LocalConversationRecord>();
  const without_id_var: LocalConversationRecord[] = [];

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

function parseResumeListTimestampMs_func(value_var: unknown): number | null {
  if (typeof value_var === 'string') {
    const trimmed_var = value_var.trim();
    if (!trimmed_var) {
      return null;
    }
    const parsed_timestamp_ms_var = Date.parse(trimmed_var);
    return Number.isNaN(parsed_timestamp_ms_var) ? null : parsed_timestamp_ms_var;
  }

  if (typeof value_var === 'number' && Number.isFinite(value_var) && value_var > 0) {
    return value_var >= 1_000_000_000_000 ? value_var : value_var * 1000;
  }

  return null;
}

export function formatResumeListTimeLabel_func(timestamp_ms_var: number | null): string {
  if (timestamp_ms_var === null || !Number.isFinite(timestamp_ms_var)) {
    return RESUME_LIST_UNKNOWN_TIME_LABEL_var;
  }

  const date_var = new Date(timestamp_ms_var);
  if (Number.isNaN(date_var.getTime())) {
    return RESUME_LIST_UNKNOWN_TIME_LABEL_var;
  }

  const pad2_func = (value_var: number): string => String(value_var).padStart(2, '0');

  return [
    `${date_var.getFullYear()}-${pad2_func(date_var.getMonth() + 1)}-${pad2_func(date_var.getDate())}`,
    `${pad2_func(date_var.getHours())}:${pad2_func(date_var.getMinutes())}`,
  ].join(' ');
}

function extractTrajectorySummaryTimestampMs_func(
  trajectory_record_var: Record<string, unknown>,
): number | null {
  let best_timestamp_ms_var: number | null = null;

  const updateBestTimestamp_func = (value_var: unknown): void => {
    const parsed_timestamp_ms_var = parseResumeListTimestampMs_func(value_var);
    if (parsed_timestamp_ms_var === null) {
      return;
    }
    if (best_timestamp_ms_var === null || parsed_timestamp_ms_var > best_timestamp_ms_var) {
      best_timestamp_ms_var = parsed_timestamp_ms_var;
    }
  };

  const collectTimestampCandidates_func = (value_var: unknown): void => {
    if (!value_var || typeof value_var !== 'object' || Array.isArray(value_var)) {
      return;
    }

    const record_var = value_var as Record<string, unknown>;
    for (const key_var of RESUME_LIST_TIMESTAMP_KEYS_var) {
      updateBestTimestamp_func(record_var[key_var]);
    }
  };

  collectTimestampCandidates_func(trajectory_record_var);
  collectTimestampCandidates_func(trajectory_record_var.trajectoryMetadata);
  collectTimestampCandidates_func(trajectory_record_var.annotations);

  return best_timestamp_ms_var;
}

function createResumeListEntry_func(options_var: {
  cascadeId_var: string;
  status_var: string;
  title_var: string;
  source_var: ResumeListEntrySource;
  sortTimestampMs_var: number | null;
}): ResumeListEntry {
  return {
    cascadeId: options_var.cascadeId_var,
    status: options_var.status_var,
    title: options_var.title_var,
    source: options_var.source_var,
    sortTimestampMs: options_var.sortTimestampMs_var,
    displayTime: formatResumeListTimeLabel_func(options_var.sortTimestampMs_var),
  };
}

function mergeResumeListEntries_func(
  existing_entry_var: ResumeListEntry,
  next_entry_var: ResumeListEntry,
): ResumeListEntry {
  const rpc_entry_var = existing_entry_var.source === 'rpc'
    ? existing_entry_var
    : next_entry_var.source === 'rpc'
      ? next_entry_var
      : null;
  const local_entry_var = existing_entry_var.source === 'local'
    ? existing_entry_var
    : next_entry_var.source === 'local'
      ? next_entry_var
      : null;
  const merged_timestamp_ms_var = (
    existing_entry_var.sortTimestampMs !== null
    && next_entry_var.sortTimestampMs !== null
  )
    ? Math.max(existing_entry_var.sortTimestampMs, next_entry_var.sortTimestampMs)
    : (existing_entry_var.sortTimestampMs ?? next_entry_var.sortTimestampMs);
  const rpc_title_var = rpc_entry_var?.title.trim() ? rpc_entry_var.title : '';
  const local_title_var = local_entry_var?.title ?? '';

  return createResumeListEntry_func({
    cascadeId_var: existing_entry_var.cascadeId,
    status_var: rpc_entry_var?.status ?? local_entry_var?.status ?? 'unknown',
    title_var: rpc_title_var || local_title_var,
    source_var: rpc_entry_var ? 'rpc' : 'local',
    sortTimestampMs_var: merged_timestamp_ms_var,
  });
}

export function buildResumeListEntries_func(options_var: {
  rpcEntries_var: Array<[string, Record<string, unknown>]>;
  localRecords_var: LocalConversationRecord[];
  workspaceUri_var: string;
}): ResumeListEntry[] {
  const merged_entries_var = new Map<string, ResumeListEntry>();

  for (const [cascade_id_var, trajectory_record_var] of options_var.rpcEntries_var) {
    const all_uris_var = collectTrajectoryWorkspaceUris_func(trajectory_record_var);
    if (all_uris_var.length > 0 && !all_uris_var.includes(options_var.workspaceUri_var)) {
      continue;
    }

    const title_var = typeof trajectory_record_var.title === 'string'
      ? trajectory_record_var.title
      : typeof trajectory_record_var.summary === 'string'
        ? trajectory_record_var.summary
        : '';
    const status_var = typeof trajectory_record_var.status === 'string'
      ? trajectory_record_var.status
      : 'unknown';
    const next_entry_var = createResumeListEntry_func({
      cascadeId_var: cascade_id_var,
      status_var,
      title_var,
      source_var: 'rpc',
      sortTimestampMs_var: extractTrajectorySummaryTimestampMs_func(trajectory_record_var),
    });
    const existing_entry_var = merged_entries_var.get(cascade_id_var);
    merged_entries_var.set(
      cascade_id_var,
      existing_entry_var
        ? mergeResumeListEntries_func(existing_entry_var, next_entry_var)
        : next_entry_var,
    );
  }

  const deduped_local_records_var = dedupeLocalConversationRecords_func(options_var.localRecords_var);
  for (const local_record_var of deduped_local_records_var) {
    if (!local_record_var.cascadeId) {
      continue;
    }

    const next_entry_var = createResumeListEntry_func({
      cascadeId_var: local_record_var.cascadeId,
      status_var: 'local',
      title_var: local_record_var.prompt ?? '(no prompt)',
      source_var: 'local',
      sortTimestampMs_var: parseResumeListTimestampMs_func(local_record_var.createdAt),
    });
    const existing_entry_var = merged_entries_var.get(local_record_var.cascadeId);
    merged_entries_var.set(
      local_record_var.cascadeId,
      existing_entry_var
        ? mergeResumeListEntries_func(existing_entry_var, next_entry_var)
        : next_entry_var,
    );
  }

  return [...merged_entries_var.values()]
    .sort((left_var, right_var) => {
      const left_timestamp_ms_var = left_var.sortTimestampMs ?? Number.NEGATIVE_INFINITY;
      const right_timestamp_ms_var = right_var.sortTimestampMs ?? Number.NEGATIVE_INFINITY;
      if (left_timestamp_ms_var !== right_timestamp_ms_var) {
        return right_timestamp_ms_var - left_timestamp_ms_var;
      }
      return left_var.cascadeId.localeCompare(right_var.cascadeId);
    })
    .slice(0, RESUME_LIST_MAX_ITEMS_var);
}

export function formatResumeListEntryLine_func(entry_var: ResumeListEntry): string {
  return `  ${entry_var.displayTime}  ${entry_var.cascadeId}  [${entry_var.status}]  ${entry_var.title}`.trimEnd();
}

export function buildResumeListOutputLines_func(
  entries_var: ResumeListEntry[],
  workspace_root_path_var: string,
): string[] {
  if (entries_var.length === 0) {
    return [`No conversations found for workspace: ${workspace_root_path_var}`];
  }

  return entries_var.map((entry_var) => formatResumeListEntryLine_func(entry_var));
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

export function buildPostPromptRotateRestartWarningMessage_func(target_account_id_var: string): string {
  return `[warn][post-prompt-rotate] target_account_id=${target_account_id_var} live_session_restart_required=true reason=restart_antigravity_app_to_use_switched_account`;
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

export type StepErrorDetails = {
  errorCode: number | null;
  shortError: string | null;
  userErrorMessage: string | null;
  modelErrorMessage: string | null;
  fullError: string | null;
  details: string | null;
  rpcErrorDetails: string[];
};

const RETRYABLE_ERROR_PREFIXES_var = [
  'RESOURCE_EXHAUSTED',
  'INTERNAL',
  'DEADLINE_EXCEEDED',
  'UNAVAILABLE',
] as const;

export type ReplayableStepErrorCandidate = {
  errorDetails_var: StepErrorDetails;
  stepIndex_var: number;
  ignoredExecutionId_var: string | null;
};

function normalizeStringField_func(value_var: unknown): string | null {
  return typeof value_var === 'string' && value_var.trim().length > 0
    ? value_var
    : null;
}

function normalizeStringListField_func(value_var: unknown): string[] {
  return Array.isArray(value_var)
    ? value_var.filter((entry_var): entry_var is string => typeof entry_var === 'string' && entry_var.trim().length > 0)
    : [];
}

function extractErrorRecordFromStep_func(
  step_var: Record<string, unknown>,
): Record<string, unknown> | null {
  if (step_var.type === 'CORTEX_STEP_TYPE_ERROR_MESSAGE') {
    const error_message_var = step_var.errorMessage;
    if (!error_message_var || typeof error_message_var !== 'object' || Array.isArray(error_message_var)) {
      return null;
    }
    const error_record_var = (error_message_var as Record<string, unknown>).error;
    return error_record_var && typeof error_record_var === 'object' && !Array.isArray(error_record_var)
      ? error_record_var as Record<string, unknown>
      : null;
  }

  const direct_error_var = step_var.error;
  return direct_error_var && typeof direct_error_var === 'object' && !Array.isArray(direct_error_var)
    ? direct_error_var as Record<string, unknown>
    : null;
}

function extractPlannerResponseRecord_func(
  step_var: Record<string, unknown>,
): Record<string, unknown> | null {
  const planner_response_var = step_var.plannerResponse;
  return planner_response_var && typeof planner_response_var === 'object' && !Array.isArray(planner_response_var)
    ? planner_response_var as Record<string, unknown>
    : null;
}

export function extractStepMetadataRecord_func(
  step_var: Record<string, unknown>,
): Record<string, unknown> | null {
  const metadata_var = step_var.metadata ?? step_var.stepMetadata;
  return metadata_var && typeof metadata_var === 'object' && !Array.isArray(metadata_var)
    ? metadata_var as Record<string, unknown>
    : null;
}

function extractStepInternalMetadataRecord_func(
  step_var: Record<string, unknown>,
): Record<string, unknown> | null {
  const internal_metadata_var = step_var.internalMetadata;
  return internal_metadata_var && typeof internal_metadata_var === 'object' && !Array.isArray(internal_metadata_var)
    ? internal_metadata_var as Record<string, unknown>
    : null;
}

export function extractStepExecutionId_func(
  step_var: Record<string, unknown>,
): string | null {
  const metadata_var = extractStepMetadataRecord_func(step_var);
  return normalizeStringField_func(metadata_var?.executionId ?? step_var.executionId);
}

export function extractPlannerStopReason_func(
  step_var: Record<string, unknown>,
): string | null {
  return normalizeStringField_func(extractPlannerResponseRecord_func(step_var)?.stopReason);
}

function hasDoneTransitionInInternalMetadata_func(
  step_var: Record<string, unknown>,
): boolean {
  const internal_metadata_var = extractStepInternalMetadataRecord_func(step_var);
  const status_transitions_var = internal_metadata_var?.statusTransitions;
  if (!Array.isArray(status_transitions_var)) {
    return false;
  }

  return status_transitions_var.some((transition_var) => {
    if (!transition_var || typeof transition_var !== 'object' || Array.isArray(transition_var)) {
      return false;
    }

    return Object.values(transition_var as Record<string, unknown>).some((value_var) => (
      value_var === 'CORTEX_STEP_STATUS_DONE'
    ));
  });
}

function hasCompletedStepMetadata_func(step_var: Record<string, unknown>): boolean {
  const metadata_var = extractStepMetadataRecord_func(step_var);
  return normalizeStringField_func(metadata_var?.completedAt) != null
    || hasDoneTransitionInInternalMetadata_func(step_var);
}

export function isPlannerSuccessTerminal_func(
  step_var: Record<string, unknown>,
): boolean {
  if (step_var.type !== 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
    return false;
  }

  const metadata_var = extractStepMetadataRecord_func(step_var);
  return step_var.status === 'CORTEX_STEP_STATUS_DONE'
    && normalizeStringField_func(metadata_var?.completedAt) != null
    && normalizeStringField_func(metadata_var?.finishedGeneratingAt) != null
    && extractPlannerStopReason_func(step_var) === 'STOP_REASON_STOP_PATTERN';
}

export function isPlannerFailureTerminal_func(
  step_var: Record<string, unknown>,
): boolean {
  if (step_var.type !== 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
    return false;
  }

  const stop_reason_var = extractPlannerStopReason_func(step_var);
  if (!stop_reason_var) {
    return false;
  }

  const metadata_var = extractStepMetadataRecord_func(step_var);
  return step_var.status === 'CORTEX_STEP_STATUS_DONE'
    && normalizeStringField_func(metadata_var?.completedAt) != null
    && normalizeStringField_func(metadata_var?.finishedGeneratingAt) != null
    && [
      'STOP_REASON_CLIENT_STREAM_ERROR',
      'STOP_REASON_CLIENT_CANCELED',
      'STOP_REASON_CLIENT_TOOL_PARSE_ERROR',
    ].includes(stop_reason_var);
}

export function extractTerminalPlannerResponseTextFromStep_func(
  step_var: Record<string, unknown>,
): string | null {
  if (!isPlannerSuccessTerminal_func(step_var)) {
    return null;
  }

  const planner_response_var = extractPlannerResponseRecord_func(step_var);
  if (!planner_response_var) {
    return null;
  }

  for (const key_var of ['response', 'modifiedResponse', 'text'] as const) {
    const candidate_var = planner_response_var[key_var];
    if (typeof candidate_var === 'string' && candidate_var.trim().length > 0) {
      return candidate_var;
    }
  }

  return null;
}

export function shouldAppendPlannerStepToTranscript_func(
  step_var: Record<string, unknown>,
): boolean {
  return isPlannerSuccessTerminal_func(step_var);
}

export function isTranscriptFinalizableStep_func(
  step_var: Record<string, unknown>,
): boolean {
  if (isPlannerSuccessTerminal_func(step_var) || isPlannerFailureTerminal_func(step_var)) {
    return true;
  }

  if (step_var.status !== 'CORTEX_STEP_STATUS_DONE') {
    return false;
  }

  switch (step_var.type) {
    case 'CORTEX_STEP_TYPE_USER_INPUT':
      return extractStepExecutionId_func(step_var) != null;
    case 'CORTEX_STEP_TYPE_ERROR_MESSAGE':
      return extractErrorRecordFromStep_func(step_var) != null;
    case 'CORTEX_STEP_TYPE_COMMAND_STATUS':
    case 'CORTEX_STEP_TYPE_RUN_COMMAND':
    case 'CORTEX_STEP_TYPE_VIEW_FILE':
    case 'CORTEX_STEP_TYPE_LIST_DIRECTORY':
    case 'CORTEX_STEP_TYPE_CHECKPOINT':
    case 'CORTEX_STEP_TYPE_CONVERSATION_HISTORY':
    case 'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE':
    case 'CORTEX_STEP_TYPE_CODE_ACTION':
      return hasCompletedStepMetadata_func(step_var);
    default:
      return hasCompletedStepMetadata_func(step_var);
  }
}

export function extractStepErrorDetailsFromStep_func(
  step_var: Record<string, unknown>,
): StepErrorDetails | null {
  const error_record_var = extractErrorRecordFromStep_func(step_var);
  if (!error_record_var) {
    return null;
  }

  return {
    errorCode: typeof error_record_var.errorCode === 'number' ? error_record_var.errorCode : null,
    shortError: normalizeStringField_func(error_record_var.shortError),
    userErrorMessage: normalizeStringField_func(error_record_var.userErrorMessage),
    modelErrorMessage: normalizeStringField_func(error_record_var.modelErrorMessage),
    fullError: normalizeStringField_func(error_record_var.fullError),
    details: normalizeStringField_func(error_record_var.details),
    rpcErrorDetails: normalizeStringListField_func(error_record_var.rpcErrorDetails),
  };
}

function collectErrorReasonsFromUnknown_func(
  value_var: unknown,
  accumulator_var: Set<string>,
): void {
  if (!value_var || typeof value_var !== 'object') {
    return;
  }

  if (Array.isArray(value_var)) {
    for (const entry_var of value_var) {
      collectErrorReasonsFromUnknown_func(entry_var, accumulator_var);
    }
    return;
  }

  const record_var = value_var as Record<string, unknown>;
  if (typeof record_var.reason === 'string' && record_var.reason.trim().length > 0) {
    accumulator_var.add(record_var.reason);
  }

  for (const nested_var of Object.values(record_var)) {
    collectErrorReasonsFromUnknown_func(nested_var, accumulator_var);
  }
}

function collectErrorReasonsFromText_func(
  text_var: string | null,
  accumulator_var: Set<string>,
): void {
  if (!text_var) {
    return;
  }

  try {
    collectErrorReasonsFromUnknown_func(JSON.parse(text_var), accumulator_var);
  } catch {
    // ignore malformed JSON fragments
  }
}

function collectErrorReasonsFromDetails_func(error_details_var: StepErrorDetails): string[] {
  const reasons_var = new Set<string>();
  collectErrorReasonsFromText_func(error_details_var.details, reasons_var);
  for (const rpc_detail_var of error_details_var.rpcErrorDetails) {
    collectErrorReasonsFromText_func(rpc_detail_var, reasons_var);
  }
  return [...reasons_var];
}

export function isRetryableStepErrorForReplay_func(
  error_details_var: StepErrorDetails,
): boolean {
  if (error_details_var.errorCode === 403) {
    return false;
  }

  const reasons_var = collectErrorReasonsFromDetails_func(error_details_var);
  if (
    error_details_var.errorCode === 429
    && (
      reasons_var.includes('INSUFFICIENT_G1_CREDITS_BALANCE')
      || reasons_var.includes('QUOTA_EXHAUSTED')
    )
  ) {
    return false;
  }

  const text_fields_var = [
    error_details_var.shortError,
    error_details_var.modelErrorMessage,
  ].filter((entry_var): entry_var is string => Boolean(entry_var));

  return RETRYABLE_ERROR_PREFIXES_var.some((prefix_var) => (
    text_fields_var.some((text_var) => text_var.includes(prefix_var))
  ));
}

function shouldIgnoreStepByExecutionId_func(
  step_var: Record<string, unknown>,
  ignored_execution_ids_var: ReadonlySet<string>,
): boolean {
  const execution_id_var = extractStepExecutionId_func(step_var);
  return execution_id_var != null && ignored_execution_ids_var.has(execution_id_var);
}

function findLatestExecutionIdBeforeErrorStep_func(
  steps_var: Array<Record<string, unknown>>,
  error_step_index_var: number,
): string | null {
  for (let index_var = error_step_index_var - 1; index_var >= 0; index_var -= 1) {
    const step_var = steps_var[index_var];
    if (step_var.type === 'CORTEX_STEP_TYPE_USER_INPUT' || step_var.type === 'CORTEX_STEP_TYPE_ERROR_MESSAGE') {
      continue;
    }

    const execution_id_var = extractStepExecutionId_func(step_var);
    if (execution_id_var) {
      return execution_id_var;
    }
  }

  return null;
}

export function findLatestReplayableStepErrorInSteps_func(
  steps_var: Array<Record<string, unknown>>,
  ignored_execution_ids_var: ReadonlySet<string> = new Set(),
): ReplayableStepErrorCandidate | null {
  for (let index_var = steps_var.length - 1; index_var >= 0; index_var -= 1) {
    const step_var = steps_var[index_var];
    if (shouldIgnoreStepByExecutionId_func(step_var, ignored_execution_ids_var)) {
      continue;
    }
    if (isPlannerSuccessTerminal_func(step_var)) {
      return null;
    }

    const error_details_var = extractStepErrorDetailsFromStep_func(step_var);
    if (!error_details_var) {
      continue;
    }
    if (isRetryableStepErrorForReplay_func(error_details_var)) {
      const ignored_execution_id_var = findLatestExecutionIdBeforeErrorStep_func(
        steps_var,
        index_var,
      );
      if (
        ignored_execution_id_var
        && ignored_execution_ids_var.has(ignored_execution_id_var)
      ) {
        continue;
      }

      return {
        errorDetails_var: error_details_var,
        stepIndex_var: index_var,
        ignoredExecutionId_var: ignored_execution_id_var,
      };
    }
  }

  return null;
}

export function recoverPlannerResponseTextFromSteps_func(
  steps_var: Array<Record<string, unknown>>,
  ignored_execution_ids_var: ReadonlySet<string> = new Set(),
): string | null {
  for (let index_var = steps_var.length - 1; index_var >= 0; index_var -= 1) {
    const step_var = steps_var[index_var];
    if (shouldIgnoreStepByExecutionId_func(step_var, ignored_execution_ids_var)) {
      continue;
    }

    const response_text_var = extractTerminalPlannerResponseTextFromStep_func(step_var);
    if (response_text_var) {
      return response_text_var;
    }
  }

  return null;
}

export function hasPlannerSuccessInSteps_func(
  steps_var: Array<Record<string, unknown>>,
  ignored_execution_ids_var: ReadonlySet<string> = new Set(),
): boolean {
  return steps_var.some((step_var) => (
    !shouldIgnoreStepByExecutionId_func(step_var, ignored_execution_ids_var)
    && isPlannerSuccessTerminal_func(step_var)
  ));
}

export function shouldEmitMissingResponseWarning_func(options_var: {
  finalResponseText_var: string | null;
  latestErrorMessages_var: string[];
  hasTerminalSuccess_var: boolean;
}): boolean {
  return options_var.finalResponseText_var == null
    && options_var.latestErrorMessages_var.length === 0
    && !options_var.hasTerminalSuccess_var;
}

function escapePromptForCdata_func(prompt_var: string): string {
  return prompt_var.replaceAll(']]>', ']]]]><![CDATA[>');
}

export function buildReplayPrompt_func(original_prompt_var: string): string {
  return [
    '<system-reminder>',
    'The previous attempt was interrupted by a transient backend or capacity error before completion. The repeated prompt below is the user\'s original request being resumed. Treat it as the same request, preserve the same scope and constraints, and continue directly without asking why it is repeated.',
    '<previous-user-prompt><![CDATA[',
    escapePromptForCdata_func(original_prompt_var),
    ']]></previous-user-prompt>',
    '</system-reminder>',
  ].join('\n');
}

export function extractUserFacingErrorMessagesFromStep_func(
  step_var: Record<string, unknown>,
): string[] {
  const error_details_var = extractStepErrorDetailsFromStep_func(step_var);
  if (!error_details_var) {
    return [];
  }

  const messages_var: string[] = [];
  for (const candidate_var of [
    error_details_var.shortError,
    error_details_var.userErrorMessage,
  ]) {
    if (candidate_var && !messages_var.includes(candidate_var)) {
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

type RecoveryLogSignal = {
  category: 'awaitNetworkRecovery' | 'surfaceToUser';
  reason: string;
};

type AutoReplayLoopResult = {
  completed_var: true;
};

type ReplayLoopOptions = {
  original_prompt_var: string;
  runAttempt_func: (
    prompt_text_var: string,
    is_replay_var: boolean,
    ignored_execution_ids_var: ReadonlySet<string>,
  ) => Promise<ObserveAndAppendResult>;
  detectRecoverySignal_func: () => RecoveryLogSignal | null;
  abortSignal_var?: AbortSignal;
  onReplayScheduled_func?: () => void;
};

function getLatestLogSessionDirPath_func(logs_root_path_var: string): string | null {
  if (!existsSync(logs_root_path_var)) {
    return null;
  }

  let latest_dir_path_var: string | null = null;
  let latest_mtime_ms_var = -1;
  for (const entry_var of readdirSync(logs_root_path_var, { withFileTypes: true })) {
    if (!entry_var.isDirectory()) {
      continue;
    }

    const candidate_path_var = path.join(logs_root_path_var, entry_var.name);
    const candidate_mtime_ms_var = statSync(candidate_path_var).mtimeMs;
    if (candidate_mtime_ms_var > latest_mtime_ms_var) {
      latest_mtime_ms_var = candidate_mtime_ms_var;
      latest_dir_path_var = candidate_path_var;
    }
  }

  return latest_dir_path_var;
}

export function pickRecoveryLogSessionDirPath_func(
  logs_root_path_var: string,
  pinned_session_dir_path_var: string | null,
): string | null {
  const latest_dir_path_var = getLatestLogSessionDirPath_func(logs_root_path_var);
  if (!pinned_session_dir_path_var || !existsSync(pinned_session_dir_path_var)) {
    return latest_dir_path_var;
  }

  if (!latest_dir_path_var || latest_dir_path_var === pinned_session_dir_path_var) {
    return pinned_session_dir_path_var;
  }

  const pinned_mtime_ms_var = statSync(pinned_session_dir_path_var).mtimeMs;
  const latest_mtime_ms_var = statSync(latest_dir_path_var).mtimeMs;
  return latest_mtime_ms_var > pinned_mtime_ms_var
    ? latest_dir_path_var
    : pinned_session_dir_path_var;
}

export function classifyRecoveryLogSignalFromText_func(
  log_text_var: string,
): RecoveryLogSignal | null {
  if (
    log_text_var.includes('Failed to get OAuth token')
    || log_text_var.includes('getaddrinfo ENOTFOUND')
    || log_text_var.includes('Error refreshing user status')
    || log_text_var.includes('TLS handshake timeout')
    || log_text_var.includes('i/o timeout')
    || log_text_var.includes('Client network socket disconnected before secure TLS connection was established')
    || log_text_var.includes('read ETIMEDOUT')
  ) {
    return {
      category: 'awaitNetworkRecovery',
      reason: 'auth_or_network_failure',
    };
  }

  if (log_text_var.includes('executor is not currently running')) {
    return {
      category: 'surfaceToUser',
      reason: 'executor_not_running',
    };
  }

  return null;
}

function getAntigravityLogsRootPath_func(home_dir_path_var: string): string {
  return path.join(
    home_dir_path_var,
    'Library',
    'Application Support',
    'Antigravity',
    'logs',
  );
}

function pinLatestRecoveryLogSessionDirPath_func(home_dir_path_var: string): string | null {
  return getLatestLogSessionDirPath_func(getAntigravityLogsRootPath_func(home_dir_path_var));
}

function readLogTailText_func(file_path_var: string, max_bytes_var = 64 * 1024): string {
  if (!existsSync(file_path_var)) {
    return '';
  }

  const stats_var = statSync(file_path_var);
  const bytes_to_read_var = Math.min(stats_var.size, max_bytes_var);
  if (bytes_to_read_var <= 0) {
    return '';
  }

  const fd_var = openSync(file_path_var, 'r');
  try {
    const buffer_var = Buffer.alloc(bytes_to_read_var);
    readSync(
      fd_var,
      buffer_var,
      0,
      bytes_to_read_var,
      stats_var.size - bytes_to_read_var,
    );
    return buffer_var.toString('utf8');
  } finally {
    closeSync(fd_var);
  }
}

function detectRecoverySignalFromFallbackSources_func(
  recovery_context_var: RecoveryContext,
): RecoveryLogSignal | null {
  if (recovery_context_var.mode_var === 'offline') {
    return classifyRecoveryLogSignalFromText_func(
      recovery_context_var.getOfflineStderrText_func?.() ?? '',
    );
  }

  if (!recovery_context_var.logsRootPath_var) {
    return null;
  }

  const session_dir_path_var = pickRecoveryLogSessionDirPath_func(
    recovery_context_var.logsRootPath_var,
    recovery_context_var.pinnedLogSessionDirPath_var,
  );
  if (!session_dir_path_var) {
    return null;
  }

  recovery_context_var.pinnedLogSessionDirPath_var = session_dir_path_var;

  for (const file_name_var of ['ls-main.log', 'auth.log']) {
    const log_text_var = readLogTailText_func(path.join(session_dir_path_var, file_name_var));
    const signal_var = classifyRecoveryLogSignalFromText_func(log_text_var);
    if (signal_var) {
      return signal_var;
    }
  }

  return null;
}

function formatTerminalRecoveryMessage_func(options_var: {
  category: 'awaitNetworkRecovery' | 'surfaceToUser';
  reason: string;
}): string {
  if (options_var.category === 'awaitNetworkRecovery') {
    return `NETWORK_RECOVERY_REQUIRED: ${options_var.reason}`;
  }

  return `SILENT_FAILURE: ${options_var.reason}`;
}

async function sendPromptAttemptAndObserve_func(options_var: {
  discovery_var: DiscoveryInfo;
  config_var: HeadlessBackendConfig;
  cli_var: CliOptions;
  cascade_id_var: string;
  transcript_path_var: string;
  prompt_text_var: string;
  cascade_config_var: CascadeConfigProtoOptions;
  ignoredExecutionIds_var: ReadonlySet<string>;
  onSendAccepted_func?: () => void;
  abortSignal_var?: AbortSignal;
}): Promise<ObserveAndAppendResult> {
  if (options_var.abortSignal_var?.aborted) {
    throw new ReplayCancelledError();
  }

  const send_result_var = await callConnectProtoRpc({
    discovery: options_var.discovery_var,
    protocol: 'https',
    certPath: options_var.config_var.certPath,
    method: 'SendUserCascadeMessage',
    requestBody: buildSendUserCascadeMessageRequestProto({
      cascadeId: options_var.cascade_id_var,
      text: options_var.prompt_text_var,
      cascadeConfig: options_var.cascade_config_var,
    }),
    timeoutMs: options_var.cli_var.timeoutMs,
    responseDecoder: decodeSendUserCascadeMessageResponseProto,
  });

  const send_decoded_var = send_result_var.responseBody as { queued: boolean };
  options_var.onSendAccepted_func?.();
  if (send_decoded_var.queued) {
    await waitForCondition_func({
      timeoutMs: options_var.cli_var.timeoutMs,
      pollIntervalMs: 1000,
      label: 'waiting-idle-before-flush-replayable-attempt',
      probe: async () => {
        const traj_var = await callConnectRpc({
          discovery: options_var.discovery_var,
          protocol: 'https',
          certPath: options_var.config_var.certPath,
          method: 'GetCascadeTrajectory',
          payload: {
            cascadeId: options_var.cascade_id_var,
            verbosity: CLIENT_TRAJECTORY_VERBOSITY_PROD_UI,
          },
          timeoutMs: options_var.cli_var.timeoutMs,
        });
        return (traj_var.responseBody as { status?: unknown }).status;
      },
      isReady: (status_var) => status_var === CASCADE_RUN_STATUS_IDLE || status_var === 'CASCADE_RUN_STATUS_IDLE',
      abortSignal_var: options_var.abortSignal_var,
    });

    await callConnectProtoRpc({
      discovery: options_var.discovery_var,
      protocol: 'https',
      certPath: options_var.config_var.certPath,
      method: 'SendAllQueuedMessages',
      requestBody: buildSendAllQueuedMessagesRequestProto({
        cascadeId: options_var.cascade_id_var,
        cascadeConfig: options_var.cascade_config_var,
      }),
      timeoutMs: options_var.cli_var.timeoutMs,
    });
  }

  return observeAndAppendSteps_func(
    options_var.discovery_var,
    options_var.config_var,
    options_var.cli_var,
    options_var.cascade_id_var,
    options_var.transcript_path_var,
    options_var.ignoredExecutionIds_var,
    options_var.abortSignal_var,
  );
}

export async function runAutoReplayLoop_func(options_var: ReplayLoopOptions): Promise<AutoReplayLoopResult> {
  let prompt_text_var = options_var.original_prompt_var;
  let is_replay_var = false;
  const ignored_execution_ids_var = new Set<string>();

  while (true) {
    if (options_var.abortSignal_var?.aborted) {
      throw new ReplayCancelledError();
    }

    const observe_result_var = await options_var.runAttempt_func(
      prompt_text_var,
      is_replay_var,
      ignored_execution_ids_var,
    );

    if (observe_result_var.latestReplayableStepErrorCandidate_var) {
      const ignored_execution_id_var = observe_result_var.latestReplayableStepErrorCandidate_var.ignoredExecutionId_var;
      if (ignored_execution_id_var) {
        ignored_execution_ids_var.add(ignored_execution_id_var);
      }
      if (options_var.abortSignal_var?.aborted) {
        throw new ReplayCancelledError();
      }
      prompt_text_var = buildReplayPrompt_func(options_var.original_prompt_var);
      is_replay_var = true;
      options_var.onReplayScheduled_func?.();
      await sleepWithAbort_func(1000, options_var.abortSignal_var);
      continue;
    }

    if (observe_result_var.finalResponseText_var) {
      return { completed_var: true };
    }

    if (observe_result_var.timedOut_var || observe_result_var.streamError_var) {
      const recovery_signal_var = options_var.detectRecoverySignal_func();
      if (recovery_signal_var) {
        throw new Error(formatTerminalRecoveryMessage_func(recovery_signal_var));
      }
    }

    throw new Error(formatTerminalRecoveryMessage_func({
      category: 'surfaceToUser',
      reason: 'no response text or retryable step recovered before timeout',
    }));
  }
}

async function executePromptAttemptLoop_func(options_var: {
  discovery_var: DiscoveryInfo;
  config_var: HeadlessBackendConfig;
  cli_var: CliOptions;
  cascade_id_var: string;
  transcript_path_var: string;
  original_prompt_var: string;
  cascade_config_var: CascadeConfigProtoOptions;
  recovery_context_var: RecoveryContext;
  onFirstSendAccepted_func?: () => void;
  abortSignal_var?: AbortSignal;
}): Promise<void> {
  let first_send_accepted_var = false;

  await runAutoReplayLoop_func({
    original_prompt_var: options_var.original_prompt_var,
    abortSignal_var: options_var.abortSignal_var,
    runAttempt_func: (prompt_text_var, is_replay_var, ignored_execution_ids_var) => sendPromptAttemptAndObserve_func({
      discovery_var: options_var.discovery_var,
      config_var: options_var.config_var,
      cli_var: options_var.cli_var,
      cascade_id_var: options_var.cascade_id_var,
      transcript_path_var: options_var.transcript_path_var,
      prompt_text_var,
      cascade_config_var: options_var.cascade_config_var,
      ignoredExecutionIds_var: ignored_execution_ids_var,
      abortSignal_var: options_var.abortSignal_var,
      onSendAccepted_func: !is_replay_var && !first_send_accepted_var
        ? () => {
            first_send_accepted_var = true;
            options_var.onFirstSendAccepted_func?.();
          }
        : undefined,
    }),
    detectRecoverySignal_func: () => detectRecoverySignalFromFallbackSources_func(
      options_var.recovery_context_var,
    ),
    onReplayScheduled_func: () => {
      if (!options_var.cli_var.json) {
        process.stderr.write('[info] retryable backend error detected; replaying previous prompt.\n');
      }
    },
  });
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
  deferredEntries_var: FetchedStepEntry[];
};

type ObserveAndAppendResult = {
  finalResponseText_var: string | null;
  latestErrorMessages_var: string[];
  latestReplayableStepErrorCandidate_var: ReplayableStepErrorCandidate | null;
  timedOut_var: boolean;
  streamError_var: Error | null;
};

type RecoveryContext = {
  mode_var: 'live' | 'offline';
  logsRootPath_var: string | null;
  pinnedLogSessionDirPath_var: string | null;
  getOfflineStderrText_func?: (() => string) | null;
};

export function createFetchedStepAppendState_func(
  last_appended_index_var = -1,
): FetchedStepAppendState {
  return {
    lastAppendedIndex_var: last_appended_index_var,
    lastFetchedStepCount_var: Math.max(last_appended_index_var + 1, 0),
    deferredEntries_var: [],
  };
}

function buildFetchedStepEntryFromSnapshot_func(
  steps_var: Array<Record<string, unknown>>,
  index_var: number,
  fallback_entry_var?: FetchedStepEntry,
): FetchedStepEntry | null {
  const step_var = steps_var[index_var];
  if (step_var && typeof step_var === 'object' && !Array.isArray(step_var)) {
    return {
      index: index_var,
      step: step_var as Record<string, unknown>,
    };
  }

  return fallback_entry_var ?? null;
}

export function collectFetchedStepEvents_func(
  steps_var: Array<Record<string, unknown>>,
  append_state_var: FetchedStepAppendState,
  ignored_execution_ids_var: ReadonlySet<string>,
): {
  transcriptEntries_var: FetchedStepEntry[];
  stdoutEntries_var: FetchedStepEntry[];
  nextState_var: FetchedStepAppendState;
  responseText_var: string | null;
  hasTerminalSuccess_var: boolean;
  latestErrorMessages_var: string[];
  latestReplayableStepErrorCandidate_var: ReplayableStepErrorCandidate | null;
} {
  const transcript_entries_var: FetchedStepEntry[] = [];
  const next_deferred_entries_var: FetchedStepEntry[] = [];
  let last_appended_index_var = append_state_var.lastAppendedIndex_var;

  const collectEntry_func = (entry_var: FetchedStepEntry): void => {
    if (shouldIgnoreStepByExecutionId_func(entry_var.step, ignored_execution_ids_var)) {
      return;
    }

    if (!isTranscriptFinalizableStep_func(entry_var.step)) {
      next_deferred_entries_var.push(entry_var);
      return;
    }

    if (
      entry_var.step.type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE'
      && !shouldAppendPlannerStepToTranscript_func(entry_var.step)
    ) {
      return;
    }

    transcript_entries_var.push(entry_var);
    last_appended_index_var = Math.max(last_appended_index_var, entry_var.index);
  };

  for (const deferred_entry_var of append_state_var.deferredEntries_var) {
    const current_entry_var = buildFetchedStepEntryFromSnapshot_func(
      steps_var,
      deferred_entry_var.index,
      deferred_entry_var,
    );
    if (!current_entry_var) {
      continue;
    }
    collectEntry_func(current_entry_var);
  }

  for (
    let index_var = Math.min(append_state_var.lastFetchedStepCount_var, steps_var.length);
    index_var < steps_var.length;
    index_var += 1
  ) {
    const entry_var = buildFetchedStepEntryFromSnapshot_func(steps_var, index_var);
    if (!entry_var) {
      continue;
    }
    collectEntry_func(entry_var);
  }

  return {
    transcriptEntries_var: transcript_entries_var,
    stdoutEntries_var: transcript_entries_var,
    nextState_var: {
      lastAppendedIndex_var: last_appended_index_var,
      lastFetchedStepCount_var: steps_var.length,
      deferredEntries_var: next_deferred_entries_var,
    },
    responseText_var: recoverPlannerResponseTextFromSteps_func(
      steps_var,
      ignored_execution_ids_var,
    ),
    hasTerminalSuccess_var: hasPlannerSuccessInSteps_func(
      steps_var,
      ignored_execution_ids_var,
    ),
    latestErrorMessages_var: recoverLatestUserFacingErrorMessagesFromSteps_func(steps_var),
    latestReplayableStepErrorCandidate_var: findLatestReplayableStepErrorInSteps_func(
      steps_var,
      ignored_execution_ids_var,
    ),
  };
}

function collectNowFinalizableDeferredEntries_func(
  append_state_var: FetchedStepAppendState,
  ignored_execution_ids_var: ReadonlySet<string>,
): {
  transcriptEntries_var: FetchedStepEntry[];
  stdoutEntries_var: FetchedStepEntry[];
  nextState_var: FetchedStepAppendState;
} {
  const transcript_entries_var: FetchedStepEntry[] = [];
  const remaining_deferred_entries_var: FetchedStepEntry[] = [];
  let last_appended_index_var = append_state_var.lastAppendedIndex_var;

  for (const entry_var of append_state_var.deferredEntries_var) {
    if (shouldIgnoreStepByExecutionId_func(entry_var.step, ignored_execution_ids_var)) {
      continue;
    }

    if (!isTranscriptFinalizableStep_func(entry_var.step)) {
      remaining_deferred_entries_var.push(entry_var);
      continue;
    }

    if (
      entry_var.step.type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE'
      && !shouldAppendPlannerStepToTranscript_func(entry_var.step)
    ) {
      continue;
    }

    transcript_entries_var.push(entry_var);
    last_appended_index_var = Math.max(last_appended_index_var, entry_var.index);
  }

  return {
    transcriptEntries_var: transcript_entries_var,
    stdoutEntries_var: transcript_entries_var,
    nextState_var: {
      lastAppendedIndex_var: last_appended_index_var,
      lastFetchedStepCount_var: append_state_var.lastFetchedStepCount_var,
      deferredEntries_var: remaining_deferred_entries_var,
    },
  };
}

function hasDeferredNonFinalizableEntries_func(
  append_state_var: FetchedStepAppendState,
): boolean {
  return append_state_var.deferredEntries_var.length > 0;
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

function hasDeferredTailEntries_func(
  append_state_var: FetchedStepAppendState,
): boolean {
  return hasDeferredNonFinalizableEntries_func(append_state_var);
}

async function fetchAndAppendSteps_func(
  discovery_var: DiscoveryInfo,
  config_var: HeadlessBackendConfig,
  cli_var: CliOptions,
  cascade_id_var: string,
  transcript_path_var: string,
  append_state_var: FetchedStepAppendState,
  ignored_execution_ids_var: ReadonlySet<string>,
): Promise<{
  nextState_var: FetchedStepAppendState;
  responseText_var: string | null;
  hasTerminalSuccess_var: boolean;
  latestErrorMessages_var: string[];
  latestReplayableStepErrorCandidate_var: ReplayableStepErrorCandidate | null;
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
    ignored_execution_ids_var,
  );

  appendFetchedStepEvents_func(
    transcript_path_var,
    step_event_plan_var.transcriptEntries_var,
    cli_var.json,
    !cli_var.json,
  );

  return {
    nextState_var: step_event_plan_var.nextState_var,
    responseText_var: step_event_plan_var.responseText_var,
    hasTerminalSuccess_var: step_event_plan_var.hasTerminalSuccess_var,
    latestErrorMessages_var: step_event_plan_var.latestErrorMessages_var,
    latestReplayableStepErrorCandidate_var: step_event_plan_var.latestReplayableStepErrorCandidate_var,
  };
}

async function stabilizePendingTailBeforeFlush_func(
  discovery_var: DiscoveryInfo,
  config_var: HeadlessBackendConfig,
  cli_var: CliOptions,
  cascade_id_var: string,
  transcript_path_var: string,
  append_state_var: FetchedStepAppendState,
  ignored_execution_ids_var: ReadonlySet<string>,
): Promise<{
  nextState_var: FetchedStepAppendState;
  responseText_var: string | null;
  hasTerminalSuccess_var: boolean;
  latestErrorMessages_var: string[];
  latestReplayableStepErrorCandidate_var: ReplayableStepErrorCandidate | null;
}> {
  // 종료 직전 deferred tail은 overwrite-only update를 더 받을 수 있다.
  // 같은 스냅샷이 연속 두 번 보일 때까지 짧게 재조회한다.
  const stabilization_timeout_ms_var = Math.min(5_000, cli_var.timeoutMs);
  const deadline_var = Date.now() + stabilization_timeout_ms_var;
  let latest_state_var = append_state_var;
  let latest_response_var: string | null = null;
  let latest_has_terminal_success_var = false;
  let latest_error_messages_var: string[] = [];
  let latest_replayable_error_candidate_var: ReplayableStepErrorCandidate | null = null;
  let previous_signature_var = serializeFetchedStepAppendStateSignature_func(append_state_var);
  let observed_non_deferred_tail_var = !hasDeferredTailEntries_func(append_state_var);

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
        ignored_execution_ids_var,
      );
      latest_state_var = fetch_result_var.nextState_var;
      latest_response_var = fetch_result_var.responseText_var ?? latest_response_var;
      latest_has_terminal_success_var = fetch_result_var.hasTerminalSuccess_var || latest_has_terminal_success_var;
      latest_error_messages_var = fetch_result_var.latestErrorMessages_var.length > 0
        ? fetch_result_var.latestErrorMessages_var
        : latest_error_messages_var;
      latest_replayable_error_candidate_var = fetch_result_var.latestReplayableStepErrorCandidate_var
        ?? latest_replayable_error_candidate_var;

      const current_signature_var = serializeFetchedStepAppendStateSignature_func(latest_state_var);
      const has_deferred_tail_var = hasDeferredTailEntries_func(latest_state_var);
      if (!has_deferred_tail_var && observed_non_deferred_tail_var && current_signature_var === previous_signature_var) {
        break;
      }
      observed_non_deferred_tail_var = !has_deferred_tail_var;
      previous_signature_var = current_signature_var;
    } catch {
      break;
    }
  }

  return {
    nextState_var: latest_state_var,
    responseText_var: latest_response_var,
    hasTerminalSuccess_var: latest_has_terminal_success_var,
    latestErrorMessages_var: latest_error_messages_var,
    latestReplayableStepErrorCandidate_var: latest_replayable_error_candidate_var,
  };
}


// ─────────────────────────────────────────────────────────────
// main() — 오케스트레이션 엔트리
// ─────────────────────────────────────────────────────────────

export async function main(argv_var: string[]): Promise<void> {
  const replay_abort_controller_var = new AbortController();
  const handle_sigint_var = () => {
    replay_abort_controller_var.abort();
  };
  process.once('SIGINT', handle_sigint_var);

  try {
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

  // ── Step 2: active account → config 로드 ──
  // auth list에서 선택한 계정의 state.vscdb를 사용한다.
  const active_account_name_var = await getActiveAccountName_func({ cliDir: getDefaultCliDir_func() });
  const active_user_data_dir_var = resolveUserDataDirForActiveAccount_func({
    cliDir: getDefaultCliDir_func(),
    activeAccountName: active_account_name_var,
  });
  const config_var = resolveHeadlessBackendConfig({
    userDataDirPath: active_user_data_dir_var,
  });
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
  await capturePreTurnSnapshotIfNeeded_func({
    cli: cli_var,
    cliDir: getDefaultCliDir_func(),
  });
  scheduleNeededWakeupsBackground_func({
    accounts: await listAccounts_func({ cliDir: getDefaultCliDir_func() }),
    workspaceRootPath: process.cwd(),
  });

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
      replay_abort_controller_var.signal,
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
    replay_abort_controller_var.signal,
  );
  } finally {
    process.removeListener('SIGINT', handle_sigint_var);
  }
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
  abort_signal_var: AbortSignal,
): Promise<void> {
  const discovery_var = live_connection_var.discovery;
  const recovery_context_var: RecoveryContext = {
    mode_var: 'live',
    logsRootPath_var: getAntigravityLogsRootPath_func(config_var.homeDirPath),
    pinnedLogSessionDirPath_var: pinLatestRecoveryLogSessionDirPath_func(config_var.homeDirPath),
  };

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
      cli_var, model_enum_var, effective_model_name_var, recovery_context_var, abort_signal_var,
    );
    return;
  }

  if (cli_var.prompt) {
    // ── new conversation via live path ──
    await handleLiveNewConversation_func(
      live_connection_var, config_var, workspace_root_path_var,
      cli_var, model_enum_var, effective_model_name_var, recovery_context_var, abort_signal_var,
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
  recovery_context_var: RecoveryContext,
  abort_signal_var: AbortSignal,
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
  const original_prompt_var = cli_var.prompt!;

  try {
    if (!cli_var.background) {
      reportUiSurfacedWarning_func(
        cascade_id_var,
        await trackConversationVisibility_func(
          discovery_var, config_var, cascade_id_var, cli_var.timeoutMs,
        ),
      );
    }

    await executePromptAttemptLoop_func({
      discovery_var, config_var, cli_var,
      cascade_id_var, transcript_path_var,
      original_prompt_var,
      cascade_config_var,
      recovery_context_var,
      abortSignal_var: abort_signal_var,
      onFirstSendAccepted_func: cli_var.json
        ? () => emitJsonInit_func(cascade_id_var, effective_model_name_var, workspace_root_path_var, false)
        : undefined,
    });
    await runPostPromptRotatePipeline_func({
      cli: cli_var,
      cliDir: getDefaultCliDir_func(),
      defaultDataDir: getDefaultDataDir_func(),
      stateDbPath: config_var.stateDbPath,
      requireOfflineQuotaVerification: false,
    });

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
  recovery_context_var: RecoveryContext,
  abort_signal_var: AbortSignal,
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
  const original_prompt_var = prompt_var ?? '';

  try {
    if (!cli_var.background) {
      reportUiSurfacedWarning_func(
        cascade_id_var,
        await trackConversationVisibility_func(
          discovery_var, config_var, cascade_id_var, cli_var.timeoutMs,
        ),
      );
    }

    await executePromptAttemptLoop_func({
      discovery_var, config_var, cli_var,
      cascade_id_var, transcript_path_var,
      original_prompt_var,
      cascade_config_var,
      recovery_context_var,
      abortSignal_var: abort_signal_var,
      onFirstSendAccepted_func: cli_var.json
        ? () => emitJsonInit_func(cascade_id_var, effective_model_name_var, workspace_root_path_var, true)
        : undefined,
    });
    await runPostPromptRotatePipeline_func({
      cli: cli_var,
      cliDir: getDefaultCliDir_func(),
      defaultDataDir: getDefaultDataDir_func(),
      stateDbPath: config_var.stateDbPath,
      requireOfflineQuotaVerification: false,
    });

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
  abort_signal_var: AbortSignal,
): Promise<void> {
  const offline_bootstrap_timeout_ms_var = resolveOfflineBootstrapTimeoutMs_func(cli_var.timeoutMs);

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
    buildOfflineLanguageServerArgs_func({
      extensionServerPort: fake_server_var.port,
      workspaceId: config_var.workspaceId,
      csrfToken: randomUUID(),
      extensionServerCsrfToken: randomUUID(),
    }),
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
    child_var.once('exit', (exit_code_var, signal_code_var) => {
      // LS가 discovery file을 만들기 전에 종료하면 즉시 실패.
      // (예: 잘못된 플래그로 exit code 2)
      reject_var(new Error(buildPrematureLanguageServerExitMessage_func({
        exitCode: exit_code_var,
        signalCode: signal_code_var,
        stderrText: Buffer.concat(stderr_chunks_var).toString('utf8').trim(),
      })));
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
          timeoutMs: offline_bootstrap_timeout_ms_var,
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
      offline_bootstrap_timeout_ms_var,
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

    const recovery_context_var: RecoveryContext = {
      mode_var: 'offline',
      logsRootPath_var: null,
      pinnedLogSessionDirPath_var: null,
      getOfflineStderrText_func: () => Buffer.concat(stderr_chunks_var).toString('utf8'),
    };

    // ── Step 12: 실행 분기 ──
    if (cli_var.resume && !cli_var.resumeCascadeId && !cli_var.prompt) {
      await handleResumeList_func(discovery_var, config_var, workspace_root_path_var, cli_var);
    } else if (cli_var.resume && cli_var.resumeCascadeId) {
      await handleResumeSend_func(
        discovery_var, config_var, workspace_root_path_var, cli_var,
        model_enum_var, effective_model_name_var, recovery_context_var, abort_signal_var,
      );
    } else if (cli_var.prompt) {
      await handleNewConversation_func(
        discovery_var, config_var, workspace_root_path_var, cli_var,
        model_enum_var, effective_model_name_var, recovery_context_var, abort_signal_var,
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
  recovery_context_var: RecoveryContext,
  abort_signal_var: AbortSignal,
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
  const original_prompt_var = cli_var.prompt!;

  try {
    let observe_error_var: unknown = null;
    try {
      await executePromptAttemptLoop_func({
        discovery_var, config_var, cli_var,
        cascade_id_var, transcript_path_var,
        original_prompt_var,
        cascade_config_var,
        recovery_context_var,
        abortSignal_var: abort_signal_var,
        onFirstSendAccepted_func: cli_var.json
          ? () => emitJsonInit_func(cascade_id_var, effective_model_name_var, workspace_root_path_var, false)
          : undefined,
      });
    } catch (error_var) {
      observe_error_var = error_var;
    }

    // --json done (lifecycle event) — surfaced 후처리 전에 emit
    // done은 observe 단계가 성공적으로 끝난 경우에만 emit한다.
    // observe 에러는 done 없이 re-throw되어 최종 catch의 error 이벤트로 내려간다.
    if (!observe_error_var) {
      await runPostPromptRotatePipeline_func({
        cli: cli_var,
        cliDir: getDefaultCliDir_func(),
        defaultDataDir: getDefaultDataDir_func(),
        stateDbPath: config_var.stateDbPath,
        requireOfflineQuotaVerification: true,
      });
    }

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
  const entries_var = buildResumeListEntries_func({
    rpcEntries_var: extractTrajectorySummaryEntries_func(result_var.responseBody),
    localRecords_var: readLocalConversations_func(workspace_root_path_var),
    workspaceUri_var: workspace_uri_var,
  });

  for (const line_var of buildResumeListOutputLines_func(entries_var, workspace_root_path_var)) {
    console.log(line_var);
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
  recovery_context_var: RecoveryContext,
  abort_signal_var: AbortSignal,
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
  const original_prompt_var = prompt_var ?? '';

  try {
    let observe_error_var: unknown = null;
    try {
      await executePromptAttemptLoop_func({
        discovery_var, config_var, cli_var,
        cascade_id_var, transcript_path_var,
        original_prompt_var,
        cascade_config_var,
        recovery_context_var,
        abortSignal_var: abort_signal_var,
        onFirstSendAccepted_func: cli_var.json
          ? () => emitJsonInit_func(cascade_id_var, effective_model_name_var, workspace_root_path_var, true)
          : undefined,
      });
    } catch (error_var) {
      observe_error_var = error_var;
    }

    // --json done (lifecycle event) — surfaced 후처리 전에 emit
    // observe 에러는 done 없이 최종 catch의 error 이벤트로 승격한다.
    if (!observe_error_var) {
      await runPostPromptRotatePipeline_func({
        cli: cli_var,
        cliDir: getDefaultCliDir_func(),
        defaultDataDir: getDefaultDataDir_func(),
        stateDbPath: config_var.stateDbPath,
        requireOfflineQuotaVerification: true,
      });
    }

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
  ignored_execution_ids_var: ReadonlySet<string>,
  abort_signal_var?: AbortSignal,
): Promise<ObserveAndAppendResult> {
  // [A] transcript에 이미 기록된 index를 기준으로 append 상태를 복원한다.
  // deferred tail은 디스크에 저장하지 않으므로, 현재 런타임 fetch 스냅샷에서만 관리한다.
  let append_state_var = createFetchedStepAppendStateFromTranscript_func(transcript_path_var);
  let final_response_var: string | null = null;
  let has_terminal_success_var = false;
  let latest_error_messages_var: string[] = [];
  let latest_replayable_error_candidate_var: ReplayableStepErrorCandidate | null = null;

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
  let cancelled_var = abort_signal_var?.aborted ?? false;

  const handle_abort_var = () => {
    cancelled_var = true;
    abort_controller_var.abort();
  };
  abort_signal_var?.addEventListener('abort', handle_abort_var, { once: true });

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
      if (cancelled_var) {
        throw new ReplayCancelledError();
      }
      const update_raw_var = (message_var as Record<string, unknown>)?.update;
      if (!update_raw_var) {
        continue;
      }

      // 상태 갱신 (step overwrite + status history)
      const update_summary_var = applyAgentStateUpdate_func(state_var, update_raw_var);

      // ── 핵심: stream update는 트리거, append 결정은 fetch 스냅샷으로만 한다 ──
      if (shouldFetchStepsForUpdate_func(update_summary_var, append_state_var.lastFetchedStepCount_var)) {
        try {
          const fetch_result_var = await fetchAndAppendSteps_func(
            discovery_var,
            config_var,
            cli_var,
            cascade_id_var,
            transcript_path_var,
            append_state_var,
            ignored_execution_ids_var,
          );
          append_state_var = fetch_result_var.nextState_var;
          final_response_var = fetch_result_var.responseText_var ?? final_response_var;
          has_terminal_success_var = fetch_result_var.hasTerminalSuccess_var || has_terminal_success_var;
          latest_error_messages_var = fetch_result_var.latestErrorMessages_var.length > 0
            ? fetch_result_var.latestErrorMessages_var
            : latest_error_messages_var;
          latest_replayable_error_candidate_var = fetch_result_var.latestReplayableStepErrorCandidate_var
            ?? latest_replayable_error_candidate_var;
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
        && (
          final_response_var != null
          || latest_replayable_error_candidate_var != null
        )
      ) {
        break;
      }
    }
  } catch (error_var) {
    // AbortError는 정상 종료
    const is_abort_var = error_var instanceof Error
      && (error_var.name === 'AbortError' || error_var.message.includes('aborted'));
    if (cancelled_var && is_abort_var) {
      stream_error_var = new ReplayCancelledError();
    } else if (!is_abort_var) {
      stream_error_var = error_var;
    }
  } finally {
    clearTimeout(timeout_var);
    abort_controller_var.abort();
    abort_signal_var?.removeEventListener('abort', handle_abort_var);
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
    if (cancelled_var) {
      throw new ReplayCancelledError();
    }
    const final_fetch_result_var = await fetchAndAppendSteps_func(
      discovery_var,
      config_var,
      cli_var,
      cascade_id_var,
      transcript_path_var,
      append_state_var,
      ignored_execution_ids_var,
    );
    append_state_var = final_fetch_result_var.nextState_var;
    final_response_var = final_fetch_result_var.responseText_var ?? final_response_var;
    has_terminal_success_var = final_fetch_result_var.hasTerminalSuccess_var || has_terminal_success_var;
    latest_error_messages_var = final_fetch_result_var.latestErrorMessages_var.length > 0
      ? final_fetch_result_var.latestErrorMessages_var
      : latest_error_messages_var;
    latest_replayable_error_candidate_var = final_fetch_result_var.latestReplayableStepErrorCandidate_var
      ?? latest_replayable_error_candidate_var;

    const stabilized_result_var = await stabilizePendingTailBeforeFlush_func(
      discovery_var,
      config_var,
      cli_var,
      cascade_id_var,
      transcript_path_var,
      append_state_var,
      ignored_execution_ids_var,
    );
    append_state_var = stabilized_result_var.nextState_var;
    final_response_var = stabilized_result_var.responseText_var ?? final_response_var;
    has_terminal_success_var = stabilized_result_var.hasTerminalSuccess_var || has_terminal_success_var;
    latest_error_messages_var = stabilized_result_var.latestErrorMessages_var.length > 0
      ? stabilized_result_var.latestErrorMessages_var
      : latest_error_messages_var;
    latest_replayable_error_candidate_var = stabilized_result_var.latestReplayableStepErrorCandidate_var
      ?? latest_replayable_error_candidate_var;

    const final_deferred_plan_var = collectNowFinalizableDeferredEntries_func(
      append_state_var,
      ignored_execution_ids_var,
    );
    appendFetchedStepEvents_func(
      transcript_path_var,
      final_deferred_plan_var.transcriptEntries_var,
      cli_var.json,
      !cli_var.json,
    );
    append_state_var = final_deferred_plan_var.nextState_var;
  } catch {
    // best-effort
  }

  // stream state 쪽 response ?? modifiedResponse도 마지막에 한 번 더 본다.
  final_response_var = final_response_var ?? recoverObservedResponseText_func(
    state_var,
    ignored_execution_ids_var,
  );
  has_terminal_success_var = has_terminal_success_var || hasObservedTerminalSuccess_func(
    state_var,
    ignored_execution_ids_var,
  );

  if (cancelled_var) {
    throw new ReplayCancelledError();
  }

  // ── 최종 응답 출력 ──
  if (final_response_var) {
    if (!cli_var.json) {
      console.log(final_response_var);
    }
  } else if (shouldEmitMissingResponseWarning_func({
    finalResponseText_var: final_response_var,
    latestErrorMessages_var: latest_error_messages_var,
    hasTerminalSuccess_var: has_terminal_success_var,
  })) {
    console.error('[warn] No response text recovered from trajectory.');
  }

  return {
    finalResponseText_var: final_response_var,
    latestErrorMessages_var: latest_error_messages_var,
    latestReplayableStepErrorCandidate_var: latest_replayable_error_candidate_var,
    timedOut_var: timed_out_var && !final_response_var,
    streamError_var: stream_error_var instanceof Error ? stream_error_var : null,
  };
}
