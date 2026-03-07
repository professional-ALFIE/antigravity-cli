/**
 * exec — 헤드리스 Cascade 생성 후 메시지 전송.
 */

import type { Command } from 'commander';
import type { Helpers } from '../helpers.js';
import { printResult } from '../output.js';

// 모델 이름→ID 매핑 (SDK Models enum과 동일)
const MODEL_MAP: Record<string, number> = {
  flash: 1018,
  pro: 1164,
  'pro-high': 1165,
  sonnet: 1163,
  opus: 1154,
  gpt: 342,
};

function resolveModel(name_var?: string): number {
  if (!name_var) return MODEL_MAP.opus; // 기본값: opus
  if (MODEL_MAP[name_var]) return MODEL_MAP[name_var];
  const num_var = parseInt(name_var, 10);
  if (!isNaN(num_var)) return num_var; // 숫자 직접 지정도 허용
  throw new Error(`알 수 없는 모델: "${name_var}". 사용 가능: ${Object.keys(MODEL_MAP).join(', ')}`);
}

export function register(program: Command, h: Helpers): void {
  program
    .command('exec <message>')
    .description('헤드리스 Cascade 생성 후 메시지 전송')
    .option('-m, --model <model>', '사용할 모델 (기본: opus)', 'opus')
    .option('-r, --resume <id>', '기존 Cascade에 이어서 전송')
    .addHelpText('after', `
Arguments:
  message                   Cascade에 보낼 프롬프트 텍스트

Examples:
  $ antigravity-cli exec "이 프로젝트 분석해줘"
  $ antigravity-cli exec "테스트 작성해" -m pro
  $ antigravity-cli exec "이어서 진행" -r <cascade-id>
  $ antigravity-cli exec "결과 알려줘" --json

Models:
  flash       Gemini Flash (빠름)
  pro         Gemini Pro
  pro-high    Gemini Pro High (고품질)
  sonnet      Claude Sonnet
  opus        Claude Opus (기본)
  gpt         GPT OSS
`)
    .action(async (message: string, opts: { model?: string; resume?: string }) => {
      await h.run(async () => {
        const client_var = h.getClient();
        const model_id = resolveModel(opts.model);

        if (opts.resume) {
          // 기존 cascade에 메시지 전송
          const result_var = await client_var.post(`ls/send/${opts.resume}`, {
            text: message,
            model: model_id,
          });
          if (!result_var.success) throw new Error(result_var.error ?? 'send failed');
          printResult(result_var.data, h.isJsonMode());
        } else {
          // 새 cascade 생성
          const result_var = await client_var.post('ls/create', {
            text: message,
            model: model_id,
          });
          if (!result_var.success) throw new Error(result_var.error ?? 'create failed');
          printResult(result_var.data, h.isJsonMode());
        }
      });
    });
}
