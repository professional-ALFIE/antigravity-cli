/**
 * 루트 기본 모드에서 사용하는 대화 실행 본체.
 */

import type { BridgeClient } from '../client.js';
import { printResult } from '../output.js';
import { Spinner } from '../spinner.js';
import { resolveModelId_func } from '../model-resolver.js';
import {
  createJobRecord_func,
  writeJobRecord_func,
} from '../jobs/store.js';
import {
  JobTimeoutError,
  extractResponseText_func,
  waitForJobCompletion_func,
} from '../jobs/runtime.js';
import type { ApprovalPolicy, JobRecord } from '../jobs/types.js';

export interface ExecOptions {
  client_var: BridgeClient;
  workspace_var: string;
  message_var: string;
  model_var?: string;
  resume_var?: string;
  async_var?: boolean;
  idle_timeout_var?: number;
  json_mode_var?: boolean;
  approval_policy_var: ApprovalPolicy;
  spinner_var?: Spinner;
}

export async function runExec_func(options_var: ExecOptions): Promise<JobRecord> {
  const client_var = options_var.client_var;
  const model_id_var = resolveModelId_func(options_var.model_var);
  const idle_timeout_var = options_var.idle_timeout_var ?? 10000;
  const json_mode_var = Boolean(options_var.json_mode_var);
  const spinner_var = options_var.spinner_var ?? new Spinner();
  let cascade_id_var: string;

  if (options_var.resume_var) {
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

  const track_result_var = await client_var.post(`ls/track/${cascade_id_var}`, {});
  if (!track_result_var.success) {
    throw new Error(
      `Conversation created/sent but background UI tracking failed: ${track_result_var.error ?? 'track failed'}`,
    );
  }

  const job_var = createJobRecord_func({
    cascadeId: cascade_id_var,
    workspace: options_var.workspace_var,
    prompt: options_var.message_var,
    approvalPolicy: options_var.approval_policy_var,
  });
  writeJobRecord_func(job_var);

  if (options_var.async_var) {
    spinner_var.succeed(`Job ${job_var.jobId.substring(0, 8)}... (async)`);
    if (json_mode_var) {
      printResult({
        jobId: job_var.jobId,
        cascadeId: job_var.cascadeId,
      }, true);
    }
    return job_var;
  }

  const start_time_var = Date.now();
  spinner_var.update('Waiting for response');

  try {
    const completed_job_var = await waitForJobCompletion_func({
      client_var,
      job_var,
      idle_timeout_var,
      approval_policy_var: options_var.approval_policy_var,
      spinner_var,
    });

    const elapsed_var = ((Date.now() - start_time_var) / 1000).toFixed(1);
    spinner_var.succeed(`Done (${completed_job_var.lastStepCount} steps, ${elapsed_var}s)`);

    if (json_mode_var) {
      printResult({
        jobId: completed_job_var.jobId,
        cascadeId: completed_job_var.cascadeId,
        status: completed_job_var.status,
        result: completed_job_var.result,
      }, true);
      return completed_job_var;
    }

    const response_text_var = extractResponseText_func(completed_job_var.result?.conversation);
    if (response_text_var) {
      process.stdout.write(`\n${response_text_var}\n`);
    } else if (completed_job_var.result) {
      printResult(completed_job_var.result, false);
    }

    return completed_job_var;
  } catch (error_var) {
    if (error_var instanceof JobTimeoutError) {
      spinner_var.stop();
    }
    throw error_var;
  }
}
