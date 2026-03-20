#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const script_file_var = fileURLToPath(import.meta.url);
const package_dir_var = resolve(dirname(script_file_var), '..');
const repo_packages_dir_var = resolve(package_dir_var, '..');
const local_cli_path_var = resolve(repo_packages_dir_var, 'cli/bin/antigravity-cli.ts');
const local_loader_candidates_var = [
  resolve(repo_packages_dir_var, 'cli/node_modules/tsx/dist/loader.mjs'),
  resolve(repo_packages_dir_var, '../node_modules/tsx/dist/loader.mjs'),
];

const documented_models_var = [
  {
    cli_name_var: 'claude-opus-4.6',
    aliases_var: ['opus'],
    description_var: 'Best default choice when you want Opus.',
  },
  {
    cli_name_var: 'claude-sonnet-4.6',
    aliases_var: ['sonnet'],
    description_var: 'Faster Claude option.',
  },
  {
    cli_name_var: 'gemini-3.1-pro-high',
    aliases_var: ['pro-high'],
    description_var: 'Gemini high-effort option.',
  },
  {
    cli_name_var: 'gemini-3.1-pro',
    aliases_var: ['pro'],
    description_var: 'Gemini normal pro option.',
  },
  {
    cli_name_var: 'gemini-3-flash',
    aliases_var: ['flash'],
    description_var: 'Fastest lightweight option.',
  },
];

function printUsage_func() {
  const text_var = [
    'Usage:',
    '  antigravity-agent doctor',
    '  antigravity-agent models',
    '  antigravity-agent run --task "..." [options]',
    '  antigravity-agent run --input /path/to/request.json',
    '  antigravity-agent wait --job <jobId> [options]',
    '',
    'Important idea:',
    '  antigravity-cli = low-level engine',
    '  antigravity-agent = simpler wrapper for other agents',
    '',
    'Run options:',
    '  --task <text>                 Task to send to Antigravity',
    '  --input <file.json>          Read request JSON from a file',
    '  --cwd <dir>                  Workspace directory (default: current folder)',
    '  --model <name>               Model name, for example claude-opus-4.6',
    '  --approval-policy <policy>   auto or manual (default: auto)',
    '  --wait                       Wait for completion (default)',
    '  --async                      Return after job submission',
    '  --expect-file <path>         Expected file, may be repeated',
    '  --timeout-ms <number>        Total wait budget in milliseconds',
    '',
    'Wait options:',
    '  --job <jobId>                Existing job ID',
    '  --cwd <dir>                  Workspace directory if you want file verification',
    '  --expect-file <path>         Expected file, may be repeated',
    '  --timeout-ms <number>        Total wait budget in milliseconds',
    '',
    'Examples:',
    '  antigravity-agent models',
    '  antigravity-agent run --task "Write DIET_PLAN.md" --cwd /tmp/ag-diet --model claude-opus-4.6 --expect-file DIET_PLAN.md',
    '  antigravity-agent run --input ./diet-task.json',
    '  antigravity-agent wait --job 1234 --cwd /tmp/ag-diet --expect-file DIET_PLAN.md',
  ].join('\n');
  process.stdout.write(`${text_var}\n`);
}

function printJson_func(value_var) {
  process.stdout.write(`${JSON.stringify(value_var, null, 2)}\n`);
}

function printErrorAndExit_func(message_var, exit_code_var = 1) {
  process.stderr.write(`${message_var}\n`);
  process.exit(exit_code_var);
}

function sleep_func(ms_var) {
  return new Promise((resolve_var) => {
    setTimeout(resolve_var, ms_var);
  });
}

function parseListFlag_func(argv_var, index_var, current_values_var) {
  const next_value_var = argv_var[index_var + 1];
  if (!next_value_var || next_value_var.startsWith('--')) {
    throw new Error(`Missing value for ${argv_var[index_var]}`);
  }
  current_values_var.push(next_value_var);
  return index_var + 1;
}

function parseScalarFlag_func(argv_var, index_var) {
  const next_value_var = argv_var[index_var + 1];
  if (!next_value_var || next_value_var.startsWith('--')) {
    throw new Error(`Missing value for ${argv_var[index_var]}`);
  }
  return { next_index_var: index_var + 1, value_var: next_value_var };
}

