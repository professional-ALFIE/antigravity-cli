#!/usr/bin/env bun

/**
 * antigravity-cli — Antigravity IDE를 외부에서 제어하는 헤드리스 CLI.
 * 각 커맨드는 src/commands/*.ts에서 등록된다.
 */

import { Command } from 'commander';
import { createHelpers } from '../src/helpers.js';
import { default_model_name_var, formatDocumentedModels_func } from '../src/model-resolver.js';

// ─── 커맨드 모듈 ─────────────────────────────────────
import { register as registerExec } from '../src/commands/exec.js';
import { register as registerResume } from '../src/commands/resume.js';
import { register as registerStepControl } from '../src/commands/step-control.js';
import { register as registerServer } from '../src/commands/server.js';
import { register as registerAgent } from '../src/commands/agent.js';
import { register as registerCommands } from '../src/commands/commands.js';
import { register as registerUi } from '../src/commands/ui.js';
import { register as registerAutoRun } from '../src/commands/auto-run.js';

// ─── program 정의 ────────────────────────────────────

const program = new Command();
const models_help_var = formatDocumentedModels_func();

program
  .name('antigravity-cli')
  .description('Antigravity IDE를 외부에서 제어하는 헤드리스 CLI')
  .version('0.1.0')
  .option('-p, --port <port>', 'Bridge 서버 포트 (자동 탐색 대신 수동 지정)', parseInt)
  .option('--json', 'JSON 형식으로 출력')
  .configureHelp({ sortSubcommands: false })
  .addHelpText('after', `
Examples:
  $ antigravity-cli exec "코드 리뷰해줘"                  새 대화 생성
  $ antigravity-cli exec "이어서" -r <id> -m ${default_model_name_var}  기존 대화에 메시지 전송
  $ antigravity-cli resume                                대화 목록
  $ antigravity-cli resume <id>                           특정 대화로 전환
  $ antigravity-cli server status                         서버 + 유저 상태
  $ antigravity-cli agent workflow --global                에이전트 글로벌 워크플로우 생성
  $ antigravity-cli commands exec antigravity.setVisibleConversation <id>
                                                          내부 명령 직접 실행

Models:
${models_help_var}

Current Behavior:
  - resume <id>     현재는 "이어쓰기"가 아니라 해당 대화를 UI에 표시
  - exec -r <id>    기존 대화에 실제로 메시지 이어서 전송
  - exec --no-wait  대화 생성/전송 후 응답 본문을 기다리지 않고 즉시 종료
`);

// ─── 커맨드 등록 ─────────────────────────────────────

const helpers_var = createHelpers(program);

registerExec(program, helpers_var);
registerResume(program, helpers_var);
registerStepControl(program, helpers_var);
registerServer(program, helpers_var);
registerAgent(program, helpers_var);
registerCommands(program, helpers_var);
registerUi(program, helpers_var);
registerAutoRun(program, helpers_var);

// ─── 파싱 실행 ──────────────────────────────────────

program.parse();
