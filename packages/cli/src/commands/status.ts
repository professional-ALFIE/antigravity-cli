/**
 * status — Bridge 서버 + 에이전트 상태.
 */

import type { Command } from 'commander';
import type { Helpers } from '../helpers.js';
import { printResult } from '../output.js';

export function register(program: Command, h: Helpers): void {
  program
    .command('status')
    .description('Bridge 서버 + 에이전트 상태')
    .action(async () => {
      await h.run(async () => {
        const client_var = h.getClient();
        const [health_var, userStatus_var] = await Promise.all([
          client_var.get('health'),
          client_var.get('ls/user-status'),
        ]);
        printResult(
          { server: health_var.data, user: userStatus_var.data },
          h.isJsonMode(),
        );
      });
    });
}
