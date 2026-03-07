/**
 * monitor — 실시간 이벤트 스트림 (SSE).
 */

import type { Command } from 'commander';
import type { Helpers } from '../helpers.js';

export function register(program: Command, h: Helpers): void {
  program
    .command('monitor')
    .description('실시간 이벤트 스트림 (Ctrl+C로 종료)')
    .action(async () => {
      await h.run(async () => {
        const client_var = h.getClient();
        console.log('◉ Monitoring... (Ctrl+C to stop)\n');

        await client_var.stream('monitor/events', (eventName, data) => {
          const timestamp_var = new Date().toLocaleTimeString();
          console.log(`[${timestamp_var}] ${eventName}:`, JSON.stringify(data));
        });
      });
    });
}
