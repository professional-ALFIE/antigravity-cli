/**
 * prefs — 에이전트 설정 조회.
 */

import type { Command } from 'commander';
import type { Helpers } from '../helpers.js';
import { printResult } from '../output.js';

export function register(program: Command, h: Helpers): void {
  program
    .command('prefs')
    .description('에이전트 설정 조회')
    .action(async () => {
      await h.run(async () => {
        const client_var = h.getClient();
        const result_var = await client_var.get('cascade/preferences');
        if (!result_var.success) throw new Error(result_var.error ?? 'prefs failed');
        printResult(result_var.data, h.isJsonMode());
      });
    });
}
