/**
 * auto-run — Always Proceed 패치 관리.
 */

import type { Command } from 'commander';
import type { Helpers } from '../helpers.js';

function buildAutoRunHelp_func(): string {
  return [
    'Usage: antigravity-cli server auto-run [options] [command]',
    '',
    'Always Proceed auto-run patch management',
    '',
    'Options:',
    '  -h, --help           display help for command',
    '',
    'Commands:',
    '  status               Check patch status',
    '  apply                Manually apply patch',
    '  revert               Restore original from .ba-backup',
    '  help [command]       display help for command',
  ].join('\n');
}

export function registerUnder_func(parent_var: Command, h_var: Helpers): void {
  const auto_run_var = parent_var
    .command('auto-run')
    .description('Always Proceed auto-run patch management');

  auto_run_var.helpInformation = function helpInformation_func(): string {
    return buildAutoRunHelp_func();
  };

  // --- status ---
  auto_run_var
    .command('status')
    .description('Check patch status')
    .action(async () => {
      await h_var.run(async () => {
        const client_var = await h_var.getClient();
        const result_var = await client_var.get('auto-run/status');
        const { dir, files } = result_var.data as {
          dir: string | null;
          files: Array<{ label: string; state: 'patched' | 'unpatched' | 'patch-corrupted'; patched: boolean }>;
        };

        if (h_var.isJsonMode()) {
          console.log(JSON.stringify(result_var.data, null, 2));
          return;
        }

        if (!dir) {
          console.log('✗ Antigravity workbench directory not found');
          return;
        }

        console.log(`Dir: ${dir}\n`);

        for (const f of files) {
          const icon_var = f.state === 'patched'
            ? '◉'
            : f.state === 'patch-corrupted'
              ? '⚠'
              : '◯';
          const status_var = f.state === 'patched'
            ? 'patched'
            : f.state === 'patch-corrupted'
              ? 'corrupted'
              : 'not patched';
          console.log(`  ${icon_var} ${f.label}: ${status_var}`);
        }

        if (files.length === 0) {
          console.log('No patchable files found');
        }
      });
    });

  // --- apply ---
  auto_run_var
    .command('apply')
    .description('Manually apply patch')
    .action(async () => {
      await h_var.run(async () => {
        const client_var = await h_var.getClient();
        const result_var = await client_var.post('auto-run/apply', {});

        if (h_var.isJsonMode()) {
          console.log(JSON.stringify(result_var.data, null, 2));
          return;
        }

        const results_var = result_var.data as Array<{
          success: boolean;
          label: string;
          status: string;
          bytesAdded?: number;
          error?: string;
        }>;

        if (results_var.length === 0) {
          console.log('No patchable files found');
          return;
        }

        for (const r of results_var) {
          if (r.status === 'patched') {
            console.log(`✓ ${r.label}: patch applied (+${r.bytesAdded}b)`);
          } else if (r.status === 'already-patched') {
            console.log(`  ${r.label}: already patched`);
          } else if (r.status === 'patch-corrupted') {
            console.log(`⚠ ${r.label}: patch structure corrupted (${r.error ?? 'revert first'})`);
          } else {
            console.log(`✗ ${r.label}: ${r.error ?? r.status}`);
          }
        }

        console.log('\n⚠ Restart the IDE for changes to take effect (Reload Window)');
      });
    });

  // --- revert ---
  auto_run_var
    .command('revert')
    .description('Restore original from .ba-backup')
    .action(async () => {
      await h_var.run(async () => {
        const client_var = await h_var.getClient();
        const result_var = await client_var.post('auto-run/revert', {});

        if (h_var.isJsonMode()) {
          console.log(JSON.stringify(result_var.data, null, 2));
          return;
        }

        const results_var = result_var.data as Array<{
          success: boolean;
          label: string;
          status: string;
          error?: string;
        }>;

        if (results_var.length === 0) {
          console.log('No files to restore');
          return;
        }

        for (const r of results_var) {
          if (r.status === 'reverted') {
            console.log(`✓ ${r.label}: original restored`);
          } else if (r.status === 'no-backup') {
            console.log(`  ${r.label}: no backup file`);
          } else if (r.status === 'patch-corrupted') {
            console.log(`⚠ ${r.label}: patch structure corrupted (${r.error ?? 'revert first'})`);
          } else {
            console.log(`✗ ${r.label}: ${r.error ?? r.status}`);
          }
        }

        console.log('\n⚠ Restart the IDE for changes to take effect (Reload Window)');
      });
    });
}
