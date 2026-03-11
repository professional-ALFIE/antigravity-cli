import { BridgeClient } from './client.js';
import { runExec_func } from './commands/exec.js';
import { resolveClientForWorkspace_func } from './auto-launch.js';
import { Spinner } from './spinner.js';
import { printError, printResult } from './output.js';
import { filterResumeList_func, formatResumeList_func } from './resume-list.js';

interface RootInvocation {
  port_var?: number;
  json_var: boolean;
  model_var?: string;
  resume_id_var?: string;
  resume_list_var: boolean;
  async_var: boolean;
  idle_timeout_var: number;
  message_var?: string;
}

const reserved_subcommands_var = new Set([
  'accept',
  'reject',
  'run',
  'server',
  'agent',
  'commands',
  'ui',
  'help',
]);

const legacy_subcommands_var = new Set([
  'exec',
  'resume',
  'auto-run',
]);

function findFirstPositional_func(argv_var: string[]): string | undefined {
  for (let index_var = 0; index_var < argv_var.length; index_var += 1) {
    const token_var = argv_var[index_var];

    if (token_var === '-p' || token_var === '--port') {
      index_var += 1;
      continue;
    }

    if (token_var === '-j' || token_var === '--json' || token_var === '--no-color') {
      continue;
    }

    if (!token_var.startsWith('-')) {
      return token_var;
    }
  }

  return undefined;
}

function hasRootOption_func(argv_var: string[]): boolean {
  return argv_var.some((token_var) => (
    token_var === '-j'
    || token_var === '--json'
    || token_var === '-m'
    || token_var === '--model'
    || token_var === '-r'
    || token_var === '--resume'
    || token_var === '-a'
    || token_var === '--async'
    || token_var === '--idle-timeout'
    || token_var === '--no-wait'
  ));
}

function shouldHandleRootMode_func(argv_var: string[]): boolean {
  if (argv_var.length === 0) {
    return false;
  }

  if (argv_var.includes('-h') || argv_var.includes('--help') || argv_var.includes('-v') || argv_var.includes('--version')) {
    return false;
  }

  const first_positional_var = findFirstPositional_func(argv_var);
  if (first_positional_var && legacy_subcommands_var.has(first_positional_var)) {
    return true;
  }

  if (first_positional_var && reserved_subcommands_var.has(first_positional_var)) {
    return false;
  }

  if (hasRootOption_func(argv_var)) {
    return true;
  }

  return Boolean(first_positional_var);
}

function requireValue_func(
  argv_var: string[],
  index_var: number,
  option_var: string,
): string {
  const value_var = argv_var[index_var + 1];
  if (!value_var || value_var.startsWith('-')) {
    throw new Error(`${option_var} requires a value.`);
  }
  return value_var;
}

function parseInteger_func(value_var: string, option_var: string): number {
  const parsed_var = Number.parseInt(value_var, 10);
  if (!Number.isFinite(parsed_var)) {
    throw new Error(`${option_var} must be a number.`);
  }
  return parsed_var;
}

