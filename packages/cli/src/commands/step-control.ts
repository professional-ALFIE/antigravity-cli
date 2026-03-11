/**
 * accept / reject / run — 스텝 제어 커맨드.
 */

import type { Command } from 'commander';
import type { Helpers } from '../helpers.js';

export function register(program: Command, h: Helpers): void {
  program
    .command('accept', { hidden: true })
    .description('Accept pending step')
    .action(async () => {
      await h.run(async () => {
        const client_var = await h.getClient();
        const result_var = await client_var.post('cascade/accept-step');
        if (!result_var.success) throw new Error(result_var.error ?? 'accept failed');
        console.log('✓ accepted');
      });
    });

  program
    .command('reject', { hidden: true })
    .description('Reject pending step')
    .action(async () => {
      await h.run(async () => {
        const client_var = await h.getClient();
        const result_var = await client_var.post('cascade/reject-step');
        if (!result_var.success) throw new Error(result_var.error ?? 'reject failed');
        console.log('✓ rejected');
      });
    });

  program
    .command('run', { hidden: true })
    .description('Run pending terminal command')
    .action(async () => {
      await h.run(async () => {
        const client_var = await h.getClient();
        const result_var = await client_var.post('cascade/run-terminal');
        if (!result_var.success) throw new Error(result_var.error ?? 'run failed');
        console.log('✓ running');
      });
    });
}
