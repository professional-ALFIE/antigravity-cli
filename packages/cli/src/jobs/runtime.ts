import type { BridgeClient } from '../client.js';
import type { Spinner } from '../spinner.js';
import { listChangedFilesSince_func, writeJobRecord_func } from './store.js';
import type { ApprovalPolicy, JobRecord, JobResultRecord, JobStatus } from './types.js';
import { timeout_exit_code_var } from './types.js';

const RUNNING_STATUS_VAR = 'CASCADE_RUN_STATUS_RUNNING';

export class JobTimeoutError extends Error {
  readonly exit_code_var = timeout_exit_code_var;
}

function sleep_func(ms_var: number): Promise<void> {
  return new Promise((resolve_var) => {
    setTimeout(resolve_var, ms_var);
  });
}

function getObjectRecord_func(value_var: unknown): Record<string, unknown> | undefined {
  return value_var && typeof value_var === 'object'
    ? value_var as Record<string, unknown>
    : undefined;
}

function getSteps_func(conversation_var: unknown): Array<Record<string, unknown>> {
  const conversation_record_var = getObjectRecord_func(conversation_var);
  const trajectory_var = getObjectRecord_func(conversation_record_var?.['trajectory']);
  const steps_var = trajectory_var?.['steps'];
  return Array.isArray(steps_var)
    ? steps_var.filter((step_var): step_var is Record<string, unknown> => (
      Boolean(step_var) && typeof step_var === 'object'
    ))
    : [];
}

export function extractResponseText_func(conversation_var: unknown): string {
  const steps_var = getSteps_func(conversation_var);

  for (let index_var = steps_var.length - 1; index_var >= 0; index_var -= 1) {
    const planner_response_var = getObjectRecord_func(steps_var[index_var]?.['plannerResponse']);
    const response_var = planner_response_var?.['response'];
    if (typeof response_var === 'string' && response_var.length > 0) {
      return response_var;
    }

    const modified_response_var = planner_response_var?.['modifiedResponse'];
    if (typeof modified_response_var === 'string' && modified_response_var.length > 0) {
      return modified_response_var;
    }
  }

  return '';
}

function extractLastModifiedTime_func(
  conversation_var: unknown,
  list_entry_var: Record<string, unknown> | undefined,
  fallback_iso_var: string,
): string {
  const direct_last_modified_var = list_entry_var?.['lastModifiedTime'];
  if (typeof direct_last_modified_var === 'string' && direct_last_modified_var.length > 0) {
    return direct_last_modified_var;
  }

  const steps_var = getSteps_func(conversation_var);
  for (let index_var = steps_var.length - 1; index_var >= 0; index_var -= 1) {
    const metadata_var = getObjectRecord_func(steps_var[index_var]?.['metadata']);
    const candidates_var = [
      metadata_var?.['completedAt'],
      metadata_var?.['viewableAt'],
      metadata_var?.['createdAt'],
    ];

    for (const candidate_var of candidates_var) {
      if (typeof candidate_var === 'string' && candidate_var.length > 0) {
        return candidate_var;
      }
    }
  }

  return fallback_iso_var;
}

function extractConversationStatus_func(conversation_var: unknown): string | null {
  const conversation_record_var = getObjectRecord_func(conversation_var);
  const status_var = conversation_record_var?.['status'];
  return typeof status_var === 'string' ? status_var : null;
}

function extractStepCount_func(
  conversation_var: unknown,
  list_entry_var: Record<string, unknown> | undefined,
): number {
  const step_count_var = list_entry_var?.['stepCount'];
  if (typeof step_count_var === 'number') {
    return step_count_var;
  }

  const total_steps_var = getObjectRecord_func(conversation_var)?.['numTotalSteps'];
  if (typeof total_steps_var === 'number') {
    return total_steps_var;
  }

  return getSteps_func(conversation_var).length;
}

function buildConversationSignature_func(conversation_var: unknown, step_count_var: number): string {
  const steps_var = getSteps_func(conversation_var);
  const last_step_var = steps_var.length > 0 ? steps_var[steps_var.length - 1] : undefined;

  return JSON.stringify({
    status: extractConversationStatus_func(conversation_var),
    stepCount: step_count_var,
    lastStepType: last_step_var?.['type'] ?? null,
    lastStepStatus: last_step_var?.['status'] ?? null,
    responseLength: extractResponseText_func(conversation_var).length,
  });
}

function mapCascadeStatusToJobStatus_func(status_var: string | null): JobStatus | null {
  if (!status_var) {
    return null;
  }

  if (status_var === RUNNING_STATUS_VAR) {
    return null;
  }

  if (
    status_var.includes('FAILED')
    || status_var.includes('ERROR')
    || status_var.includes('CANCEL')
  ) {
    return 'failed';
  }

  return 'completed';
}

function buildResult_func(job_var: JobRecord, conversation_var: unknown): JobResultRecord {
  return {
    conversation: conversation_var,
    responseText: extractResponseText_func(conversation_var),
    changedFiles: listChangedFilesSince_func(job_var.workspace, job_var.createdAt),
  };
}

