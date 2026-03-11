/**
 * ui — Agent View UI 관리 (서브커맨드: install).
 */

import type { Command } from 'commander';
import type { Helpers } from '../helpers.js';

export function register(program: Command, h: Helpers): void {
  const uiCmd_var = program
    .command('ui', { hidden: true })
    .description('Agent View UI management');

  uiCmd_var
    .command('install')
    .description('Install registered UI elements')
    .action(async () => {
      await h.run(async () => {
        const client_var = await h.getClient();
        const result_var = await client_var.post('integration/install');
        if (!result_var.success) throw new Error(result_var.error ?? 'install failed');
        console.log('✓ installed');
      });
    });
}
