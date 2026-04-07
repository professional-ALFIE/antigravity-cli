import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { HeadlessBackendConfig } from '../utils/config.js';
import type { DiscoveryInfo } from './connectRpc.js';
import {
  createLanguageServerClient_func,
  loadAntigravityBundle_func,
  type LoadedAntigravityBundle,
} from './bundleRuntime.js';

export interface ObservedStepSummary {
  index: number;
  caseName: string | null;
  responseText: string | null;
  toolCallCount: number;
  hasThinking: boolean;
  valueKeys: string[];
}

export interface ObservedUpdateSummary {
  observedAt: string;
  conversationId: string | null;
  trajectoryId: string | null;
  status: unknown;
  executableStatus: unknown;
  executorLoopStatus: unknown;
  mainStepsTotalLength: number | null;
  queuedTotalLength: number | null;
  generatorTotalLength: number | null;
  stepIndices: number[];
  stepCases: Array<string | null>;
  repeatedIndices: number[];
  rawUpdate: unknown;
}

export interface ObservedConversationState {
  conversationId: string | null;
  trajectoryId: string | null;
  latestStatus: unknown;
  latestExecutableStatus: unknown;
  latestExecutorLoopStatus: unknown;
  latestMainStepsTotalLength: number | null;
  latestQueuedTotalLength: number | null;
  latestGeneratorTotalLength: number | null;
  statusHistory: unknown[];
  repeatedStepIndices: number[];
  updates: ObservedUpdateSummary[];
  stepMap: Map<number, ObservedStepSummary>;
}

export interface StepPageBounds {
  startIndex: number;
  endIndexExclusive?: number;
}

export interface CollectAgentStateStreamOptions {
  config_var: Pick<HeadlessBackendConfig, 'distPath' | 'certPath'>;
  discovery_var: DiscoveryInfo;
  conversationId: string;
  subscriberId?: string;
  protocol_var?: 'http' | 'https';
  initialStepsPageBounds?: StepPageBounds;
  timeoutMs: number;
  artifactFilePath?: string;
  isDone_func?: (
    state_var: ObservedConversationState,
    update_var: ObservedUpdateSummary,
  ) => boolean;
}

export interface CollectAgentStateStreamResult {
  state_var: ObservedConversationState;
  updateCount_var: number;
  lastUpdate_var: ObservedUpdateSummary | null;
}

function isRecord_func(value_var: unknown): value_var is Record<string, unknown> {
  return Boolean(value_var) && typeof value_var === 'object' && !Array.isArray(value_var);
}

function normalizeNumber_func(value_var: unknown): number | null {
  return typeof value_var === 'number' && Number.isFinite(value_var)
    ? value_var
    : null;
}

function normalizeNumberList_func(value_var: unknown): number[] {
  return Array.isArray(value_var)
    ? value_var
      .map((item_var) => normalizeNumber_func(item_var))
      .filter((item_var): item_var is number => item_var != null)
    : [];
}

function appendJsonLine_func(file_path_var: string, payload_var: unknown): void {
  appendFileSync(
    file_path_var,
    `${JSON.stringify(payload_var, (_key_var, value_var) => (
      typeof value_var === 'bigint' ? value_var.toString() : value_var
    ))}\n`,
    'utf8',
  );
}

function ensureParentDirectory_func(file_path_var: string): void {
  const parent_dir_path_var = path.dirname(file_path_var);
  if (!parent_dir_path_var) {
    return;
  }
  mkdirSync(parent_dir_path_var, { recursive: true });
}

