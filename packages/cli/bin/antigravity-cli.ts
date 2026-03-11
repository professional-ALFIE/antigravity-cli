#!/usr/bin/env bun

/**
 * antigravity-cli — Antigravity IDE를 외부에서 제어하는 헤드리스 CLI.
 * 루트 기본 모드는 헤드리스 대화 생성/이어쓰기이며,
 * 유지보수 기능은 src/commands/*.ts 서브커맨드로 등록된다.
 */

import { Command, Option } from 'commander';
import { createHelpers } from '../src/helpers.js';
import { documented_models_var } from '../src/model-resolver.js';
import { tryHandleRootMode_func } from '../src/root-mode.js';

// ─── 커맨드 모듈 ─────────────────────────────────────
import { register as registerStepControl } from '../src/commands/step-control.js';
import { register as registerServer } from '../src/commands/server.js';
import { register as registerAgent } from '../src/commands/agent.js';
import { register as registerCommands } from '../src/commands/commands.js';
import { register as registerUi } from '../src/commands/ui.js';

// ─── program 정의 ────────────────────────────────────

const program = new Command();

function buildModelHelpLines_func(): string {
  return documented_models_var
    .map((model_var, index_var) => (
      `                        ${model_var.cliName}${index_var === 0 ? ' (default)' : ''}`
    ))
    .join('\n');
}

function buildRootHelp_func(): string {
  const model_lines_var = buildModelHelpLines_func();

  return [
    'Usage: antigravity-cli [options] [message]',
    '',
    '현재 작업영역 Bridge를 외부에서 제어하는 헤드리스 CLI',
    '',
    'Options:',
    '  -m, --model <model>   대화 모델 설정',
    model_lines_var,
    '  -r, --resume          세션 조회',
    '      --resume [uuid]   해당 세션에 이어쓰기',
    '  -a, --async           응답 대기 없이 지시 후 즉시 종료',
    '  -j, --json            JSON 형식으로 출력',
    '  -p, --port <port>     Bridge 서버 포트 수동 지정',
    '  -v, --version         output the version number',
    '  -h, --help            display help for command',
    '',
    'Commands:',
    '  server                IDE 서버 관리 (status/prefs/diag/monitor/state/reload/restart/auto-run)',
    '  agent                 워크플로우/규칙 관리',
    '  commands              Antigravity 내부 명령어 조회/직접 실행',
    '',
    'Examples:',
    '  $ antigravity-cli "코드 리뷰해줘"                       새 대화 생성',
    '  $ antigravity-cli -r                                   현재 작업영역 대화 목록',
    '  $ antigravity-cli -r SESSION_UUID "이어서 진행해"       기존 대화에 메시지 전송',
    '  $ antigravity-cli -a "빠르게 답해"                      응답 대기 없이 즉시 종료',
    '  $ antigravity-cli server status                        서버 + 유저 상태',
    '  $ antigravity-cli server auto-run status               auto-run 패치 상태 확인',
    '',
    'Root Mode:',
    '  - 새 대화 / 이어쓰기 모두 백그라운드 UI 반영을 명시 실행합니다',
    '  - 현재 보고 있는 메인 대화 화면은 절대 바꾸지 않습니다',
    '  - 현재 작업영역 Bridge가 없고 Antigravity가 이미 실행 중이면, 새 작업영역 창만 생성 직후 최소화한 뒤 연결합니다',
    '  - --resume 목록도 현재 작업영역 대화만, 전체 UUID로 출력합니다',
    '  - 메시지는 하나의 positional 인자로만 받습니다. 공백이 있으면 반드시 따옴표로 감싸세요',
    '  - exec, resume, --no-wait 는 제거되었습니다',
  ].join('\n');
}

program
  .name('antigravity-cli')
  .usage('[options] [message]')
  .description('현재 작업영역 Bridge를 외부에서 제어하는 헤드리스 CLI')
  .version('0.1.1', '-v, --version')
  .option('-p, --port <port>', 'Bridge 서버 포트 수동 지정', parseInt)
  .option('-j, --json', 'JSON 형식으로 출력')
  .option('-m, --model <model>', '대화 모델 설정')
  .option('-r, --resume [id]', '세션 조회 / 이어쓰기')
  .option('-a, --async', '응답 대기 없이 지시 후 즉시 종료')
  .addOption(new Option('--idle-timeout <ms>', '루트 대화 모드 idle timeout 밀리초 (기본: 10000)').hideHelp());

program.helpInformation = function helpInformation_func(): string {
  return buildRootHelp_func();
};

// ─── 커맨드 등록 ─────────────────────────────────────

const helpers_var = createHelpers(program);

registerStepControl(program, helpers_var);
registerServer(program, helpers_var);
registerAgent(program, helpers_var);
registerCommands(program, helpers_var);
registerUi(program, helpers_var);

// ─── 파싱 실행 ──────────────────────────────────────

const handled_root_mode_var = await tryHandleRootMode_func(process.argv.slice(2));
if (!handled_root_mode_var) {
  program.parse();
}
