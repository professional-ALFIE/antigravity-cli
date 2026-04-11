#!/usr/bin/env bun
/**
 * Antigravity CLI — 진입점
 *
 * package.json의 bin 필드에서 참조됨.
 * 실제 로직은 main.ts에 위임.
 * plan Phase 10: L313~328 참조.
 */

import {
  main,
  emitJsonError_func,
  extractJsonLifecycleSessionId_func,
  formatFatalErrorForStderr_func,
} from '../main.js';

const is_json_mode_var = process.argv.includes('--json') || process.argv.includes('-j');

main(process.argv.slice(2)).catch((error_var) => {
  const message_var = formatFatalErrorForStderr_func(error_var);
  console.error(message_var);
  if (is_json_mode_var) {
    emitJsonError_func(
      error_var instanceof Error ? error_var.message : String(error_var),
      extractJsonLifecycleSessionId_func(error_var),
    );
  }
  process.exitCode = 1;
});
