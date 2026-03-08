/**
 * agent — 워크플로우/규칙 관리 (서브커맨드: workflow, rule).
 *
 * agent workflow    → 워크스페이스 워크플로우 생성
 * agent rule        → 에이전트 규칙 생성
 */

import type { Command } from 'commander';
import type { Helpers } from '../helpers.js';
import { c } from '../colors.js';

export function register(program: Command, h: Helpers): void {
  const agentCmd_var = program
    .command('agent')
    .description('워크플로우/규칙 관리');

  // ── workflow ────────────────────────────────────
  agentCmd_var
    .command('workflow')
    .description('워크스페이스 워크플로우 생성')
    .action(async () => {
      await h.run(async () => {
        const client_var = h.getClient();
        const result_var = await client_var.post('commands/exec', {
          command: 'antigravity.createWorkflow',
          args: [],
        });
        if (!result_var.success) throw new Error(result_var.error ?? 'workflow 생성 실패');
        console.log(c.green('✓') + ' 워크플로우 생성 요청 전송됨');
      });
    });

  // ── rule ────────────────────────────────────────
  agentCmd_var
    .command('rule')
    .description('에이전트 규칙 생성')
    .option('--glob <pattern>', '규칙이 적용될 파일 패턴 (예: "*.ts")')
    .option('--always', '모든 대화에 항상 적용')
    .action(async (opts_var: { glob?: string; always?: boolean }) => {
      await h.run(async () => {
        const client_var = h.getClient();

        // createRule 명령어에 옵션을 인자로 전달
        const args_var: unknown[] = [];
        if (opts_var.glob || opts_var.always) {
          args_var.push({ glob: opts_var.glob, always: opts_var.always ?? false });
        }

        const result_var = await client_var.post('commands/exec', {
          command: 'antigravity.createRule',
          args: args_var,
        });
        if (!result_var.success) throw new Error(result_var.error ?? 'rule 생성 실패');
        console.log(c.green('✓') + ' 규칙 생성 요청 전송됨');
      });
    });
}
