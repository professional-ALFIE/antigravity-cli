/**
 * resume — 대화 목록 조회 / 특정 대화 이어가기.
 *
 * resume         → 대화 목록 출력 (기존 list)
 * resume <id>    → 특정 대화를 UI에 표시 (기존 focus)
 */

import type { Command } from 'commander';
import type { Helpers } from '../helpers.js';
import { printResult } from '../output.js';
import { c } from '../colors.js';

export function register(program: Command, h: Helpers): void {
  program
    .command('resume [id]')
    .description('대화 목록 조회 / 특정 대화를 UI에 표시')
    .action(async (id_var?: string) => {
      await h.run(async () => {
        const client_var = h.getClient();

        if (id_var) {
          // resume <id> — 특정 대화를 UI에 표시
          const result_var = await client_var.post(`ls/focus/${id_var}`);
          if (!result_var.success) throw new Error(result_var.error ?? 'focus failed');
          console.log(c.green('✓') + ` 대화 ${c.cyan(id_var.slice(0, 8))} 로 전환됨`);
        } else {
          // resume — 대화 목록 출력
          const result_var = await client_var.get('ls/list');
          if (!result_var.success) throw new Error(result_var.error ?? 'list failed');
          printResult(result_var.data, h.isJsonMode());
        }
      });
    });
}