function extractStepEnvelope_func(step_like_var: unknown): {
  caseName_var: string | null;
  value_var: Record<string, unknown> | null;
} {
  if (!isRecord_func(step_like_var)) {
    return {
      caseName_var: null,
      value_var: null,
    };
  }

  if (typeof step_like_var.case === 'string') {
    return {
      caseName_var: step_like_var.case,
      value_var: isRecord_func(step_like_var.value) ? step_like_var.value : null,
    };
  }

  const nested_step_var = isRecord_func(step_like_var.step) ? step_like_var.step : null;
  if (nested_step_var && typeof nested_step_var.case === 'string') {
    return {
      caseName_var: nested_step_var.case,
      value_var: isRecord_func(nested_step_var.value) ? nested_step_var.value : null,
    };
  }

  const fallback_case_name_var = Object.keys(step_like_var).find((key_var) => (
    isRecord_func(step_like_var[key_var])
    && key_var !== 'metadata'
    && key_var !== 'stepMetadata'
    && key_var !== 'annotations'
  )) ?? null;

  return {
    caseName_var: fallback_case_name_var,
    value_var: fallback_case_name_var && isRecord_func(step_like_var[fallback_case_name_var])
      ? step_like_var[fallback_case_name_var] as Record<string, unknown>
      : null,
  };
}

function pickPlannerResponseText_func(value_var: Record<string, unknown> | null): string | null {
  if (!value_var) {
    return null;
  }

  const response_var = typeof value_var.response === 'string' ? value_var.response : null;
  const modified_response_var = typeof value_var.modifiedResponse === 'string'
    ? value_var.modifiedResponse
    : null;

  if (response_var && response_var.length > 0) {
    return response_var;
  }
  if (modified_response_var && modified_response_var.length > 0) {
    return modified_response_var;
  }
  return null;
}

function extractStepCases_func(update_var: Record<string, unknown>): {
  indices_var: number[];
  steps_var: unknown[];
  total_length_var: number | null;
  generator_total_length_var: number | null;
  queued_total_length_var: number | null;
} {
  const main_trajectory_update_var = isRecord_func(update_var.mainTrajectoryUpdate)
    ? update_var.mainTrajectoryUpdate
    : null;
  const steps_update_var = main_trajectory_update_var && isRecord_func(main_trajectory_update_var.stepsUpdate)
    ? main_trajectory_update_var.stepsUpdate
    : null;
  const generator_update_var = main_trajectory_update_var && isRecord_func(main_trajectory_update_var.generatorMetadatasUpdate)
    ? main_trajectory_update_var.generatorMetadatasUpdate
    : null;
  const queued_steps_update_var = isRecord_func(update_var.queuedStepsUpdate)
    ? update_var.queuedStepsUpdate
    : null;

  return {
    indices_var: normalizeNumberList_func(steps_update_var?.indices),
    steps_var: Array.isArray(steps_update_var?.steps) ? steps_update_var.steps : [],
    total_length_var: normalizeNumber_func(steps_update_var?.totalLength),
    generator_total_length_var: normalizeNumber_func(generator_update_var?.totalLength),
    queued_total_length_var: normalizeNumber_func(queued_steps_update_var?.totalLength),
  };
}

export function summarizeObservedStep_func(step_like_var: unknown, index_var: number): ObservedStepSummary {
  const { caseName_var, value_var } = extractStepEnvelope_func(step_like_var);

  return {
    index: index_var,
    caseName: caseName_var,
    responseText: caseName_var === 'plannerResponse'
      ? pickPlannerResponseText_func(value_var)
      : null,
    toolCallCount: caseName_var === 'plannerResponse' && Array.isArray(value_var?.toolCalls)
      ? value_var.toolCalls.length
      : 0,
    hasThinking: caseName_var === 'plannerResponse'
      ? Boolean(value_var?.thinking)
      : false,
    valueKeys: value_var ? Object.keys(value_var).sort() : [],
  };
}

export function createObservedConversationState_func(): ObservedConversationState {
  return {
    conversationId: null,
    trajectoryId: null,
    latestStatus: null,
    latestExecutableStatus: null,
    latestExecutorLoopStatus: null,
    latestMainStepsTotalLength: null,
    latestQueuedTotalLength: null,
    latestGeneratorTotalLength: null,
    statusHistory: [],
    repeatedStepIndices: [],
    updates: [],
    stepMap: new Map<number, ObservedStepSummary>(),
  };
}

