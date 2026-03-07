#!/usr/bin/env bun

/**
 * antigravity-cli — Antigravity IDE를 외부에서 제어하는 헤드리스 CLI.
 * 각 커맨드는 src/commands/*.ts에서 등록된다.
 */

import { Command } from 'commander';
import { createHelpers } from '../src/helpers.js';

// ─── 커맨드 모듈 ─────────────────────────────────────
import { register as registerExec } from '../src/commands/exec.js';
import { register as registerList } from '../src/commands/list.js';
import { register as registerFocus } from '../src/commands/focus.js';
import { register as registerStepControl } from '../src/commands/step-control.js';
import { register as registerStatus } from '../src/commands/status.js';
import { register as registerMonitor } from '../src/commands/monitor.js';
import { register as registerPrefs } from '../src/commands/prefs.js';
import { register as registerDiag } from '../src/commands/diag.js';
import { register as registerCommands } from '../src/commands/commands.js';
import { register as registerState } from '../src/commands/state.js';
import { register as registerUi } from '../src/commands/ui.js';
import { register as registerAutoRun } from '../src/commands/auto-run.js';

// ─── program 정의 ────────────────────────────────────

const program = new Command();

program
  .name('antigravity-cli')
  .description('Antigravity IDE를 외부에서 제어하는 헤드리스 CLI')
  .version('0.1.0')
  .option('-p, --port <port>', 'Bridge 서버 포트 (자동 탐색 대신 수동 지정)', parseInt)
  .option('--json', 'JSON 형식으로 출력')
  .configureHelp({ sortSubcommands: false })
  .addHelpText('after', `
Examples:
  $ antigravity-cli exec "코드 리뷰해줘"                  새 Cascade 생성
  $ antigravity-cli exec "이어서" -r <id> -m pro          기존 Cascade에 메시지 전송
  $ antigravity-cli list                                  대화 목록 조회
  $ antigravity-cli status                                서버 + 유저 상태
  $ antigravity-cli accept                                대기 중 스텝 수락
  $ antigravity-cli monitor                               실시간 이벤트 스트림

Models:
  flash, pro, pro-high, sonnet, opus (기본), gpt
`);

// ─── 커맨드 등록 ─────────────────────────────────────

const helpers_var = createHelpers(program);

registerExec(program, helpers_var);
registerList(program, helpers_var);
registerFocus(program, helpers_var);
registerStepControl(program, helpers_var);
registerStatus(program, helpers_var);
registerMonitor(program, helpers_var);
registerPrefs(program, helpers_var);
registerDiag(program, helpers_var);
registerCommands(program, helpers_var);
registerState(program, helpers_var);
registerUi(program, helpers_var);
registerAutoRun(program, helpers_var);

// ─── 파싱 실행 ──────────────────────────────────────

program.parse();
