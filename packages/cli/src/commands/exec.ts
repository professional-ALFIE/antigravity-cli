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

/** SSE stepCountChanged 이벤트 데이터 */
interface StepCountEvent {
  count?: { sessionId?: string; newCount?: number; delta?: number; title?: string };
}

export interface ExecOptions {
  client_var: BridgeClient;
  message_var: string;
  model_var?: string;
  resume_var?: string;
  async_var?: boolean;
  idle_timeout_var?: number;
  json_mode_var?: boolean;
  spinner_var?: Spinner;
}

export async function runExec_func(options_var: ExecOptions): Promise<void> {
  const client_var = options_var.client_var;
  const model_id_var = resolveModelId_func(options_var.model_var);
  const idle_timeout_var = options_var.idle_timeout_var ?? 10000;
  const json_mode_var = Boolean(options_var.json_mode_var);

  const spinner_var = options_var.spinner_var ?? new Spinner();
  let cascade_id_var: string;

  if (options_var.resume_var) {
    cascade_id_var = options_var.resume_var;
    spinner_var.update(`메시지 전송: ${cascade_id_var.substring(0, 8)}...`);
    const result_var = await client_var.post(`ls/send/${cascade_id_var}`, {
      text: options_var.message_var,
      model: model_id_var,
    });
    if (!result_var.success) throw new Error(result_var.error ?? 'send failed');
  } else {
    spinner_var.update('Cascade 생성');
    const result_var = await client_var.post<string>('ls/create', {
      text: options_var.message_var,
      model: model_id_var,
    });
    if (!result_var.success) throw new Error(result_var.error ?? 'create failed');
    cascade_id_var = (result_var.data as string) ?? '';
    spinner_var.update(`Cascade 생성: ${cascade_id_var.substring(0, 8)}...`);
  }

  // 백그라운드 UI 명시 반영 (Phase 10-6)
  const track_result_var = await client_var.post(`ls/track/${cascade_id_var}`, {});
  if (!track_result_var.success) {
    throw new Error(
      `대화 생성/전송은 됐으나 백그라운드 UI 반영에 실패했습니다: ${track_result_var.error ?? 'track failed'}`,
    );
  }

  if (options_var.async_var) {
    spinner_var.succeed(`Cascade: ${cascade_id_var.substring(0, 8)}... (비동기)`);
    if (json_mode_var) {
      printResult({ cascadeId: cascade_id_var }, true);
    }
    return;
  }

  const start_time_var = Date.now();
  let step_count_var = 0;
  spinner_var.update('응답 대기');

  const { promise: sse_promise_var } = client_var.streamUntil(
    'monitor/events',
    (event_name_var: string, data_var: unknown) => {
      if (event_name_var === 'stepCountChanged') {
        const evt_var = data_var as StepCountEvent;
        const count_var = evt_var?.count;
        if (count_var?.newCount !== undefined) {
          step_count_var = count_var.newCount;
          spinner_var.update(`응답 대기 (step ${step_count_var})`);
        }
      }
    },
    idle_timeout_var,
  );

  await sse_promise_var;

  const elapsed_var = ((Date.now() - start_time_var) / 1000).toFixed(1);
  spinner_var.succeed(`완료 (${step_count_var} steps, ${elapsed_var}s)`);

  try {
    const conversation_var = await client_var.get(`ls/conversation/${cascade_id_var}`);
    if (conversation_var.success && conversation_var.data) {
      if (json_mode_var) {
        printResult(conversation_var.data, true);
        return;
      }

      const conversation_data_var = conversation_var.data as any;
      const steps_var = conversation_data_var?.trajectory?.steps ?? [];
      let response_text_var = '';
      for (let index_var = steps_var.length - 1; index_var >= 0; index_var -= 1) {
        const step_var = steps_var[index_var];
        if (step_var?.plannerResponse) {
          response_text_var = step_var.plannerResponse.response
            ?? step_var.plannerResponse.modifiedResponse
            ?? '';
          break;
        }
      }

      if (response_text_var) {
        process.stdout.write(`\n${response_text_var}\n`);
      } else {
        printResult(conversation_var.data, false);
      }
    }
  } catch {
    process.stderr.write(`  ${c.dim('(응답 조회 실패 — 대화 ID로 직접 확인하세요)')}\n`);
    if (json_mode_var) {
      printResult({ cascadeId: cascade_id_var }, true);
    }
  }
}
