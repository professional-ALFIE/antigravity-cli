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
import { registerUnder_func as registerAutoRun_func } from './auto-run.js';

// ── 포맷 헬퍼 ────────────────────────────────────

const TERMINAL_EXEC_LABELS: Record<number, string> = { 1: 'OFF', 2: 'AUTO', 3: 'EAGER' };
const ARTIFACT_REVIEW_LABELS: Record<number, string> = { 1: 'ALWAYS', 2: 'TURBO', 3: 'AUTO' };
const PLANNING_MODE_LABELS: Record<number, string> = { 1: 'OFF', 2: 'ON' };

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function formatStatus(data: Record<string, unknown>): void {
  const server = data['server'] as Record<string, unknown> | undefined;
  const user = data['user'] as Record<string, unknown> | undefined;

  // 서버
  if (server && typeof server === 'object') {
    const uptime = server['uptime'] as number | undefined;
    console.log(`${c.green('✓')} Server ${uptime ? formatUptime(uptime) : 'OK'}`);
  } else {
    console.log(`${c.green('✓')} Server connected`);
  }

  // 유저
  const us = user?.['userStatus'] as Record<string, unknown> | undefined;
  if (!us) { console.log(`${c.dim('  No user info')}`); return; }

  const name = us['name'] as string | undefined;
  const email = us['email'] as string | undefined;
  console.log(`  User   ${name ?? '(unknown)'}  ${c.dim(email ?? '')}`);

  const plan = us['planStatus'] as Record<string, unknown> | undefined;
  const planInfo = plan?.['planInfo'] as Record<string, unknown> | undefined;
  if (planInfo) {
    const planName = planInfo['planName'] as string ?? '?';
    const promptCredits = plan?.['availablePromptCredits'] ?? '?';
    const flowCredits = plan?.['availableFlowCredits'] ?? '?';
    console.log(`  Plan   ${planName}  ${c.dim(`prompt: ${promptCredits}  flow: ${flowCredits}`)}`);
  }

  const tier = us['userTier'] as Record<string, unknown> | undefined;
  if (tier) {
    console.log(`  Tier   ${tier['name'] ?? tier['id'] ?? '?'}`);
  }

  const modelData = us['cascadeModelConfigData'] as Record<string, unknown> | undefined;
  const configs = modelData?.['clientModelConfigs'] as Array<Record<string, unknown>> | undefined;
  if (configs && configs.length > 0) {
    const labels = configs.map((m) => m['label'] as string).filter(Boolean);
    console.log(`  Models ${labels.join(', ')}`);
  }
}

function formatPrefs(data: Record<string, unknown>): void {
  const lines: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(data)) {
    let display: string;
    if (key === 'terminalExecutionPolicy') {
      display = TERMINAL_EXEC_LABELS[value as number] ?? String(value);
    } else if (key === 'artifactReviewPolicy') {
      display = ARTIFACT_REVIEW_LABELS[value as number] ?? String(value);
    } else if (key === 'planningMode') {
      display = PLANNING_MODE_LABELS[value as number] ?? String(value);
    } else if (typeof value === 'boolean') {
      display = value ? c.green('true') : c.dim('false');
    } else if (Array.isArray(value)) {
      display = value.length === 0 ? c.dim('[]') : JSON.stringify(value);
    } else {
      display = String(value);
    }
    lines.push([key, display]);
  }

  const maxKey = Math.max(...lines.map(([k]) => k.length));
  for (const [key, value] of lines) {
    console.log(`  ${c.dim(key.padEnd(maxKey))}  ${value}`);
  }
}

function formatDiag(data: Record<string, unknown>): void {
  const isRemote = data['isRemote'];
  const sysInfo = data['systemInfo'] as Record<string, unknown> | undefined;
  const recent = (data['recentTrajectories']
    ?? (data['raw'] as Record<string, unknown> | undefined)?.['recentTrajectories']
  ) as Array<Record<string, unknown>> | undefined;

  if (isRemote !== undefined) {
    console.log(`  Remote     ${isRemote ? 'Yes' : 'No'}`);
  }
  if (sysInfo) {
    for (const [key, value] of Object.entries(sysInfo)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        console.log(`  ${c.dim(key.padEnd(12))} ${value}`);
      }
    }
  }

  if (recent && recent.length > 0) {
    console.log(`\n  ${c.dim('Recent conversations (' + recent.length + '):')}`);
    for (const t of recent.slice(0, 10)) {
      const id = (t['googleAgentId'] as string)?.slice(0, 8) ?? '????????';
      const summary = (t['summary'] as string) ?? '(no summary)';
      const modified = t['lastModifiedTime'] as string | undefined;
      const steps = t['lastStepIndex'] as number | undefined;
      const meta: string[] = [];
      if (steps !== undefined) meta.push(`${steps} steps`);
      if (modified) {
        const d = new Date(modified);
        meta.push(d.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }));
      }
      console.log(`    ${c.cyan(id)}  ${summary}${meta.length > 0 ? '  ' + c.dim(meta.join(', ')) : ''}`);
    }
  }
}

