/**
 * server — IDE 서버 관리 (서브커맨드: status, prefs, diag, monitor, state, reload, restart).
 *
 * 기존 최상위 명령 status/prefs/diag/monitor/state를 하나의
 * `server` 커맨드 아래 서브커맨드로 통합 + reload/restart 추가.
 */

import type { Command } from 'commander';
import type { Helpers } from '../helpers.js';
import { printResult } from '../output.js';
import { c } from '../colors.js';

export function register(program: Command, h: Helpers): void {
  const serverCmd_var = program
    .command('server')
    .description('IDE 서버 관리 (status/prefs/diag/monitor/state/reload/restart)');

  // ── status ──────────────────────────────────────
  serverCmd_var
    .command('status')
    .description('서버 연결 + 유저 상태')
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

  // ── prefs ───────────────────────────────────────
  serverCmd_var
    .command('prefs')
    .description('에이전트 설정 조회')
    .action(async () => {
      await h.run(async () => {
        const client_var = h.getClient();
        const result_var = await client_var.get('cascade/preferences');
        if (!result_var.success) throw new Error(result_var.error ?? 'prefs failed');
        printResult(result_var.data, h.isJsonMode());
      });
    });

  // ── diag ────────────────────────────────────────
  serverCmd_var
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

  // ── monitor ─────────────────────────────────────
  serverCmd_var
    .command('monitor')
    .description('실시간 이벤트 스트림 (Ctrl+C로 종료)')
    .action(async () => {
      await h.run(async () => {
        const client_var = h.getClient();
        console.log('◉ Monitoring... (Ctrl+C to stop)\n');

        await client_var.stream('monitor/events', (eventName_var, data_var) => {
          const timestamp_var = new Date().toLocaleTimeString();
          console.log(`[${timestamp_var}] ${eventName_var}:`, JSON.stringify(data_var));
        });
      });
    });

  // ── state ───────────────────────────────────────
  serverCmd_var
    .command('state [key]')
    .description('내부 저장소 조회')
    .action(async (key_var?: string) => {
      await h.run(async () => {
        const client_var = h.getClient();
        const path_var = key_var ? `state/${key_var}` : 'state';
        const result_var = await client_var.get(path_var);
        if (!result_var.success) throw new Error(result_var.error ?? 'state failed');
        printResult(result_var.data, h.isJsonMode());
      });
    });

  // ── reload ──────────────────────────────────────
  serverCmd_var
    .command('reload')
    .description('IDE 창 리로드')
    .action(async () => {
      await h.run(async () => {
        const client_var = h.getClient();
        const result_var = await client_var.post('commands/exec', {
          command: 'antigravity.reloadWindow',
          args: [],
        });
        if (!result_var.success) throw new Error(result_var.error ?? 'reload failed');
        console.log(c.green('✓') + ' IDE 리로드 요청 전송됨');
      });
    });

  // ── restart ─────────────────────────────────────
  serverCmd_var
    .command('restart')
    .description('언어 서버 재시작')
    .action(async () => {
      await h.run(async () => {
        const client_var = h.getClient();
        const result_var = await client_var.post('commands/exec', {
          command: 'antigravity.restartLanguageServer',
          args: [],
        });
        if (!result_var.success) throw new Error(result_var.error ?? 'restart failed');
        console.log(c.green('✓') + ' 언어 서버 재시작 요청 전송됨');
      });
    });
}