function loadRequestFile_func(input_path_var) {
  const absolute_input_path_var = isAbsolute(input_path_var)
    ? input_path_var
    : resolve(process.cwd(), input_path_var);
  return JSON.parse(readFileSync(absolute_input_path_var, 'utf-8'));
}

function normalizeExpectedFiles_func(expected_files_var) {
  if (!Array.isArray(expected_files_var)) {
    return [];
  }

  return expected_files_var
    .filter((value_var) => typeof value_var === 'string' && value_var.trim().length > 0)
    .map((value_var) => value_var.trim());
}

function parseRunRequest_func(argv_var) {
  let request_var = {
    task: '',
    cwd: process.cwd(),
    model: 'claude-opus-4.6',
    approval_policy: 'auto',
    expected_files: [],
    wait: true,
    timeout_ms: 300000,
  };

  for (let index_var = 0; index_var < argv_var.length; index_var += 1) {
    const token_var = argv_var[index_var];

    switch (token_var) {
      case '--input': {
        const parsed_var = parseScalarFlag_func(argv_var, index_var);
        request_var = {
          ...request_var,
          ...loadRequestFile_func(parsed_var.value_var),
        };
        index_var = parsed_var.next_index_var;
        continue;
      }
      case '--task': {
        const parsed_var = parseScalarFlag_func(argv_var, index_var);
        request_var.task = parsed_var.value_var;
        index_var = parsed_var.next_index_var;
        continue;
      }
      case '--cwd': {
        const parsed_var = parseScalarFlag_func(argv_var, index_var);
        request_var.cwd = parsed_var.value_var;
        index_var = parsed_var.next_index_var;
        continue;
      }
      case '--model': {
        const parsed_var = parseScalarFlag_func(argv_var, index_var);
        request_var.model = parsed_var.value_var;
        index_var = parsed_var.next_index_var;
        continue;
      }
      case '--approval-policy': {
        const parsed_var = parseScalarFlag_func(argv_var, index_var);
        request_var.approval_policy = parsed_var.value_var;
        index_var = parsed_var.next_index_var;
        continue;
      }
      case '--expect-file':
        index_var = parseListFlag_func(argv_var, index_var, request_var.expected_files);
        continue;
      case '--timeout-ms': {
        const parsed_var = parseScalarFlag_func(argv_var, index_var);
        request_var.timeout_ms = Number.parseInt(parsed_var.value_var, 10);
        index_var = parsed_var.next_index_var;
        continue;
      }
      case '--wait':
        request_var.wait = true;
        continue;
      case '--async':
        request_var.wait = false;
        continue;
      default:
        throw new Error(`Unknown run option: ${token_var}`);
    }
  }

  request_var.cwd = isAbsolute(request_var.cwd)
    ? request_var.cwd
    : resolve(process.cwd(), request_var.cwd);
  request_var.expected_files = normalizeExpectedFiles_func(request_var.expected_files);

  if (!request_var.task || typeof request_var.task !== 'string') {
    throw new Error('Run request requires a task. Use --task or --input.');
  }

  if (!Number.isFinite(request_var.timeout_ms) || request_var.timeout_ms <= 0) {
    throw new Error('--timeout-ms must be a positive number.');
  }

  return request_var;
}

function parseWaitRequest_func(argv_var) {
  const request_var = {
    job: '',
    cwd: process.cwd(),
    expected_files: [],
    timeout_ms: 300000,
  };

  for (let index_var = 0; index_var < argv_var.length; index_var += 1) {
    const token_var = argv_var[index_var];

    switch (token_var) {
      case '--job': {
        const parsed_var = parseScalarFlag_func(argv_var, index_var);
        request_var.job = parsed_var.value_var;
        index_var = parsed_var.next_index_var;
        continue;
      }
      case '--cwd': {
        const parsed_var = parseScalarFlag_func(argv_var, index_var);
        request_var.cwd = parsed_var.value_var;
        index_var = parsed_var.next_index_var;
        continue;
      }
      case '--expect-file':
        index_var = parseListFlag_func(argv_var, index_var, request_var.expected_files);
        continue;
      case '--timeout-ms': {
        const parsed_var = parseScalarFlag_func(argv_var, index_var);
        request_var.timeout_ms = Number.parseInt(parsed_var.value_var, 10);
        index_var = parsed_var.next_index_var;
        continue;
      }
      default:
        throw new Error(`Unknown wait option: ${token_var}`);
    }
  }

  request_var.cwd = isAbsolute(request_var.cwd)
    ? request_var.cwd
    : resolve(process.cwd(), request_var.cwd);
  request_var.expected_files = normalizeExpectedFiles_func(request_var.expected_files);

  if (!request_var.job) {
    throw new Error('Wait request requires --job <jobId>.');
  }

  if (!Number.isFinite(request_var.timeout_ms) || request_var.timeout_ms <= 0) {
    throw new Error('--timeout-ms must be a positive number.');
  }

  return request_var;
}