function parseRootInvocation_func(argv_var: string[]): RootInvocation {
  const result_var: RootInvocation = {
    json_var: false,
    resume_list_var: false,
    async_var: false,
    idle_timeout_var: 10000,
  };

  for (let index_var = 0; index_var < argv_var.length; index_var += 1) {
    const token_var = argv_var[index_var];

    switch (token_var) {
      case '-j':
      case '--json':
        result_var.json_var = true;
        continue;
      case '--no-color':
        continue;
      case '-p':
      case '--port': {
        const value_var = requireValue_func(argv_var, index_var, token_var);
        result_var.port_var = parseInteger_func(value_var, token_var);
        index_var += 1;
        continue;
      }
      case '-m':
      case '--model':
        result_var.model_var = requireValue_func(argv_var, index_var, token_var);
        index_var += 1;
        continue;
      case '--idle-timeout': {
        const value_var = requireValue_func(argv_var, index_var, token_var);
        result_var.idle_timeout_var = parseInteger_func(value_var, token_var);
        index_var += 1;
        continue;
      }
      case '-a':
      case '--async':
        result_var.async_var = true;
        continue;
      case '--no-wait':
        throw new Error('`--no-wait` has been removed. Use `--async` instead.');
      case '-r':
      case '--resume': {
        const next_token_var = argv_var[index_var + 1];
        if (next_token_var && !next_token_var.startsWith('-')) {
          result_var.resume_id_var = next_token_var;
          result_var.resume_list_var = false;
          index_var += 1;
        } else {
          result_var.resume_list_var = true;
        }
        continue;
      }
      default:
        if (token_var.startsWith('-')) {
          throw new Error(`Unknown option: ${token_var}`);
        }

        if (legacy_subcommands_var.has(token_var)) {
          if (token_var === 'exec') {
            throw new Error('`exec` subcommand has been removed. Use `antigravity-cli "message"` instead.');
          }

          if (token_var === 'auto-run') {
            throw new Error('`auto-run` has moved to `server auto-run`. Example: antigravity-cli server auto-run status');
          }

          throw new Error('`resume` subcommand has been removed. Use `antigravity-cli --resume` or `antigravity-cli --resume <uuid> "message"`.');
        }

        if (result_var.message_var !== undefined) {
          throw new Error('Message must be a single positional argument. Use quotes for spaces.');
        }

        result_var.message_var = token_var;
        continue;
    }
  }

  if (result_var.resume_list_var && result_var.message_var) {
    throw new Error('`--resume` alone shows the session list. To continue, use `--resume <uuid> "message"`.');
  }

  if (result_var.resume_id_var && !result_var.message_var) {
    throw new Error('To continue an existing session, pass a message: `--resume <uuid> "message"`.');
  }

  if (!result_var.resume_list_var && !result_var.message_var) {
    throw new Error('Please provide a message. Example: antigravity-cli "analyze this code"');
  }

  return result_var;
}

export async function tryHandleRootMode_func(argv_var: string[]): Promise<boolean> {
  if (!shouldHandleRootMode_func(argv_var)) {
    return false;
  }

  try {
    const invocation_var = parseRootInvocation_func(argv_var);
    const spinner_var = new Spinner();
    spinner_var.start('Connecting');
    const resolved_var = await resolveClientForWorkspace_func(invocation_var.port_var, undefined, spinner_var);
    const instance_var = resolved_var.instance_var;
    const client_var = resolved_var.client_var;

    if (invocation_var.resume_list_var) {
      spinner_var.update('Fetching session list');
      const result_var = await client_var.get('ls/list');
      if (!result_var.success) {
        throw new Error(result_var.error ?? 'list failed');
      }
      spinner_var.stop();

      const workspace_dir_var = instance_var.workspace === '(manual)'
        ? process.cwd()
        : instance_var.workspace;
      const filtered_var = filterResumeList_func(result_var.data, workspace_dir_var);

      if (invocation_var.json_var) {
        printResult(filtered_var, true);
      } else {
        const lines_var = formatResumeList_func(filtered_var);
        if (lines_var.length === 0) {
          console.log('(no items)');
        } else {
          for (const line_var of lines_var) {
            console.log(line_var);
          }
        }
      }

      return true;
    }

    await runExec_func({
      client_var,
      message_var: invocation_var.message_var!,
      model_var: invocation_var.model_var,
      resume_var: invocation_var.resume_id_var,
      async_var: invocation_var.async_var,
      idle_timeout_var: invocation_var.idle_timeout_var,
      json_mode_var: invocation_var.json_var,
      spinner_var,
    });
  } catch (error_var) {
    printError(error_var instanceof Error ? error_var.message : String(error_var));
    process.exitCode = 1;
  }

  return true;
}
