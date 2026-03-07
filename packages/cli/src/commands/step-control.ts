/**
 * accept / reject / run — 스텝 제어 커맨드.
 */

import type { Command } from 'commander';
import type { Helpers } from '../helpers.js';

export function register(program: Command, h: Helpers): void {
  program
    .command('accept')
    .description('대기 중인 스텝 수락')
    .action(async () => {
      await h.run(async () => {
        const client_var = h.getClient();
        const result_var = await client_var.post('cascade/accept-step');
        if (!result_var.success) throw new Error(result_var.error ?? 'accept failed');
        console.log('✓ accepted');
      });
    });

  program
    .command('reject')
    .description('대기 중인 스텝 거부')
    .action(async () => {
      await h.run(async () => {
        const client_var = h.getClient();
        const result_var = await client_var.post('cascade/reject-step');
        if (!result_var.success) throw new Error(result_var.error ?? 'reject failed');
        console.log('✓ rejected');
      });
    });

  program
    .command('run')
    .description('대기 중인 터미널 명령 실행')
    .action(async () => {
      await h.run(async () => {
        const client_var = h.getClient();
        const result_var = await client_var.post('cascade/run-terminal');
        if (!result_var.success) throw new Error(result_var.error ?? 'run failed');
        console.log('✓ running');
      });
    });
}
