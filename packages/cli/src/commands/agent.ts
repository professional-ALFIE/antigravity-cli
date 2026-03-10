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
    .description('워크플로우/규칙 관리');

  // ── workflow ────────────────────────────────────
  agentCmd_var
    .command('workflow')
    .description('워크플로우 생성 (IDE에서 이름 입력 프롬프트 표시)')
    .option('--global', '글로벌 워크플로우 생성 (워크스페이스가 아닌 전역)')
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
        if (!result_var.success) throw new Error(result_var.error ?? '워크플로우 생성 실패');

        const scope_var = opts_var.global ? '글로벌' : '워크스페이스';
        console.log(c.green('✓') + ` ${scope_var} 워크플로우 생성 요청 → IDE에서 이름을 입력하세요`);
      });
    });

  // ── rule ────────────────────────────────────────
  agentCmd_var
    .command('rule')
    .description('에이전트 규칙 생성 (IDE에서 파일 생성)')
    .action(async () => {
      await h.run(async () => {
        const client_var = await h.getClient();
        const result_var = await client_var.post('commands/exec', {
          command: 'antigravity.createRule',
          args: [],
        });
        if (!result_var.success) throw new Error(result_var.error ?? '규칙 생성 실패');
        console.log(c.green('✓') + ' 규칙 생성 요청 → IDE에서 파일이 생성됩니다');
      });
    });
}
