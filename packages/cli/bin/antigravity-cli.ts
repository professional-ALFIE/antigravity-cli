#!/usr/bin/env bun

/**
 * antigravity-cli — Antigravity IDE를 외부에서 제어하는 헤드리스 CLI.
 * 루트 기본 모드는 헤드리스 대화 생성/이어쓰기이며,
 * 유지보수 기능은 src/commands/*.ts 서브커맨드로 등록된다.
 */

import { Command } from 'commander';
import { createHelpers } from '../src/helpers.js';
import { default_model_name_var, formatDocumentedModels_func } from '../src/model-resolver.js';
import { tryHandleRootMode_func } from '../src/root-mode.js';

// ─── 커맨드 모듈 ─────────────────────────────────────
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
  .usage('[options] [message]')
  .description('현재 작업영역 Bridge를 외부에서 제어하는 헤드리스 CLI')
  .version('0.1.0')
  .option('-p, --port <port>', 'Bridge 서버 포트 (자동 탐색 대신 수동 지정)', parseInt)
  .option('--json', 'JSON 형식으로 출력')
  .option('-m, --model <model>', `루트 대화 모드 모델 (기본: ${default_model_name_var})`)
  .option('-r, --resume [id]', '루트 대화 모드: id 없이 목록, id와 메시지를 함께 주면 현재 작업영역 대화에 이어쓰기')
  .option('--async', '루트 대화 모드: 응답 대기 없이 즉시 종료')
  .option('--idle-timeout <ms>', '루트 대화 모드 idle timeout 밀리초 (기본: 10000)')
  .configureHelp({ sortSubcommands: false })
  .addHelpText('after', `
Examples:
  $ antigravity-cli "코드 리뷰해줘"                       새 대화 생성
  $ antigravity-cli --resume                              현재 작업영역 대화 목록
  $ antigravity-cli --resume SESSION_UUID "이어서 진행해"
                                                          기존 대화에 메시지 전송
  $ antigravity-cli --async "빠르게 답해"                 응답 대기 없이 즉시 종료
  $ antigravity-cli "이어서 진행해" --resume SESSION_UUID
                                                          옵션 위치를 바꿔도 동일
  $ antigravity-cli server status                         서버 + 유저 상태
  $ antigravity-cli agent workflow --global                에이전트 글로벌 워크플로우 생성
  $ antigravity-cli commands exec antigravity.getDiagnostics
                                                          내부 명령 직접 실행

Models:
${models_help_var}

Root Mode:
  - 새 대화 / 이어쓰기 모두 백그라운드 UI 반영을 명시 실행합니다
  - 현재 보고 있는 메인 대화 화면은 절대 바꾸지 않습니다
  - 현재 작업영역과 일치하는 Bridge 인스턴스에만 연결합니다
  - --resume 목록도 현재 작업영역 대화만 출력합니다
  - 첫 번째 토큰이 유지보수 서브커맨드가 아니면 메시지로 해석합니다
  - 메시지는 하나의 positional 인자로만 받습니다. 공백이 있으면 반드시 따옴표로 감싸세요
  - exec, resume, --no-wait 는 제거되었습니다
`);

// ─── 커맨드 등록 ─────────────────────────────────────

const helpers_var = createHelpers(program);

registerStepControl(program, helpers_var);
registerServer(program, helpers_var);
registerAgent(program, helpers_var);
registerCommands(program, helpers_var);
registerUi(program, helpers_var);
registerAutoRun(program, helpers_var);

// ─── 파싱 실행 ──────────────────────────────────────

const handled_root_mode_var = await tryHandleRootMode_func(process.argv.slice(2));
if (!handled_root_mode_var) {
  program.parse();
}
