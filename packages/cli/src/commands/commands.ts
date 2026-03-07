/**
 * commands — Antigravity 내부 명령어 관리 (서브커맨드: list, exec).
 */

import type { Command } from 'commander';
import type { Helpers } from '../helpers.js';
import { printResult } from '../output.js';

export function register(program: Command, h: Helpers): void {
  const commandsCmd_var = program
    .command('commands')
    .description('Antigravity 내부 명령어 관리');

  commandsCmd_var
    .command('list')
    .description('등록된 명령 목록')
    .action(async () => {
      await h.run(async () => {
        const client_var = h.getClient();
        const result_var = await client_var.get('commands/list');
        if (!result_var.success) throw new Error(result_var.error ?? 'list failed');
        printResult(result_var.data, h.isJsonMode());
      });
    });

  commandsCmd_var
    .command('exec <cmd> [args...]')
    .description('명령 실행')
    .action(async (cmd: string, args: string[]) => {
      await h.run(async () => {
        const client_var = h.getClient();
        const result_var = await client_var.post('commands/exec', { command: cmd, args });
        if (!result_var.success) throw new Error(result_var.error ?? 'exec failed');
        printResult(result_var.data, h.isJsonMode());
      });
    });
}