function resolveCliInvocation_func() {
  const override_cli_path_var = process.env.ANTIGRAVITY_AGENT_CLI;
  if (override_cli_path_var) {
    return {
      command_var: override_cli_path_var,
      args_var: [],
      source_var: 'env',
    };
  }

  const resolved_loader_path_var = local_loader_candidates_var.find((candidate_var) => existsSync(candidate_var));
  if (existsSync(local_cli_path_var) && resolved_loader_path_var) {
    return {
      command_var: process.execPath,
      args_var: ['--import', resolved_loader_path_var, local_cli_path_var],
      source_var: 'repo-source',
    };
  }

  return {
    command_var: 'antigravity-cli',
    args_var: [],
    source_var: 'path',
  };
}

async function runExternalCommand_func(command_var, args_var, options_var = {}) {
  return new Promise((resolve_var, reject_var) => {
    const child_var = spawn(command_var, args_var, {
      cwd: options_var.cwd_var ?? process.cwd(),
      env: {
        ...process.env,
        NO_COLOR: '1',
        ...(options_var.env_var ?? {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout_var = '';
    let stderr_var = '';

    child_var.stdout.on('data', (chunk_var) => {
      stdout_var += chunk_var.toString();
    });

    child_var.stderr.on('data', (chunk_var) => {
      stderr_var += chunk_var.toString();
    });

    child_var.on('error', reject_var);
    child_var.on('close', (code_var) => {
      resolve_var({
        code_var: code_var ?? 1,
        stdout_var,
        stderr_var,
      });
    });
  });
}

async function runCliJson_func(args_var, options_var = {}) {
  const cli_invocation_var = resolveCliInvocation_func();
  const result_var = await runExternalCommand_func(
    cli_invocation_var.command_var,
    [...cli_invocation_var.args_var, ...args_var],
    options_var,
  );

  let parsed_var = null;
  const trimmed_stdout_var = result_var.stdout_var.trim();
  if (trimmed_stdout_var.length > 0) {
    parsed_var = JSON.parse(trimmed_stdout_var);
  }

  return {
    ...result_var,
    parsed_var,
    cli_invocation_var,
  };
}

function getMissingExpectedFiles_func(cwd_var, expected_files_var) {
  const missing_files_var = [];

  for (const expected_file_var of expected_files_var) {
    const full_path_var = isAbsolute(expected_file_var)
      ? expected_file_var
      : resolve(cwd_var, expected_file_var);

    if (!existsSync(full_path_var)) {
      missing_files_var.push(expected_file_var);
    }
  }

  return missing_files_var;
}

async function waitForExpectedFiles_func(cwd_var, expected_files_var, timeout_ms_var) {
  if (expected_files_var.length === 0) {
    return {
      verified_var: true,
      missing_files_var: [],
    };
  }

  const deadline_var = Date.now() + timeout_ms_var;
  let missing_files_var = getMissingExpectedFiles_func(cwd_var, expected_files_var);

  while (missing_files_var.length > 0 && Date.now() < deadline_var) {
    await sleep_func(1500);
    missing_files_var = getMissingExpectedFiles_func(cwd_var, expected_files_var);
  }

  return {
    verified_var: missing_files_var.length === 0,
    missing_files_var,
  };
}

async function runDoctor_func() {
  const cli_invocation_var = resolveCliInvocation_func();
  const result_var = await runExternalCommand_func(
    cli_invocation_var.command_var,
    [...cli_invocation_var.args_var, '--help'],
  );

  printJson_func({
    ok: result_var.code_var === 0,
    cli: cli_invocation_var,
    message: result_var.code_var === 0
      ? 'The wrapper can reach antigravity-cli.'
      : 'The wrapper could not start antigravity-cli.',
    stderr: result_var.stderr_var.trim(),
  });

  if (result_var.code_var !== 0) {
    process.exit(result_var.code_var);
  }
}

function runModels_func() {
  printJson_func({
    default_model: documented_models_var[0].cli_name_var,
    models: documented_models_var,
  });
}

async function waitForJobWithVerification_func(request_var) {
  const wait_result_var = await runCliJson_func(
    ['-j', 'jobs', 'wait', request_var.job],
    {
      cwd_var: request_var.cwd,
      env_var: {
        ANTIGRAVITY_CLI_MAX_WAIT_MS: String(request_var.timeout_ms),
      },
    },
  );

  const verification_var = await waitForExpectedFiles_func(
    request_var.cwd,
    request_var.expected_files,
    request_var.timeout_ms,
  );

  const result_payload_var = {
    ok: wait_result_var.code_var === 0 && verification_var.verified_var,
    jobId: request_var.job,
    cli: wait_result_var.cli_invocation_var,
    wait: {
      exit_code: wait_result_var.code_var,
      stderr: wait_result_var.stderr_var.trim(),
      result: wait_result_var.parsed_var,
    },
    verification: {
      cwd: request_var.cwd,
      expected_files: request_var.expected_files,
      verified: verification_var.verified_var,
      missing_files: verification_var.missing_files_var,
    },
  };

  if (!result_payload_var.ok) {
    printJson_func(result_payload_var);
    process.exit(wait_result_var.code_var === 0 ? 1 : wait_result_var.code_var);
  }

  printJson_func(result_payload_var);
}

async function runTask_func(request_var) {
  const create_result_var = await runCliJson_func(
    [
      '-j',
      '-a',
      '-m',
      request_var.model,
      '--approval-policy',
      request_var.approval_policy,
      request_var.task,
    ],
    {
      cwd_var: request_var.cwd,
    },
  );

  if (create_result_var.code_var !== 0) {
    printJson_func({
      ok: false,
      phase: 'submit',
      cli: create_result_var.cli_invocation_var,
      stderr: create_result_var.stderr_var.trim(),
    });
    process.exit(create_result_var.code_var);
  }

  const job_id_var = create_result_var.parsed_var?.jobId;
  const cascade_id_var = create_result_var.parsed_var?.cascadeId;

  if (!job_id_var || !cascade_id_var) {
    printJson_func({
      ok: false,
      phase: 'submit',
      cli: create_result_var.cli_invocation_var,
      stderr: 'CLI returned JSON, but jobId/cascadeId were missing.',
      raw: create_result_var.parsed_var,
    });
    process.exit(1);
  }

  if (!request_var.wait) {
    printJson_func({
      ok: true,
      phase: 'submitted',
      cli: create_result_var.cli_invocation_var,
      request: request_var,
      jobId: job_id_var,
      cascadeId: cascade_id_var,
    });
    return;
  }

  await waitForJobWithVerification_func({
    job: job_id_var,
    cwd: request_var.cwd,
    expected_files: request_var.expected_files,
    timeout_ms: request_var.timeout_ms,
  });
}

async function main_func() {
  const argv_var = process.argv.slice(2);
  const subcommand_var = argv_var[0];
  const rest_args_var = argv_var.slice(1);

  try {
    switch (subcommand_var) {
      case 'doctor':
        await runDoctor_func();
        return;
      case 'models':
        runModels_func();
        return;
      case 'run':
        await runTask_func(parseRunRequest_func(rest_args_var));
        return;
      case 'wait':
        await waitForJobWithVerification_func(parseWaitRequest_func(rest_args_var));
        return;
      case '-h':
      case '--help':
      case undefined:
        printUsage_func();
        return;
      default:
        throw new Error(`Unknown command: ${subcommand_var}`);
    }
  } catch (error_var) {
    printErrorAndExit_func(error_var instanceof Error ? error_var.message : String(error_var));
  }
}

await main_func();