function buildServerHelp_func(): string {
  return [
    'Usage: antigravity-cli server [options] [command]',
    '',
    'IDE server management (status/prefs/diag/monitor/state/reload/restart/auto-run)',
    '',
    'Options:',
    '  -h, --help           display help for command',
    '',
    'Commands:',
    '  status               Server connection + user status',
    '  prefs                Agent preferences',
    '  diag                 System diagnostics',
    '  monitor              Real-time event stream (Ctrl+C to stop)',
    '  state [key]          Internal store lookup',
    '  reload               Reload IDE window',
    '  restart              Restart language server',
    '  auto-run             Always Proceed auto-run patch management',
    '  help [command]       display help for command',
  ].join('\n');
}

// ── 커맨드 등록 ──────────────────────────────────

export function register(program: Command, h: Helpers): void {
  const serverCmd_var = program
    .command('server')
    .description('IDE server management (status/prefs/diag/monitor/state/reload/restart/auto-run)');

  serverCmd_var.helpInformation = function helpInformation_func(): string {
    return buildServerHelp_func();
  };

  // ── status ──────────────────────────────────────
  serverCmd_var
    .command('status')
    .description('Server connection + user status')
    .action(async () => {
      await h.run(async () => {
        const client_var = await h.getClient();
        const [health_var, userStatus_var] = await Promise.all([
          client_var.get('health'),
          client_var.get('ls/user-status'),
        ]);
        const combined = {
          server: { uptime: (health_var as unknown as Record<string, unknown>)['uptime'] },
          user: userStatus_var.data,
        };
        if (h.isJsonMode()) {
          printResult(combined, true);
        } else {
          formatStatus(combined as Record<string, unknown>);
        }
      });
    });

  // ── prefs ───────────────────────────────────────
  serverCmd_var
    .command('prefs')
    .description('Agent preferences')
    .action(async () => {
      await h.run(async () => {
        const client_var = await h.getClient();
        const result_var = await client_var.get('cascade/preferences');
        if (!result_var.success) throw new Error(result_var.error ?? 'prefs failed');
        if (h.isJsonMode()) {
          printResult(result_var.data, true);
        } else {
          formatPrefs(result_var.data as Record<string, unknown>);
        }
      });
    });

  // ── diag ────────────────────────────────────────
  serverCmd_var
    .command('diag')
    .description('System diagnostics')
    .action(async () => {
      await h.run(async () => {
        const client_var = await h.getClient();
        const result_var = await client_var.get('cascade/diagnostics');
        if (!result_var.success) throw new Error(result_var.error ?? 'diag failed');
        if (h.isJsonMode()) {
          printResult(result_var.data, true);
        } else {
          formatDiag(result_var.data as Record<string, unknown>);
        }
      });
    });

  // ── monitor ─────────────────────────────────────
  serverCmd_var
    .command('monitor')
    .description('Real-time event stream (Ctrl+C to stop)')
    .action(async () => {
      await h.run(async () => {
        const client_var = await h.getClient();
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
    .description('Internal store lookup')
    .action(async (key_var?: string) => {
      await h.run(async () => {
        const client_var = await h.getClient();
        const path_var = key_var ? `state/${key_var}` : 'state';
        const result_var = await client_var.get(path_var);
        if (!result_var.success) throw new Error(result_var.error ?? 'state failed');
        printResult(result_var.data, h.isJsonMode());
      });
    });

  // ── reload ──────────────────────────────────────
  serverCmd_var
    .command('reload')
    .description('Reload IDE window')
    .action(async () => {
      await h.run(async () => {
        const client_var = await h.getClient();
        const result_var = await client_var.post('commands/exec', {
          command: 'antigravity.reloadWindow',
          args: [],
        });
        if (!result_var.success) throw new Error(result_var.error ?? 'reload failed');
        console.log(c.green('✓') + ' IDE reload request sent');
      });
    });

  // ── restart ─────────────────────────────────────
  serverCmd_var
    .command('restart')
    .description('Restart language server')
    .action(async () => {
      await h.run(async () => {
        const client_var = await h.getClient();
        const result_var = await client_var.post('commands/exec', {
          command: 'antigravity.restartLanguageServer',
          args: [],
        });
        if (!result_var.success) throw new Error(result_var.error ?? 'restart failed');
        console.log(c.green('✓') + ' Language server restart request sent');
      });
    });

  registerAutoRun_func(serverCmd_var, h);
}
