/**
 * diag — 시스템 진단 정보.
 */

import type { Command } from 'commander';
import type { Helpers } from '../helpers.js';
import { printResult } from '../output.js';

export function register(program: Command, h: Helpers): void {
  program
    .command('diag')
    .description('시스템 진단 정보')
    .action(async () => {
      await h.run(async () => {
        const client_var = h.getClient();
        const result_var = await client_var.get('cascade/diagnostics');
        if (!result_var.success) throw new Error(result_var.error ?? 'diag failed');
        printResult(result_var.data, h.isJsonMode());
      });
    });
}
