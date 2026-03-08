/**
 * list — 대화 목록 조회.
 */

import type { Command } from 'commander';
import type { Helpers } from '../helpers.js';
import { printResult } from '../output.js';

export function register(program: Command, h: Helpers): void {
  program
    .command('list')
    .description('대화 목록 조회')
    .action(async () => {
      await h.run(async () => {
        const client_var = h.getClient();
        const result_var = await client_var.get('ls/list');
        if (!result_var.success) throw new Error(result_var.error ?? 'list failed');
        printResult(result_var.data, h.isJsonMode());
      });
    });
}
