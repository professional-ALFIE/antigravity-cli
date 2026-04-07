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
} from './services/observeStream.js';
import { StateDbReader } from './services/stateVscdb.js';

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
    '  -r, --resume          List sessions',
    '      --resume [uuid]   Resume a session',
    '  -b, --background      Skip UI surfaced registration',
    '  -j, --json            Output in JSON format',
    '      --timeout-ms <number>',
    '                        Override timeout in milliseconds',
    '  -h, --help            display help for command',
    '',
    'Examples:',
    `  $ antigravity-cli 'hello'                               Single-quoted message`,
    `  $ antigravity-cli "hello"                               Double-quoted message`,
    `  $ antigravity-cli 'say "hello" literally'               Single quotes preserve inner double quotes`,
    `  $ antigravity-cli 'review this code'                    Create new conversation`,
    '  $ antigravity-cli -r                                    List workspace sessions',
    `  $ antigravity-cli -r SESSION_UUID 'continue'            Send message to existing session`,
    `  $ antigravity-cli -b 'background task'                  Skip UI surfaced registration`,
    `  $ antigravity-cli -j 'summarize this'                   Print transcript events as JSONL`,
    '',
    'Root Mode:',
    '  - New and resumed conversations talk to the Antigravity language server directly',
    '  - If --background is omitted, local tracking and UI surfaced post-processing are attempted',
    '  - --resume list only shows sessions for the current workspace, with full UUIDs',
    '  - Messages must be passed as a single positional argument — use quotes for spaces',
    '  - Prefer single quotes for literal text; use double quotes inside them for emphasis',
  ].join('\n');
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
    // positional argument = prompt
    if (!arg_var.startsWith('-') && options_var.prompt === null) {
      options_var.prompt = arg_var;
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
  const line_var = JSON.stringify(payload_var, (_key_var, value_var) =>
    typeof value_var === 'bigint' ? value_var.toString() : value_var,
  );
  appendFileSync(transcript_path_var, `${line_var}\n`, 'utf8');
  if (emit_to_stdout_var) {
    process.stdout.write(`${line_var}\n`);
  }
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
): Promise<void> {
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
  } catch {
    // surfaced 후처리 실패는 경고성 이슈다.
    // transcript append / 최종 응답 출력은 계속 진행한다.
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
async function hydrateTrajectorySummaryToStateDb_func(
  discovery_var: DiscoveryInfo,
  config_var: HeadlessBackendConfig,
  cascade_id_var: string,
  timeout_ms_var: number,
): Promise<boolean> {
  try {
    const summary_entry_var = await waitForCondition_func({
      timeoutMs: Math.min(timeout_ms_var, 15_000),
      pollIntervalMs: 1000,
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
      await state_db_reader_var.upsertTopicRowValue(
        'trajectorySummaries',
        cascade_id_var,
        summary_bytes_var.toString('base64'),
      );
    } finally {
      await state_db_reader_var.close();
    }

    return true;
  } catch {
    return false;
  }
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

async function fetchAndAppendSteps_func(
  discovery_var: DiscoveryInfo,
  config_var: HeadlessBackendConfig,
  cli_var: CliOptions,
  cascade_id_var: string,
  transcript_path_var: string,
  known_step_count_var: number,
): Promise<{
  knownStepCount_var: number;
  responseText_var: string | null;
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

  for (let index_var = known_step_count_var; index_var < steps_var.length; index_var += 1) {
    appendTranscriptLine_func(
      transcript_path_var,
      { index: index_var, step: steps_var[index_var] },
      cli_var.json,
    );
  }

  return {
    knownStepCount_var: steps_var.length,
    responseText_var: recoverPlannerResponseTextFromSteps_func(steps_var),
  };
}


// ─────────────────────────────────────────────────────────────
// main() — 오케스트레이션 엔트리
// ─────────────────────────────────────────────────────────────

export async function main(argv_var: string[]): Promise<void> {
  // ── Step 1: argv 파싱 ──
  const cli_var = parseArgv_func(argv_var);

  // ── Step 2: config + preferred model 로드 ──
  const config_var = resolveHeadlessBackendConfig();
  const preferred_model_name_var = await resolvePreferredModelNameFromStateDb_func(config_var.stateDbPath);

  if (cli_var.help) {
    console.log(buildRootHelp_func(preferred_model_name_var));
    return;
  }

  const positional_args_var = collectPositionalArgs_func(argv_var);
  if (positional_args_var.length > 1) {
    console.error('Message must be a single positional argument. Use quotes for spaces.');
    console.error('Prefer single quotes for literal text: antigravity-cli \'say "hello" literally\'');
    process.exitCode = 1;
    return;
  }

  // ── Step 3: cwd → workspace 고정 ──
  // 전제 조건: process.cwd()가 절대 경로여야 함.
  // 이 값은 workspaceRootPath, workspaceUris[0], transcript 저장에 모두 사용됨 (handoff §5).
  const workspace_root_path_var = process.cwd();
  const workspace_root_uri_var = `file://${workspace_root_path_var}`;
  // workspace_root_uri_var는 StartCascade, resume list 필터 등에서 사용됨.

  // ── Step 4: model alias 해석 ──
  const effective_model_name_var = cli_var.model ?? preferred_model_name_var;
  const model_enum_var = resolveModelAlias_func(effective_model_name_var);

  // ── resume list 분기 (빠른 경로) ──
  // resume list는 LS를 띄워서 GetAllCascadeTrajectories를 호출해야 하므로
  // 아래 LS spawn 이후 분기점에서 처리한다.
  // (prompt 없이 -r만 온 경우)

  // ── validate: 미구현 표면 차단 (spec 성공 조건 9) ──
  const unsupported_error_var = checkUnsupportedSurface_func(argv_var);
  if (unsupported_error_var) {
    console.error(`[error] ${unsupported_error_var}`);
    console.error('Supported: antigravity-cli "message" | --model/-m | --json/-j | -r/--resume | --background/-b | --help/-h');
    process.exitCode = 1;
    return;
  }

  // ── validate: prompt가 없고 resume도 아니면 에러 ──
  if (!cli_var.prompt && !cli_var.resume) {
    console.error('Usage: antigravity-cli "message"');
    console.error('       antigravity-cli --model flash "message"');
    console.error('       antigravity-cli -r');
    console.error('       antigravity-cli -r <cascadeId> "message"');
    process.exitCode = 1;
    return;
  }

  // ── [D] validate: resume send에 prompt 없으면 LS 띄우기 전에 차단 ──
  // 이전에는 handleResumeSend_func 안에서 검증했으나,
  // 그러면 LS spawn + USS + chat stream이 이미 완료된 후에야 에러가 발생했다.
  if (cli_var.resume && cli_var.resumeCascadeId && !cli_var.prompt) {
    console.error('Resume send requires a prompt.');
    console.error('Usage: antigravity-cli -r <cascadeId> "your message"');
    console.error('To list conversations: antigravity-cli -r');
    process.exitCode = 1;
    return;
  }

  // ── Step 5: metadata 생성 ──
  // 순서 의존: metadata.binary가 LS stdin으로 들어감.
  // apiKey = state.vscdb의 uss-oauth에서 자동 추출 (IDE와 동일한 소스).
  const state_db_reader_var = new StateDbReader(config_var.stateDbPath);
  const oauth_token_var = await state_db_reader_var.extractOAuthAccessToken();
  await state_db_reader_var.close();
  if (!oauth_token_var) {
    console.error('OAuth access token not found in state.vscdb.');
    console.error('Antigravity IDE에서 한 번 이상 로그인해야 합니다.');
    process.exitCode = 1;
    return;
  }
  const metadata_var = buildMetadataArtifact(createMetadataFields(config_var, { apiKey: oauth_token_var }));

  // ── Step 6: fake extension server 시작 ──
  // 전제 조건: LS가 여기에 역방향 RPC를 보냄 (USS 구독, Heartbeat 등).
  // LS CLI 인자로 이 서버의 포트를 전달해야 콜백이 동작함.
  const fake_server_var = new FakeExtensionServer({
    stateDbPath: config_var.stateDbPath,
  });
  await fake_server_var.start();

  // ── Step 7: LS spawn ──
  // headless_runtime.ts L145~173 이관 (검증된 CLI 인자, 한 바이트도 바꾸지 않음).
  // cwd는 workspaceRootPath (handoff §5).
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

  // metadata를 stdin으로 write한 뒤 즉시 close.
  // 순서 의존: LS는 stdin에서 protobuf metadata를 읽은 뒤 boot를 시작함.
  child_var.stdin.write(metadata_var.binary);
  child_var.stdin.end();

  try {
    // ── Step 8: discovery file 대기 ──
    // 전제 조건: LS가 daemonDirPath 아래에 discovery JSON을 생성해야 conn 가능.
    let discovery_result_var: { discoveryPath: string; discovery: DiscoveryInfo };
    try {
      discovery_result_var = await waitForDiscoveryFile({
        daemonDirPath: config_var.daemonDirPath,
        pid: child_var.pid,
        startTimeMs: start_time_ms_var,
        timeoutMs: cli_var.timeoutMs,
      });
    } catch (error_var) {
      // discovery timeout은 가장 답답한 실패다.
      // 원래는 "Discovery file was not created"만 남아서,
      // 실제 LS 크래시 원인($HOME 누락, CLI 인자 문제, auth 문제 등)이 묻혔다.
      // 여기서는 지금까지 버퍼링한 stderr와 child 종료 상태를 같이 덧붙인다.
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
    // 순서 의존: auth handoff의 핵심. uss-oauth와 uss-enterprisePreferences가
    // fake server를 통해 LS에 전달되어야 401 CREDENTIALS_MISSING이 안 남.
    await waitForTopics_func(
      fake_server_var,
      ['uss-oauth', 'uss-enterprisePreferences'],
      cli_var.timeoutMs,
    );

    // ── Step 10~11 준비: chat client stream 열기 ──
    // 대안 불가: StartChatClientRequestStream을 먼저 열지 않으면
    // SendUserCascadeMessage 후 LS가 RUNNING 상태에서 고착됨 (주인님 handoff §재도전_성공).
    // 이 스트림은 LS가 UI에 request를 push하는 채널이며,
    // headless에서도 열어야 LS가 서버 측 상태를 진행시킴.
    let chat_stream_var: ConnectProtoStreamHandle | null = null;
    try {
      chat_stream_var = startConnectProtoStream({
        discovery: discovery_var,
        protocol: 'https',
        certPath: config_var.certPath,
        method: 'StartChatClientRequestStream',
        requestBody: buildStartChatClientRequestStreamRequestProto(),
        timeoutMs: cli_var.timeoutMs,
        onFrame: () => {}, // 프레임은 관찰만, 로깅은 불필요
      });
      // responseStarted: HTTP 응답 시작 확인
      await chat_stream_var.responseStarted;
      // firstFrame: 스트림이 실제로 활성화됨 (sc06_multiturn.ts L382~386과 동일)
      // [I] 이걸 안 기다리면 SendUserCascadeMessage가 먼저 나가서 RUNNING 고착 가능.
      await Promise.race([
        chat_stream_var.firstFrame,
        new Promise<never>((_, reject_var) =>
          setTimeout(() => reject_var(new Error('chat stream first frame timed out')), 5000),
        ),
      ]);
    } catch {
      // [I+G] 1회 재시도: ECONNRESET 등 일시적 실패 대응
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
      // ── 12b: resume list ──
      await handleResumeList_func(discovery_var, config_var, workspace_root_path_var, cli_var);
    } else if (cli_var.resume && cli_var.resumeCascadeId) {
      // ── 12c: resume send ──
      await handleResumeSend_func(
        discovery_var, config_var, workspace_root_path_var, cli_var,
        model_enum_var, effective_model_name_var,
      );
    } else if (cli_var.prompt) {
      // ── 12a: 새 대화 ──
      await handleNewConversation_func(
        discovery_var, config_var, workspace_root_path_var, cli_var,
        model_enum_var, effective_model_name_var,
      );
    }

    // ── Step 13: conversation tracking (로컬 fallback) ──
    // [B] handleNewConversation_func에서 실제 cascadeId를 넘겨서 기록한다.
    // handleResumeSend_func에서는 cli_var.resumeCascadeId를 넘긴다.
    // 여기서는 더 이상 호출하지 않는다 — 각 핸들러가 직접 호출한다.

    // ── chat stream cleanup ──
    try { chat_stream_var?.close(); } catch { /* best-effort */ }

  } finally {
    // ── Step 14: cleanup ──
    // 순서 의존: fake server를 먼저 정리하고, LS를 종료한다.
    await fake_server_var.stop();
    await terminateChild_func(child_var);
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

  // 공식 CLI의 ls/track/:id에 대응하는 surfaced 후처리.
  // 주인님 spec 기준으로 --background가 아니면 UI surfaced 시도를 한다.
  if (!cli_var.background) {
    await trackConversationVisibility_func(
      discovery_var,
      config_var,
      cascade_id_var,
      cli_var.timeoutMs,
    );
  }

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

  await hydrateTrajectorySummaryToStateDb_func(
    discovery_var,
    config_var,
    cascade_id_var,
    cli_var.timeoutMs,
  );

  if (observe_error_var) {
    throw observe_error_var;
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

  // resume send도 공식 CLI와 동일하게 surfaced 후처리를 건다.
  if (!cli_var.background) {
    await trackConversationVisibility_func(
      discovery_var,
      config_var,
      cascade_id_var,
      cli_var.timeoutMs,
    );
  }

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

  await hydrateTrajectorySummaryToStateDb_func(
    discovery_var,
    config_var,
    cascade_id_var,
    cli_var.timeoutMs,
  );

  if (observe_error_var) {
    throw observe_error_var;
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
  // [A] resume일 때 기존 transcript 줄 수를 세서 거기서부터 append.
  // 새 대화라면 파일이 없으므로 0에서 시작.
  let known_step_count_var = 0;
  if (existsSync(transcript_path_var)) {
    const existing_content_var = readFileSync(transcript_path_var, 'utf8');
    known_step_count_var = existing_content_var.split('\n').filter((l) => l.trim()).length;
  }
  let final_response_var: string | null = null;

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

      // ── 핵심: mainStepsTotalLength가 늘었으면 재조회 → 새 step만 append ──
      const total_length_var = update_summary_var.mainStepsTotalLength;
      if (total_length_var != null && total_length_var > known_step_count_var) {
        try {
          const fetch_result_var = await fetchAndAppendSteps_func(
            discovery_var,
            config_var,
            cli_var,
            cascade_id_var,
            transcript_path_var,
            known_step_count_var,
          );
          known_step_count_var = fetch_result_var.knownStepCount_var;
          final_response_var = fetch_result_var.responseText_var ?? final_response_var;
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
        && known_step_count_var > 0
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
      known_step_count_var,
    );
    known_step_count_var = final_fetch_result_var.knownStepCount_var;
    final_response_var = final_fetch_result_var.responseText_var ?? final_response_var;
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
  } else {
    console.error('[warn] No response text recovered from trajectory.');
  }
}

// ─────────────────────────────────────────────────────────────
// 엔트리 (direct 실행 지원)
// ─────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error_var) => {
    console.error(error_var instanceof Error ? error_var.stack ?? error_var.message : String(error_var));
    process.exitCode = 1;
  });
}
