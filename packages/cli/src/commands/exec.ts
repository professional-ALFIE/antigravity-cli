/**
 * exec — 헤드리스 Cascade 생성 후 메시지 전송 + 응답 대기.
 *
 * 기본: cascade 생성 → SSE로 진행 감시 → 완료 시 응답 조회
 * --no-wait: fire-and-forget (cascadeId만 출력)
 */

import type { Command } from 'commander';
import type { Helpers } from '../helpers.js';
import { printResult } from '../output.js';
import { Spinner } from '../spinner.js';
import { c } from '../colors.js';
import {
  default_model_name_var,
  formatDocumentedModels_func,
  resolveModelId_func,
} from '../model-resolver.js';

/** SSE stepCountChanged 이벤트 데이터 */
interface StepCountEvent {
  count?: { sessionId?: string; newCount?: number; delta?: number; title?: string };
}

export function register(program: Command, h: Helpers): void {
  const models_help_var = formatDocumentedModels_func();

  program
    .command('exec <message>')
    .description('AI에게 메시지 전송 (응답 대기)')
    .option('-m, --model <model>', `사용할 모델 (기본: ${default_model_name_var})`, default_model_name_var)
    .option('-r, --resume <id>', '기존 대화에 이어서 전송')
    .option('--no-wait', '응답 대기 없이 바로 종료 (fire-and-forget)')
    .option('--idle-timeout <ms>', 'idle timeout 밀리초 (기본: 10000)', '10000')
    .addHelpText('after', `
Arguments:
  message                   AI에게 보낼 프롬프트 텍스트

Examples:
  $ antigravity-cli exec "이 프로젝트 분석해줘"
  $ antigravity-cli exec "테스트 작성해" -m gemini-3.1-pro
  $ antigravity-cli exec "이어서 진행" -r <cascade-id>
  $ antigravity-cli exec "빠르게 답해" --no-wait

Models:
${models_help_var}
`)
    .action(async (message: string, opts: {
      model?: string;
      resume?: string;
      wait?: boolean;      // commander의 --no-wait → opts.wait = false
      idleTimeout?: string;
    }) => {
      await h.run(async () => {
        const client_var = h.getClient();
        const model_id_var = resolveModelId_func(opts.model);
        const idle_ms = parseInt(opts.idleTimeout ?? '10000', 10);

        let cascade_id: string;

        if (opts.resume) {
          // 기존 cascade에 메시지 전송
          cascade_id = opts.resume;
          const result_var = await client_var.post(`ls/send/${cascade_id}`, {
            text: message,
            model: model_id_var,
          });
          if (!result_var.success) throw new Error(result_var.error ?? 'send failed');
          process.stderr.write(`  ${c.cyan('◉')} 메시지 전송: ${c.dim(cascade_id.substring(0, 8))}...\n`);
        } else {
          // 새 cascade 생성
          const result_var = await client_var.post<string>('ls/create', {
            text: message,
            model: model_id_var,
          });
          if (!result_var.success) throw new Error(result_var.error ?? 'create failed');
          cascade_id = (result_var.data as string) ?? '';
          process.stderr.write(`  ${c.cyan('◉')} Cascade 생성: ${c.dim(cascade_id.substring(0, 8))}...\n`);
        }

        // --no-wait: fire-and-forget
        if (opts.wait === false) {
          if (h.isJsonMode()) {
            printResult({ cascadeId: cascade_id }, true);
          } else {
            process.stderr.write(`  ${c.dim('(--no-wait: 응답 대기 없이 종료)')}\n`);
          }
          return;
        }

        // 응답 대기: SSE로 stepCountChanged 감시
        const spinner_var = new Spinner();
        const start_time = Date.now();
        let step_count = 0;

        spinner_var.start('AI 응답 대기 중...');

        const { promise: sse_promise } = client_var.streamUntil(
          'monitor/events',
          (event_name: string, data: unknown) => {
            if (event_name === 'stepCountChanged') {
              const evt_var = data as StepCountEvent;
              const count_var = evt_var?.count;
              if (count_var?.newCount !== undefined) {
                step_count = count_var.newCount;
                spinner_var.update(`AI 응답 대기 중... (step ${step_count})`);
              }
            }
          },
          idle_ms,
        );

        await sse_promise;

        const elapsed_var = ((Date.now() - start_time) / 1000).toFixed(1);
        spinner_var.succeed(`완료 (${step_count} steps, ${elapsed_var}s)`);

        // 응답 조회
        try {
          const conv_var = await client_var.get(`ls/conversation/${cascade_id}`);
          if (conv_var.success && conv_var.data) {
            if (h.isJsonMode()) {
              printResult(conv_var.data, true);
            } else {
              // trajectory.steps에서 마지막 plannerResponse 추출
              const conv_data = conv_var.data as any;
              const steps_var = conv_data?.trajectory?.steps ?? [];
              let response_text = '';
              for (let i = steps_var.length - 1; i >= 0; i--) {
                const step_var = steps_var[i];
                if (step_var?.plannerResponse) {
                  response_text = step_var.plannerResponse.response
                    ?? step_var.plannerResponse.modifiedResponse
                    ?? '';
                  break;
                }
              }
              if (response_text) {
                process.stdout.write(`\n${response_text}\n`);
              } else {
                // 구조를 모르는 경우 전체 출력
                printResult(conv_var.data, false);
              }
            }
          }
        } catch {
          process.stderr.write(`  ${c.dim('(응답 조회 실패 — 대화 ID로 직접 확인하세요)')}\n`);
          if (h.isJsonMode()) {
            printResult({ cascadeId: cascade_id }, true);
          }
        }
      });
    });
}
