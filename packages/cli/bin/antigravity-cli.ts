#!/usr/bin/env bun

import { Command } from 'commander';
import { discoverInstance } from '../src/discovery.js';
import { BridgeClient } from '../src/client.js';
import { printResult, printError } from '../src/output.js';

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

// ─── 헬퍼 ────────────────────────────────────────────

/** 글로벌 옵션에서 BridgeClient를 생성한다. */
function getClient(): BridgeClient {
  const opts = program.opts();
  const instance = discoverInstance(opts.port as number | undefined);
  return new BridgeClient(instance.port);
}

function isJsonMode(): boolean {
  return Boolean(program.opts().json);
}

/** 공통 에러 핸들링 래퍼 */
async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// ─── exec (핵심 — 헤드리스 Cascade) ─────────────────

// 모델 이름→ID 매핑 (SDK Models enum과 동일)
const MODEL_MAP: Record<string, number> = {
  flash: 1018,
  pro: 1164,
  'pro-high': 1165,
  sonnet: 1163,
  opus: 1154,
  gpt: 342,
};

function resolveModel(name_var?: string): number {
  if (!name_var) return MODEL_MAP.opus; // 기본값: opus
  if (MODEL_MAP[name_var]) return MODEL_MAP[name_var];
  const num_var = parseInt(name_var, 10);
  if (!isNaN(num_var)) return num_var; // 숫자 직접 지정도 허용
  throw new Error(`알 수 없는 모델: "${name_var}". 사용 가능: ${Object.keys(MODEL_MAP).join(', ')}`);
}

program
  .command('exec <message>')
  .description('헤드리스 Cascade 생성 후 메시지 전송')
  .option('-m, --model <model>', '사용할 모델 (기본: opus)', 'opus')
  .option('-r, --resume <id>', '기존 Cascade에 이어서 전송')
  .addHelpText('after', `
Arguments:
  message                   Cascade에 보낼 프롬프트 텍스트

Examples:
  $ antigravity-cli exec "이 프로젝트 분석해줘"
  $ antigravity-cli exec "테스트 작성해" -m pro
  $ antigravity-cli exec "이어서 진행" -r <cascade-id>
  $ antigravity-cli exec "결과 알려줘" --json

Models:
  flash       Gemini Flash (빠름)
  pro         Gemini Pro
  pro-high    Gemini Pro High (고품질)
  sonnet      Claude Sonnet
  opus        Claude Opus (기본)
  gpt         GPT OSS
`)
  .action(async (message: string, opts: { model?: string; resume?: string }) => {
    await run(async () => {
      const client = getClient();
      const model_id = resolveModel(opts.model);

      if (opts.resume) {
        // 기존 cascade에 메시지 전송
        const result = await client.post(`ls/send/${opts.resume}`, {
          text: message,
          model: model_id,
        });
        if (!result.success) throw new Error(result.error ?? 'send failed');
        printResult(result.data, isJsonMode());
      } else {
        // 새 cascade 생성
        const result = await client.post('ls/create', {
          text: message,
          model: model_id,
        });
        if (!result.success) throw new Error(result.error ?? 'create failed');
        printResult(result.data, isJsonMode());
      }
    });
  });

// ─── list ───────────────────────────────────────────

program
  .command('list')
  .description('Cascade 목록 조회')
  .action(async () => {
    await run(async () => {
      const client = getClient();
      const result = await client.get('ls/list');
      if (!result.success) throw new Error(result.error ?? 'list failed');
      printResult(result.data, isJsonMode());
    });
  });

// ─── focus ──────────────────────────────────────────

program
  .command('focus <id>')
  .description('Cascade를 UI에 표시')
  .action(async (id: string) => {
    await run(async () => {
      const client = getClient();
      const result = await client.post(`ls/focus/${id}`);
      if (!result.success) throw new Error(result.error ?? 'focus failed');
      console.log('✓ focused');
    });
  });

// ─── accept / reject / run (스텝 제어) ──────────────

