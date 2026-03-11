/**
 * 루트 기본 모드에서 사용하는 대화 실행 본체.
 */

import type { BridgeClient } from '../client.js';
import { printResult } from '../output.js';
import { Spinner } from '../spinner.js';
import { c } from '../colors.js';
import {
  resolveModelId_func,
} from '../model-resolver.js';

interface ConversationStep {
  type?: string;
  status?: string;
  metadata?: Record<string, unknown>;
  plannerResponse?: {
    response?: string;
    modifiedResponse?: string;
  };
  notifyUser?: {
    notificationContent?: string;
    isBlocking?: boolean;
  };
}

interface ConversationData {
  status?: string;
  numTotalSteps?: number;
  trajectory?: {
    steps?: ConversationStep[];
  };
  executorMetadatas?: Array<{
    executionId?: string;
    lastStepIdx?: number;
    terminationReason?: string;
  }>;
}

interface ConversationWaitResult {
  conversation_data_var: ConversationData;
  step_count_var: number;
}

export class ExecTimeoutError extends Error {
  cascade_id_var: string;

  constructor(message_var: string, cascade_id_var: string) {
    super(message_var);
    this.name = 'ExecTimeoutError';
    this.cascade_id_var = cascade_id_var;
  }
}

export interface ExecResult {
  cascade_id_var: string;
  conversation_data_var?: ConversationData;
  step_count_var?: number;
}

export interface ExecAttachment {
  label_var: string;
  file_name_var: string;
  mime_type_var: string;
  temp_path_var: string;
  byte_size_var: number;
}

export interface ExecOptions {
  client_var: BridgeClient;
  message_var: string;
  model_var?: string;
  resume_var?: string;
  attachments_var?: ExecAttachment[];
  async_var?: boolean;
  idle_timeout_var?: number;
  json_mode_var?: boolean;
  spinner_var?: Spinner;
}

function sleep_func(delay_ms_var: number): Promise<void> {
  return new Promise((resolve_var) => {
    setTimeout(resolve_var, delay_ms_var);
  });
}

function getPollIntervalMs_func(): number {
  const raw_value_var = process.env['ANTIGRAVITY_CLI_POLL_INTERVAL_MS'];
  const parsed_value_var = raw_value_var
    ? Number.parseInt(raw_value_var, 10)
    : Number.NaN;

  if (Number.isFinite(parsed_value_var) && parsed_value_var > 0) {
    return parsed_value_var;
  }

  return 1000;
}

function getSteps_func(conversation_data_var: ConversationData): ConversationStep[] {
  return conversation_data_var?.trajectory?.steps ?? [];
}

function getStepCount_func(conversation_data_var: ConversationData): number {
  return conversation_data_var?.numTotalSteps ?? getSteps_func(conversation_data_var).length;
}

function isActiveStepStatus_func(status_var: unknown): boolean {
  if (typeof status_var !== 'string') {
    return false;
  }

  const normalized_status_var = status_var.toUpperCase();
  return normalized_status_var.includes('PENDING')
    || normalized_status_var.includes('RUNNING')
    || normalized_status_var.includes('GENERATING')
    || normalized_status_var.includes('WAIT');
}

function hasActiveSteps_func(conversation_data_var: ConversationData): boolean {
  return getSteps_func(conversation_data_var).some((step_var) => isActiveStepStatus_func(step_var?.status));
}

function getProgressToken_func(conversation_data_var: ConversationData): string {
  const steps_var = getSteps_func(conversation_data_var);
  const last_step_var = steps_var[steps_var.length - 1];
  const metadata_var = (last_step_var?.metadata ?? {}) as Record<string, unknown>;
  const executor_summary_var = (conversation_data_var?.executorMetadatas ?? [])
    .map((metadata_item_var) => [
      metadata_item_var.executionId ?? '',
      metadata_item_var.lastStepIdx ?? '',
      metadata_item_var.terminationReason ?? '',
    ].join(':'))
    .join('|');

  return [
    conversation_data_var?.status ?? '',
    getStepCount_func(conversation_data_var),
    last_step_var?.type ?? '',
    last_step_var?.status ?? '',
    metadata_var['completedAt'] ?? '',
    metadata_var['finishedGeneratingAt'] ?? '',
    metadata_var['viewableAt'] ?? '',
    executor_summary_var,
  ].join('::');
}

