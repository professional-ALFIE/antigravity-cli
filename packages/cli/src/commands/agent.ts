/**
 * agent — 워크플로우/규칙 관리 (서브커맨드: workflow, rule).
 *
 * agent workflow          → 워크스페이스 워크플로우 생성 (IDE에서 이름 입력 프롬프트 표시)
 * agent workflow --global → 글로벌 워크플로우 생성
 * agent rule              → 에이전트 규칙 생성 (IDE에서 파일 생성)
 *
 * 참고: 세 명령어 모두 IDE 내부에서 프롬프트/파일생성 UI를 표시한다.
 *       CLI에서 직접 내용을 전달하는 것은 불가.
 */

import type { Command } from 'commander';
import type { Helpers } from '../helpers.js';
import { c } from '../colors.js';

export function register(program: Command, h: Helpers): void {
  const agentCmd_var = program
    .command('agent')
    .description('Workflow and rule management');

  // ── workflow ────────────────────────────────────
  agentCmd_var
    .command('workflow')
    .description('Create workflow (IDE will prompt for name)')
    .option('--global', 'Create global workflow (not workspace-scoped)')
    .action(async (opts_var: { global?: boolean }) => {
      await h.run(async () => {
        const client_var = await h.getClient();
        const command_var = opts_var.global
          ? 'antigravity.createGlobalWorkflow'
          : 'antigravity.createWorkflow';
        const result_var = await client_var.post('commands/exec', {
          command: command_var,
          args: [],
        });
        if (!result_var.success) throw new Error(result_var.error ?? 'Workflow creation failed');

        const scope_var = opts_var.global ? 'Global' : 'Workspace';
        console.log(c.green('✓') + ` ${scope_var} workflow creation requested — enter the name in the IDE`);
      });
    });

  // ── rule ────────────────────────────────────────
  agentCmd_var
    .command('rule')
    .description('Create agent rule (IDE will create file)')
    .action(async () => {
      await h.run(async () => {
        const client_var = await h.getClient();
        const result_var = await client_var.post('commands/exec', {
          command: 'antigravity.createRule',
          args: [],
        });
        if (!result_var.success) throw new Error(result_var.error ?? 'Rule creation failed');
        console.log(c.green('✓') + ' Rule creation requested — file will be created in the IDE');
      });
    });
}
