/**
 * auto-run — Always Proceed 패치 관리.
 */

import type { Command } from 'commander';
import type { Helpers } from '../helpers.js';

function buildAutoRunHelp_func(): string {
  return [
    'Usage: antigravity-cli server auto-run [options] [command]',
    '',
    'Always Proceed auto-run 패치 관리',
    '',
    'Options:',
    '  -h, --help           display help for command',
    '',
    'Commands:',
    '  status               패치 적용 상태 확인',
    '  apply                수동으로 패치 적용',
    '  revert               패치 원본 복원 (.ba-backup에서)',
    '  help [command]       display help for command',
  ].join('\n');
}

export function registerUnder_func(parent_var: Command, h_var: Helpers): void {
  const auto_run_var = parent_var
    .command('auto-run')
    .description('Always Proceed auto-run 패치 관리');

  auto_run_var.helpInformation = function helpInformation_func(): string {
    return buildAutoRunHelp_func();
  };

  // --- status ---
  auto_run_var
    .command('status')
    .description('패치 적용 상태 확인')
    .action(async () => {
      await h_var.run(async () => {
        const client_var = h_var.getClient();
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
          console.log('✗ Antigravity workbench 디렉토리를 찾을 수 없습니다');
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
          console.log('패치 대상 파일 없음');
        }
      });
    });

  // --- apply ---
  auto_run_var
    .command('apply')
    .description('수동으로 패치 적용')
    .action(async () => {
      await h_var.run(async () => {
        const client_var = h_var.getClient();
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
          console.log('패치 대상 파일이 없습니다');
          return;
        }

        for (const r of results_var) {
          if (r.status === 'patched') {
            console.log(`✓ ${r.label}: 패치 적용 (+${r.bytesAdded}b)`);
          } else if (r.status === 'already-patched') {
            console.log(`  ${r.label}: 이미 패치됨`);
          } else if (r.status === 'patch-corrupted') {
            console.log(`⚠ ${r.label}: 패치 구조 손상됨 (${r.error ?? 'revert 먼저 필요'})`);
          } else {
            console.log(`✗ ${r.label}: ${r.error ?? r.status}`);
          }
        }

        console.log('\n⚠ IDE를 재시작해야 변경이 적용됩니다 (Reload Window)');
      });
    });

  // --- revert ---
  auto_run_var
    .command('revert')
    .description('패치 원본 복원 (.ba-backup에서)')
    .action(async () => {
      await h_var.run(async () => {
        const client_var = h_var.getClient();
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
          console.log('복원할 파일이 없습니다');
          return;
        }

        for (const r of results_var) {
          if (r.status === 'reverted') {
            console.log(`✓ ${r.label}: 원본 복원 완료`);
          } else if (r.status === 'no-backup') {
            console.log(`  ${r.label}: 백업 파일 없음`);
          } else if (r.status === 'patch-corrupted') {
            console.log(`⚠ ${r.label}: 패치 구조 손상됨 (${r.error ?? 'revert 먼저 필요'})`);
          } else {
            console.log(`✗ ${r.label}: ${r.error ?? r.status}`);
          }
        }

        console.log('\n⚠ IDE를 재시작해야 변경이 적용됩니다 (Reload Window)');
      });
    });
}
