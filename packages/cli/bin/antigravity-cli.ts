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
    'Headless CLI to control the current workspace Bridge externally',
    '',
    'Options:',
    '  -m, --model <model>   Set conversation model',
    model_lines_var,
    '  -r, --resume          List sessions',
    '      --resume [uuid]   Resume a session',
    '  -a, --async           Fire-and-forget (exit without waiting for response)',
    '  -j, --json            Output in JSON format',
    '  -p, --port <port>     Manually specify Bridge server port',
    '  -v, --version         output the version number',
    '  -h, --help            display help for command',
    '',
    'Commands:',
    '  server                IDE server management (status/prefs/diag/monitor/state/reload/restart/auto-run)',
    '  agent                 Workflow and rule management',
    '  commands              List / execute internal Antigravity commands',
    '',
    'Examples:',
    '  $ antigravity-cli "review this code"                    Create new conversation',
    '  $ antigravity-cli -r                                    List workspace sessions',
    '  $ antigravity-cli -r SESSION_UUID "continue"            Send message to existing session',
    '  $ antigravity-cli -a "quick analysis"                   Fire-and-forget',
    '  $ antigravity-cli server status                         Server + user status',
    '  $ antigravity-cli server auto-run status                Check auto-run patch status',
    '',
    'Root Mode:',
    '  - New and resumed conversations are explicitly registered in the background UI',
    '  - The main conversation view you are looking at is never changed',
    '  - If no Bridge exists for the current workspace and Antigravity is running, a new workspace window is created minimized and connected',
    '  - --resume list only shows sessions for the current workspace, with full UUIDs',
    '  - Messages must be passed as a single positional argument — use quotes for spaces',
    '  - exec, resume, --no-wait have been removed',
  ].join('\n');
}

program
  .name('antigravity-cli')
  .usage('[options] [message]')
  .description('Headless CLI to control the current workspace Bridge externally')
  .version('0.1.2', '-v, --version')
  .option('-p, --port <port>', 'Manually specify Bridge server port', parseInt)
  .option('-j, --json', 'Output in JSON format')
  .option('-m, --model <model>', 'Set conversation model')
  .option('-r, --resume [id]', 'List sessions / resume')
  .option('-a, --async', 'Fire-and-forget (exit without waiting)')
  .addOption(new Option('--idle-timeout <ms>', 'Root conversation mode idle timeout in ms (default: 10000)').hideHelp());

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
