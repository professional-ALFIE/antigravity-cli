#!/usr/bin/env bun
/**
 * Antigravity CLI — 진입점
 *
 * package.json의 bin 필드에서 참조됨.
 * 실제 로직은 main.ts에 위임.
 * plan Phase 10: L313~328 참조.
 */

import { main } from '../main.js';

main(process.argv.slice(2)).catch((error_var) => {
  console.error(
    error_var instanceof Error
      ? error_var.stack ?? error_var.message
      : String(error_var),
  );
  process.exitCode = 1;
});