function extractLatestResponseText_func(conversation_data_var: ConversationData): string {
  const steps_var = getSteps_func(conversation_data_var);

  for (let index_var = steps_var.length - 1; index_var >= 0; index_var -= 1) {
    const step_var = steps_var[index_var];
    const response_text_var = step_var?.plannerResponse?.modifiedResponse
      ?? step_var?.plannerResponse?.response
      ?? step_var?.notifyUser?.notificationContent
      ?? '';

    if (response_text_var) {
      return response_text_var;
    }
  }

  return '';
}

function getWaitHint_func(conversation_data_var: ConversationData): string | null {
  const steps_var = getSteps_func(conversation_data_var);

  for (let index_var = steps_var.length - 1; index_var >= 0; index_var -= 1) {
    const step_var = steps_var[index_var];
    const step_type_var = (step_var?.type ?? '').toUpperCase();
    const step_status_var = (step_var?.status ?? '').toUpperCase();

    if (step_type_var.includes('RUN_COMMAND') || step_type_var.includes('TERMINAL')) {
      return '터미널 명령 승인/실행 대기일 수 있습니다. `antigravity-cli accept`, `antigravity-cli run`을 확인하세요.';
    }

    if (step_type_var.includes('NOTIFY_USER') || step_var?.notifyUser?.isBlocking) {
      return '대화가 추가 사용자 입력을 기다리는 상태일 수 있습니다. Antigravity 대화 패널을 열어 확인하세요.';
    }

    if (step_status_var.includes('WAIT')) {
      return '대화가 사용자 입력을 기다리는 상태일 수 있습니다. Antigravity 대화 패널을 열어 확인하세요.';
    }
  }

  return null;
}

async function waitForConversation_func(
  client_var: BridgeClient,
  cascade_id_var: string,
  idle_timeout_var: number,
  spinner_var: Spinner,
): Promise<ConversationWaitResult> {
  const poll_interval_ms_var = getPollIntervalMs_func();
  let step_count_var = 0;
  let saw_activity_var = false;
  let last_progress_token_var = '';
  let last_progress_at_var = Date.now();

  while (true) {
    const conversation_var = await client_var.get<ConversationData>(`ls/conversation/${cascade_id_var}`);
    if (!conversation_var.success || !conversation_var.data) {
      throw new Error(conversation_var.error ?? 'conversation fetch failed');
    }

    const conversation_data_var = conversation_var.data as ConversationData;
    const next_step_count_var = getStepCount_func(conversation_data_var);
    if (next_step_count_var !== step_count_var) {
      step_count_var = next_step_count_var;
      if (step_count_var > 0) {
        spinner_var.update(`응답 대기 (step ${step_count_var})`);
      }
    }

    const progress_token_var = getProgressToken_func(conversation_data_var);
    if (progress_token_var !== last_progress_token_var) {
      last_progress_token_var = progress_token_var;
      last_progress_at_var = Date.now();
    }

    const has_active_steps_var = hasActiveSteps_func(conversation_data_var);
    const response_text_var = extractLatestResponseText_func(conversation_data_var);
    if (conversation_data_var.status !== 'CASCADE_RUN_STATUS_IDLE' || has_active_steps_var) {
      saw_activity_var = true;
    }

    if (
      conversation_data_var.status === 'CASCADE_RUN_STATUS_IDLE'
      && !has_active_steps_var
      && (saw_activity_var || Boolean(response_text_var))
    ) {
      return {
        conversation_data_var,
        step_count_var,
      };
    }

    if (idle_timeout_var > 0 && Date.now() - last_progress_at_var > idle_timeout_var) {
      const hint_var = getWaitHint_func(conversation_data_var);
      throw new Error(
        hint_var
          ? `응답 대기 시간이 초과되었습니다. ${hint_var}`
          : '응답 대기 시간이 초과되었습니다. Antigravity 대화 패널에서 진행 상태를 확인하세요.',
      );
    }

    await sleep_func(poll_interval_ms_var);
  }
}