program
  .command('accept')
  .description('대기 중인 스텝 수락')
  .action(async () => {
    await run(async () => {
      const client = getClient();
      const result = await client.post('cascade/accept-step');
      if (!result.success) throw new Error(result.error ?? 'accept failed');
      console.log('✓ accepted');
    });
  });

program
  .command('reject')
  .description('대기 중인 스텝 거부')
  .action(async () => {
    await run(async () => {
      const client = getClient();
      const result = await client.post('cascade/reject-step');
      if (!result.success) throw new Error(result.error ?? 'reject failed');
      console.log('✓ rejected');
    });
  });

program
  .command('run')
  .description('대기 중인 터미널 명령 실행')
  .action(async () => {
    await run(async () => {
      const client = getClient();
      const result = await client.post('cascade/run-terminal');
      if (!result.success) throw new Error(result.error ?? 'run failed');
      console.log('✓ running');
    });
  });

// ─── status ─────────────────────────────────────────

program
  .command('status')
  .description('Bridge 서버 + 에이전트 상태')
  .action(async () => {
    await run(async () => {
      const client = getClient();
      const [health, userStatus] = await Promise.all([
        client.get('health'),
        client.get('ls/user-status'),
      ]);
      printResult(
        { server: health.data, user: userStatus.data },
        isJsonMode(),
      );
    });
  });

// ─── monitor (SSE) ──────────────────────────────────

program
  .command('monitor')
  .description('실시간 이벤트 스트림 (Ctrl+C로 종료)')
  .action(async () => {
    await run(async () => {
      const client = getClient();
      console.log('◉ Monitoring... (Ctrl+C to stop)\n');

      await client.stream('monitor/events', (eventName, data) => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] ${eventName}:`, JSON.stringify(data));
      });
    });
  });

// ─── prefs ──────────────────────────────────────────

program
  .command('prefs')
  .description('에이전트 설정 조회')
  .action(async () => {
    await run(async () => {
      const client = getClient();
      const result = await client.get('cascade/preferences');
      if (!result.success) throw new Error(result.error ?? 'prefs failed');
      printResult(result.data, isJsonMode());
    });
  });

// ─── diag ───────────────────────────────────────────

program
  .command('diag')
  .description('시스템 진단 정보')
  .action(async () => {
    await run(async () => {
      const client = getClient();
      const result = await client.get('cascade/diagnostics');
      if (!result.success) throw new Error(result.error ?? 'diag failed');
      printResult(result.data, isJsonMode());
    });
  });

// ─── commands (서브커맨드) ───────────────────────────

const commandsCmd = program
  .command('commands')
  .description('Antigravity 내부 명령어 관리');

commandsCmd
  .command('list')
  .description('등록된 명령 목록')
  .action(async () => {
    await run(async () => {
      const client = getClient();
      const result = await client.get('commands/list');
      if (!result.success) throw new Error(result.error ?? 'list failed');
      printResult(result.data, isJsonMode());
    });
  });

commandsCmd
  .command('exec <cmd> [args...]')
  .description('명령 실행')
  .action(async (cmd: string, args: string[]) => {
    await run(async () => {
      const client = getClient();
      const result = await client.post('commands/exec', { command: cmd, args });
      if (!result.success) throw new Error(result.error ?? 'exec failed');
      printResult(result.data, isJsonMode());
    });
  });

// ─── state ──────────────────────────────────────────

program
  .command('state [key]')
  .description('USS 상태 조회')
  .action(async (key?: string) => {
    await run(async () => {
      const client = getClient();
      const path = key ? `state/${key}` : 'state';
      const result = await client.get(path);
      if (!result.success) throw new Error(result.error ?? 'state failed');
      printResult(result.data, isJsonMode());
    });
  });

// ─── ui ─────────────────────────────────────────────

const uiCmd = program
  .command('ui')
  .description('Agent View UI 관리');

uiCmd
  .command('install')
  .description('등록된 UI 요소 설치')
  .action(async () => {
    await run(async () => {
      const client = getClient();
      const result = await client.post('integration/install');
      if (!result.success) throw new Error(result.error ?? 'install failed');
      console.log('✓ installed');
    });
  });

// ─── 파싱 실행 ──────────────────────────────────────

program.parse();
