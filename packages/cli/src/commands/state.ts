/**
 * state — USS 상태 조회.
 */

import type { Command } from 'commander';
import type { Helpers } from '../helpers.js';
import { printResult } from '../output.js';

export function register(program: Command, h: Helpers): void {
  program
    .command('state [key]')
    .description('USS 상태 조회')
    .action(async (key?: string) => {
      await h.run(async () => {
        const client_var = h.getClient();
        const path_var = key ? `state/${key}` : 'state';
        const result_var = await client_var.get(path_var);
        if (!result_var.success) throw new Error(result_var.error ?? 'state failed');
        printResult(result_var.data, h.isJsonMode());
      });
    });
}