function getMaxWaitMs_func(idle_timeout_var: number): number {
  const override_var = process.env.ANTIGRAVITY_CLI_MAX_WAIT_MS;
  if (override_var) {
    const parsed_override_var = Number.parseInt(override_var, 10);
    if (Number.isFinite(parsed_override_var) && parsed_override_var > 0) {
      return parsed_override_var;
    }
  }

  return Math.max(idle_timeout_var * 6, 60000);
}

async function fetchConversationSnapshot_func(
  client_var: BridgeClient,
  cascade_id_var: string,
): Promise<{
  conversation_var: unknown;
  list_entry_var: Record<string, unknown> | undefined;
}> {
  const [conversation_result_var, list_result_var] = await Promise.all([
    client_var.get(`ls/conversation/${cascade_id_var}`),
    client_var.get('ls/list'),
  ]);

  if (!conversation_result_var.success) {
    throw new Error(conversation_result_var.error ?? 'conversation fetch failed');
  }

  const list_data_var = getObjectRecord_func(list_result_var.data);
  const list_entry_var = getObjectRecord_func(list_data_var?.[cascade_id_var]);

  return {
    conversation_var: conversation_result_var.data,
    list_entry_var,
  };
}

export async function waitForJobCompletion_func(params_var: {
  client_var: BridgeClient;
  job_var: JobRecord;
  idle_timeout_var: number;
  approval_policy_var: ApprovalPolicy;
  spinner_var?: Spinner;
}): Promise<JobRecord> {
  const { client_var, idle_timeout_var, approval_policy_var, spinner_var } = params_var;
  const job_var = { ...params_var.job_var, status: 'running' as JobStatus };
  writeJobRecord_func(job_var);

  const start_time_var = Date.now();
  let last_progress_at_var = Date.now();
  let last_signature_var: string | null = null;
  let stable_polls_var = 0;
  let step_count_var = job_var.lastStepCount;

  const monitor_var = client_var.streamUntil(
    'monitor/events',
    (event_name_var: string, data_var: unknown) => {
      if (event_name_var === 'stepCountChanged') {
        const count_var = getObjectRecord_func(data_var)?.['count'];
        const new_count_var = getObjectRecord_func(count_var)?.['newCount'];
        if (typeof new_count_var === 'number') {
          step_count_var = new_count_var;
          job_var.lastStepCount = new_count_var;
          writeJobRecord_func(job_var);
          last_progress_at_var = Date.now();
          spinner_var?.update(`Waiting for response (step ${new_count_var})`);
        }
      } else {
        last_progress_at_var = Date.now();
      }
    },
    Math.max(idle_timeout_var * 2, 60000),
  );

  try {
    while (true) {
      let drive_performed_var = false;

      if (approval_policy_var === 'auto') {
        try {
          const drive_result_var = await client_var.post('cascade/drive', {});
          const drive_data_var = getObjectRecord_func(drive_result_var.data);
          drive_performed_var = Boolean(drive_result_var.success && drive_data_var?.['performed']);
          if (drive_performed_var) {
            last_progress_at_var = Date.now();
          }
        } catch {
          // Best-effort only.
        }
      }

      const snapshot_var = await fetchConversationSnapshot_func(client_var, job_var.cascadeId);
      const next_step_count_var = extractStepCount_func(
        snapshot_var.conversation_var,
        snapshot_var.list_entry_var,
      );
      const signature_var = buildConversationSignature_func(snapshot_var.conversation_var, next_step_count_var);
      const previous_step_count_var = job_var.lastStepCount;

      job_var.lastStepCount = next_step_count_var;
      job_var.lastModifiedTime = extractLastModifiedTime_func(
        snapshot_var.conversation_var,
        snapshot_var.list_entry_var,
        job_var.lastModifiedTime,
      );

      if (next_step_count_var !== previous_step_count_var || signature_var !== last_signature_var) {
        last_progress_at_var = Date.now();
      }

      if (signature_var === last_signature_var && !drive_performed_var) {
        stable_polls_var += 1;
      } else {
        stable_polls_var = 0;
      }
      last_signature_var = signature_var;

      const mapped_status_var = mapCascadeStatusToJobStatus_func(
        extractConversationStatus_func(snapshot_var.conversation_var),
      );
      if (mapped_status_var) {
        job_var.status = mapped_status_var;
        job_var.result = buildResult_func(job_var, snapshot_var.conversation_var);
        writeJobRecord_func(job_var);
        return job_var;
      }

      if (
        stable_polls_var >= 2
        && (Date.now() - last_progress_at_var) >= idle_timeout_var
      ) {
        job_var.status = 'completed';
        job_var.result = buildResult_func(job_var, snapshot_var.conversation_var);
        writeJobRecord_func(job_var);
        return job_var;
      }

      writeJobRecord_func(job_var);

      if ((Date.now() - start_time_var) >= getMaxWaitMs_func(idle_timeout_var)) {
        job_var.status = 'timed_out';
        writeJobRecord_func(job_var);
        throw new JobTimeoutError(
          `Timed out waiting for job ${job_var.jobId} (cascade ${job_var.cascadeId}).`,
        );
      }

      spinner_var?.update(`Waiting for response (step ${job_var.lastStepCount})`);
      await sleep_func(1500);
    }
  } finally {
    monitor_var.abort();
    await monitor_var.promise.catch(() => {
      // ignore monitor shutdown noise
    });
  }
}