export function applyAgentStateUpdate_func(
  state_var: ObservedConversationState,
  update_var: unknown,
  options_var: {
    observedAt_var?: string;
    artifactFilePath_var?: string;
  } = {},
): ObservedUpdateSummary {
  const update_record_var = isRecord_func(update_var) ? update_var : {};
  const observed_at_var = options_var.observedAt_var ?? new Date().toISOString();
  const {
    indices_var,
    steps_var,
    total_length_var,
    generator_total_length_var,
    queued_total_length_var,
  } = extractStepCases_func(update_record_var);

  const repeated_indices_var: number[] = [];
  const step_cases_var: Array<string | null> = [];

  for (let index_position_var = 0; index_position_var < indices_var.length; index_position_var += 1) {
    const step_index_var = indices_var[index_position_var];
    const step_summary_var = summarizeObservedStep_func(steps_var[index_position_var], step_index_var);
    if (state_var.stepMap.has(step_index_var)) {
      repeated_indices_var.push(step_index_var);
      if (!state_var.repeatedStepIndices.includes(step_index_var)) {
        state_var.repeatedStepIndices.push(step_index_var);
      }
    }
    state_var.stepMap.set(step_index_var, step_summary_var);
    step_cases_var.push(step_summary_var.caseName);
  }

  const status_var = update_record_var.status ?? null;
  const last_status_var = state_var.statusHistory[state_var.statusHistory.length - 1];
  if (status_var != null && status_var !== last_status_var) {
    state_var.statusHistory.push(status_var);
  }

  state_var.conversationId = typeof update_record_var.conversationId === 'string'
    ? update_record_var.conversationId
    : state_var.conversationId;
  state_var.trajectoryId = typeof update_record_var.trajectoryId === 'string'
    ? update_record_var.trajectoryId
    : state_var.trajectoryId;
  state_var.latestStatus = status_var;
  state_var.latestExecutableStatus = update_record_var.executableStatus ?? null;
  state_var.latestExecutorLoopStatus = update_record_var.executorLoopStatus ?? null;
  state_var.latestMainStepsTotalLength = total_length_var ?? state_var.latestMainStepsTotalLength;
  state_var.latestQueuedTotalLength = queued_total_length_var ?? state_var.latestQueuedTotalLength;
  state_var.latestGeneratorTotalLength = generator_total_length_var ?? state_var.latestGeneratorTotalLength;

  const update_summary_var: ObservedUpdateSummary = {
    observedAt: observed_at_var,
    conversationId: state_var.conversationId,
    trajectoryId: state_var.trajectoryId,
    status: state_var.latestStatus,
    executableStatus: state_var.latestExecutableStatus,
    executorLoopStatus: state_var.latestExecutorLoopStatus,
    mainStepsTotalLength: total_length_var,
    queuedTotalLength: queued_total_length_var,
    generatorTotalLength: generator_total_length_var,
    stepIndices: indices_var,
    stepCases: step_cases_var,
    repeatedIndices: repeated_indices_var,
    rawUpdate: update_record_var,
  };

  state_var.updates.push(update_summary_var);

  if (options_var.artifactFilePath_var) {
    ensureParentDirectory_func(options_var.artifactFilePath_var);
    appendJsonLine_func(options_var.artifactFilePath_var, update_summary_var);
  }

  return update_summary_var;
}

export function recoverObservedResponseText_func(state_var: ObservedConversationState): string | null {
  const sorted_steps_var = Array.from(state_var.stepMap.values())
    .sort((left_var, right_var) => right_var.index - left_var.index);

  for (const step_var of sorted_steps_var) {
    if (step_var.caseName === 'plannerResponse' && step_var.responseText) {
      return step_var.responseText;
    }
  }
  return null;
}

export function hasIdleRunningIdleTransition_func(state_var: ObservedConversationState): boolean {
  let saw_initial_idle_var = false;
  let saw_running_var = false;

  for (const status_var of state_var.statusHistory) {
    const is_idle_var = status_var === 1 || status_var === 'CASCADE_RUN_STATUS_IDLE';
    const is_running_var = status_var === 2 || status_var === 'CASCADE_RUN_STATUS_RUNNING';

    if (is_idle_var && saw_running_var) {
      return true;
    }
    if (is_idle_var) {
      saw_initial_idle_var = true;
      continue;
    }
    if (is_running_var && saw_initial_idle_var) {
      saw_running_var = true;
    }
  }

  return false;
}