export async function runExec_func(options_var: ExecOptions): Promise<ExecResult> {
  const client_var = options_var.client_var;
  const model_id_var = resolveModelId_func(options_var.model_var);
  const idle_timeout_var = options_var.idle_timeout_var ?? 10000;
  const json_mode_var = Boolean(options_var.json_mode_var);
  const attachments_var = options_var.attachments_var ?? [];
  const has_attachments_var = attachments_var.length > 0;

  const spinner_var = options_var.spinner_var ?? new Spinner();
  let cascade_id_var: string;

  if (has_attachments_var) {
    spinner_var.update(options_var.resume_var ? '이미지 메시지 전송' : '이미지 대화 생성');
    const result_var = await client_var.post<{ cascadeId?: string }>('attachments/send', {
      cascadeId: options_var.resume_var,
      text: options_var.message_var,
      model: model_id_var,
      attachments: attachments_var.map((attachment_var) => ({
        label: attachment_var.label_var,
        fileName: attachment_var.file_name_var,
        mimeType: attachment_var.mime_type_var,
        tempPath: attachment_var.temp_path_var,
        sizeBytes: attachment_var.byte_size_var,
      })),
    });
    if (!result_var.success) throw new Error(result_var.error ?? 'attachment send failed');
    cascade_id_var = ((result_var.data as { cascadeId?: string } | undefined)?.cascadeId ?? options_var.resume_var ?? '').trim();
    if (!cascade_id_var) {
      throw new Error('이미지 메시지는 전송됐지만 cascade ID를 확인하지 못했습니다.');
    }
  } else if (options_var.resume_var) {
    cascade_id_var = options_var.resume_var;
    spinner_var.update(`Sending message: ${cascade_id_var.substring(0, 8)}...`);
    const result_var = await client_var.post(`ls/send/${cascade_id_var}`, {
      text: options_var.message_var,
      model: model_id_var,
    });
    if (!result_var.success) throw new Error(result_var.error ?? 'send failed');
  } else {
    spinner_var.update('Creating cascade');
    const result_var = await client_var.post<string>('ls/create', {
      text: options_var.message_var,
      model: model_id_var,
    });
    if (!result_var.success) throw new Error(result_var.error ?? 'create failed');
    cascade_id_var = (result_var.data as string) ?? '';
    spinner_var.update(`Creating cascade: ${cascade_id_var.substring(0, 8)}...`);
  }

  // 백그라운드 UI 명시 반영 (Phase 10-6)
  const track_result_var = await client_var.post(`ls/track/${cascade_id_var}`, {});
  if (!track_result_var.success) {
    throw new Error(
      `Conversation created/sent but background UI tracking failed: ${track_result_var.error ?? 'track failed'}`,
    );
  }

  if (options_var.async_var) {
    spinner_var.succeed(`Cascade: ${cascade_id_var.substring(0, 8)}... (async)`);
    if (json_mode_var) {
      printResult({ cascadeId: cascade_id_var }, true);
    }
    return {
      cascade_id_var,
    };
  }

  const start_time_var = Date.now();
  spinner_var.update('Waiting for response');

  let conversation_data_var: ConversationData;
  let step_count_var: number;
  try {
    const wait_result_var = await waitForConversation_func(
      client_var,
      cascade_id_var,
      idle_timeout_var,
      spinner_var,
    );
    conversation_data_var = wait_result_var.conversation_data_var;
    step_count_var = wait_result_var.step_count_var;
  } catch (error_var) {
    if (error_var instanceof Error && error_var.message.includes('응답 대기 시간이 초과되었습니다')) {
      throw new ExecTimeoutError(error_var.message, cascade_id_var);
    }

    throw error_var;
  }

  const elapsed_var = ((Date.now() - start_time_var) / 1000).toFixed(1);
  spinner_var.succeed(`Done (${step_count_var} steps, ${elapsed_var}s)`);

  try {
    if (json_mode_var) {
      printResult(conversation_data_var, true);
      return {
        cascade_id_var,
        conversation_data_var,
        step_count_var,
      };
    }

    const response_text_var = extractLatestResponseText_func(conversation_data_var);
    if (response_text_var) {
      process.stdout.write(`\n${response_text_var}\n`);
    } else {
      printResult(conversation_data_var, false);
    }
  } catch {
    process.stderr.write(`  ${c.dim('(Failed to fetch response — check conversation by ID)')}\n`);
    if (json_mode_var) {
      printResult({ cascadeId: cascade_id_var }, true);
    }
  }

  return {
    cascade_id_var,
    conversation_data_var,
    step_count_var,
  };
}
