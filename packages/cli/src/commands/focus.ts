/**
 * focus — Cascade를 UI에 표시.
 */

import type { Command } from 'commander';
import type { Helpers } from '../helpers.js';

export function register(program: Command, h: Helpers): void {
  program
    .command('focus <id>')
    .description('Cascade를 UI에 표시')
    .action(async (id: string) => {
      await h.run(async () => {
        const client_var = h.getClient();
        const result_var = await client_var.post(`ls/focus/${id}`);
        if (!result_var.success) throw new Error(result_var.error ?? 'focus failed');
        console.log('✓ focused');
      });
    });
}