export function serializeObservedConversationState_func(state_var: ObservedConversationState): Record<string, unknown> {
  return {
    conversationId: state_var.conversationId,
    trajectoryId: state_var.trajectoryId,
    latestStatus: state_var.latestStatus,
    latestExecutableStatus: state_var.latestExecutableStatus,
    latestExecutorLoopStatus: state_var.latestExecutorLoopStatus,
    latestMainStepsTotalLength: state_var.latestMainStepsTotalLength,
    latestQueuedTotalLength: state_var.latestQueuedTotalLength,
    latestGeneratorTotalLength: state_var.latestGeneratorTotalLength,
    statusHistory: state_var.statusHistory,
    repeatedStepIndices: state_var.repeatedStepIndices,
    updates: state_var.updates,
    steps: Array.from(state_var.stepMap.values()).sort((left_var, right_var) => left_var.index - right_var.index),
  };
}

function buildStreamRequest_func(options_var: {
  bundle_var: LoadedAntigravityBundle;
  conversationId: string;
  subscriberId?: string;
  initialStepsPageBounds?: StepPageBounds;
}): unknown {
  return options_var.bundle_var.createMessage_func(
    options_var.bundle_var.schemas.streamAgentStateUpdatesRequest,
    {
      conversationId: options_var.conversationId,
      subscriberId: options_var.subscriberId ?? `observe-${randomUUID()}`,
      initialStepsPageBounds: options_var.initialStepsPageBounds
        ? {
          startIndex: options_var.initialStepsPageBounds.startIndex,
          endIndexExclusive: options_var.initialStepsPageBounds.endIndexExclusive,
        }
        : undefined,
    },
  );
}

function isAbortLikeError_func(error_var: unknown): boolean {
  if (!isRecord_func(error_var)) {
    return false;
  }
  const name_var = typeof error_var.name === 'string' ? error_var.name : '';
  const message_var = typeof error_var.message === 'string' ? error_var.message : '';
  return name_var === 'AbortError' || message_var.includes('aborted');
}

export async function collectAgentStateStream_func(
  options_var: CollectAgentStateStreamOptions,
): Promise<CollectAgentStateStreamResult> {
  const bundle_var = loadAntigravityBundle_func({
    extensionBundlePath: path.join(options_var.config_var.distPath, 'extension.js'),
  });
  const client_var = createLanguageServerClient_func({
    bundle_var,
    config_var: options_var.config_var,
    discovery_var: options_var.discovery_var,
    protocol_var: options_var.protocol_var,
  });
  const request_var = buildStreamRequest_func({
    bundle_var,
    conversationId: options_var.conversationId,
    subscriberId: options_var.subscriberId,
    initialStepsPageBounds: options_var.initialStepsPageBounds,
  });
  const state_var = createObservedConversationState_func();
  const abort_controller_var = new AbortController();
  let last_update_var: ObservedUpdateSummary | null = null;
  let timed_out_var = false;

  const timeout_var = setTimeout(() => {
    timed_out_var = true;
    abort_controller_var.abort();
  }, options_var.timeoutMs);

  try {
    for await (const message_var of client_var.streamAgentStateUpdates(
      request_var,
      { signal: abort_controller_var.signal },
    )) {
      const update_var = isRecord_func(message_var) ? message_var.update : null;
      if (!update_var) {
        continue;
      }

      last_update_var = applyAgentStateUpdate_func(state_var, update_var, {
        artifactFilePath_var: options_var.artifactFilePath,
      });

      if (options_var.isDone_func?.(state_var, last_update_var)) {
        break;
      }
    }
  } catch (error_var) {
    if (timed_out_var && isAbortLikeError_func(error_var)) {
      throw new Error(`streamAgentStateUpdates did not finish within ${options_var.timeoutMs}ms.`);
    }
    if (!abort_controller_var.signal.aborted || !isAbortLikeError_func(error_var)) {
      throw error_var;
    }
  } finally {
    clearTimeout(timeout_var);
    abort_controller_var.abort();
  }

  return {
    state_var,
    updateCount_var: state_var.updates.length,
    lastUpdate_var: last_update_var,
  };
}
