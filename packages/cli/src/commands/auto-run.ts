/**
 * auto-run — Always Proceed 패치 관리.
 */

import type { Command } from 'commander';
import type { Helpers } from '../helpers.js';

export function register(program: Command, h: Helpers): void {
  const auto_run = program
    .command('auto-run')
    .description('Always Proceed auto-run 패치 관리');

  // --- status ---
  auto_run
    .command('status')
    .description('패치 적용 상태 확인')
    .action(async () => {
      await h.run(async () => {
        const client_var = h.getClient();
        const result_var = await client_var.get('auto-run/status');
        const { dir, files } = result_var.data as {
          dir: string | null;
          files: Array<{ label: string; patched: boolean }>;
        };

        if (h.isJsonMode()) {
          console.log(JSON.stringify(result_var.data, null, 2));
          return;
        }

        if (!dir) {
          console.log('✗ Antigravity workbench 디렉토리를 찾을 수 없습니다');
          return;
        }

        console.log(`Dir: ${dir}\n`);

        for (const f of files) {
          const icon_var = f.patched ? '◉' : '◯';
          const status_var = f.patched ? 'patched' : 'not patched';
          console.log(`  ${icon_var} ${f.label}: ${status_var}`);
        }

        if (files.length === 0) {
          console.log('패치 대상 파일 없음');
        }
      });
    });

  // --- revert ---
  auto_run
    .command('revert')
    .description('패치 원본 복원 (.ba-backup에서)')
    .action(async () => {
      await h.run(async () => {
        const client_var = h.getClient();
        const result_var = await client_var.post('auto-run/revert', {});

        if (h.isJsonMode()) {
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
          } else {
            console.log(`✗ ${r.label}: ${r.error ?? r.status}`);
          }
        }

        console.log('\n⚠ IDE를 재시작해야 변경이 적용됩니다 (Reload Window)');
      });
    });

  // --- apply ---
  auto_run
    .command('apply')
    .description('수동으로 패치 적용')
    .action(async () => {
      await h.run(async () => {
        const client_var = h.getClient();
        const result_var = await client_var.post('auto-run/apply', {});

        if (h.isJsonMode()) {
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
          } else {
            console.log(`✗ ${r.label}: ${r.error ?? r.status}`);
          }
        }

        console.log('\n⚠ IDE를 재시작해야 변경이 적용됩니다 (Reload Window)');
      });
    });
}
