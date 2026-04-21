import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  applyAuthListSelection_func,
  applyPendingSwitchIntentIfNeeded_func,
  attachJsonLifecycleSessionId_func,
  buildResumeListEntries_func,
  buildResumeListOutputLines_func,
  buildOfflineLanguageServerArgs_func,
  buildPrematureLanguageServerExitMessage_func,
  buildJsonDoneEvent_func,
  buildJsonErrorEvent_func,
  buildJsonInitEvent_func,
  buildPostPromptRotateRestartWarningMessage_func,
  buildReplayPrompt_func,
  buildSessionContinuationNotice_func,
  buildUiSurfacedWarningMessage_func,
  buildRootHelp_func,
  CliFatalError,
  classifyRecoveryLogSignalFromText_func,
  collectFetchedStepEvents_func,
  extractStepErrorDetailsFromStep_func,
  extractUserFacingErrorMessagesFromStep_func,
  collectPositionalArgs_func,
  collectTrajectoryWorkspaceUris_func,
  createFetchedStepAppendState_func,
  formatFatalErrorForStderr_func,
  formatResumeListEntryLine_func,
  extractJsonLifecycleSessionId_func,
  dedupeLocalConversationRecords_func,
  extractTrajectorySummaryEntries_func,
  findLatestReplayableStepErrorInSteps_func,
  findLiveAuthAccountByEmailFallback_func,
  findLiveAuthAccountByUserDataDir_func,
  flushPendingTailStepEvent_func,
  getExitCodeFromError_func,
  isRetryableStepErrorForReplay_func,
  parseArgv_func,
  parseLiveUserStatusJsonToSummary_func,
  pickRecoveryLogSessionDirPath_func,
  recoverLatestUserFacingErrorMessagesFromSteps_func,
  recoverPlannerResponseTextFromSteps_func,
  ReplayCancelledError,
  resolveOfflineBootstrapTimeoutMs_func,
  resolveCanonicalModelNameFromEnum_func,
  resolvePostPromptQuotaUpdate_func,
  runAutoReplayLoop_func,
  shouldFetchStepsForUpdate_func,
  detectRootCommand_func,
  decideAndPersistAutoRotate_func,
  parseAuthArgv_func,
} from './main.js';

describe('parseArgv_func', () => {
  test('supports short aliases for background, json, and help', () => {
    const options_var = parseArgv_func(['-b', '-j', '-h', '-m', 'flash', 'hello']);

    expect(options_var).toEqual({
      prompt: 'hello',
      model: 'flash',
      json: true,
      resume: false,
      resumeCascadeId: null,
      background: true,
      help: true,
      timeoutMs: 15_000,
    });
  });

  test('keeps a single positional message token with literal double quotes inside', () => {
    const literal_message_var = '이건 메시지 내용인데, 강조할 땐 "이렇게"강조를 하더라도, 끊기지 않는단말이야';

    const options_var = parseArgv_func(['-m', 'flash', literal_message_var]);

    expect(options_var.prompt).toBe(literal_message_var);
  });

  test('keeps resume send parsing intact for -r <cascadeId> <message>', () => {
    const options_var = parseArgv_func([
      '-r',
      '8ed28f7a-1a83-42fa-b88c-a12dda0af152',
      'continue here',
    ]);

    expect(options_var).toEqual({
      prompt: 'continue here',
      model: undefined,
      json: false,
      resume: true,
      resumeCascadeId: '8ed28f7a-1a83-42fa-b88c-a12dda0af152',
      background: false,
      help: false,
      timeoutMs: 15_000,
    });
  });
});

describe('offline bootstrap helpers', () => {
  test('builds spawn argv with explicit HTTP/HTTPS random-port flags only', () => {
    const argv_var = buildOfflineLanguageServerArgs_func({
      extensionServerPort: 43111,
      workspaceId: 'workspace-id',
      csrfToken: 'csrf-token',
      extensionServerCsrfToken: 'extension-csrf-token',
    });

    expect(argv_var).toContain('--http_server_port=0');
    expect(argv_var).toContain('--https_server_port=0');
    expect(argv_var).not.toContain('--random_port');
    expect(argv_var).toContain('--persistent_mode');
    expect(argv_var).toContain('--workspace_id=workspace-id');
    expect(argv_var).toContain('--extension_server_port=43111');
  });

  test('formats premature child exit failures with stderr context', () => {
    expect(buildPrematureLanguageServerExitMessage_func({
      exitCode: 2,
      signalCode: null,
      stderrText: 'flags provided but not defined: -random_port',
    })).toBe(
      'Language server exited prematurely (exitCode=2, signal=null)\n'
      + '[ls stderr]\nflags provided but not defined: -random_port',
    );
  });

  test('caps offline bootstrap waits below the general CLI timeout', () => {
    expect(resolveOfflineBootstrapTimeoutMs_func(15_000)).toBe(5_000);
    expect(resolveOfflineBootstrapTimeoutMs_func(4_000)).toBe(4_000);
  });
});

describe('collectPositionalArgs_func', () => {
  test('collects only non-option positional arguments in argv order', () => {
    const positional_args_var = collectPositionalArgs_func([
      '-j',
      '--model',
      'flash',
      'first message',
      '--background',
      'second message',
    ]);

    expect(positional_args_var).toEqual(['first message', 'second message']);
  });
});

describe('buildRootHelp_func', () => {
  test('matches the documented antigravity-cli style surface', () => {
    const expected_help_var = [
      'Usage: antigravity-cli [options] [message]',
      '',
      'Headless CLI to control Antigravity language server directly',
      '',
      'Options:',
      '  -m, --model <model>   Set conversation model',
      '                        claude-opus-4.6 (default from IDE last-used)',
      '                        claude-sonnet-4.6',
      '                        gemini-3.1-pro-high',
      '                        gemini-3.1-pro',
      '                        gemini-3-flash',
      '  -r, --resume               List recent sessions (up to 30)',
      '      --resume [cascadeId]   Resume a session by cascadeId',
      '                             (cascadeId is the session identifier, formatted as a UUID)',
      '      --timeout-ms <number>  Override timeout in milliseconds',
      '  -b, --background           Skip UI surfaced registration',
      '  -j, --json                 Output in JSON format',
      '  -h, --help                 display help for command',
      '',
      'Examples:',
      `  $ antigravity-cli 'hello'                               Single-quoted message`,
      `  $ antigravity-cli "hello"                               Double-quoted message`,
      `  $ antigravity-cli hello world                           Unquoted (joined automatically)`,
      `  $ antigravity-cli 'review this code'                    Create new conversation`,
      '  $ antigravity-cli -r                                    List recent workspace sessions',
      `  $ antigravity-cli -r <cascadeId> 'continue'             Send message to existing session`,
      `  $ antigravity-cli -b 'background task'                  Skip UI surfaced registration`,
      `  $ antigravity-cli -j 'summarize this'                   Print transcript events as JSONL`,
      '',
      'Stdin Support:',
      '  Pipe prompt via stdin to avoid shell escaping issues:',
      `    echo "hello!" | antigravity-cli`,
      `    cat prompt.txt | antigravity-cli`,
      '  Or use "-" as explicit stdin marker:',
      `    antigravity-cli -`,
      `    antigravity-cli -r <cascadeId> -`,
      '',
      'Commands:',
      '  auth list                    List accounts with GEMINI/CLAUDE quota status',
      '  auth refresh                 Force full cloud quota sync for all accounts',
      '  auth login                   Add a new managed account via Antigravity app',
      '',
      'Root Mode:',
      '  - New and resumed conversations talk to the Antigravity language server directly',
      '  - If --background is omitted, local tracking and UI surfaced post-processing are attempted',
      '  - --resume list shows the 30 most recent sessions for the current workspace, with full UUIDs and timestamps',
      '  - Multiple positional arguments are joined with spaces automatically',
    ].join('\n');

    expect(buildRootHelp_func('claude-opus-4.6')).toBe(expected_help_var);
  });

  test('joins multiple positional arguments into a single prompt', () => {
    const options_var = parseArgv_func(['hi,', 'antigravity!']);

    expect(options_var.prompt).toBe('hi, antigravity!');
  });
});

describe('JSON lifecycle payloads', () => {
  test('buildJsonInitEvent_func emits the canonical init contract', () => {
    expect(buildJsonInitEvent_func(
      '8ed28f7a-1a83-42fa-b88c-a12dda0af152',
      'claude-opus-4.6',
      '/tmp/workspace',
      false,
    )).toEqual({
      type: 'init',
      session_id: '8ed28f7a-1a83-42fa-b88c-a12dda0af152',
      cascadeId: '8ed28f7a-1a83-42fa-b88c-a12dda0af152',
      model: 'claude-opus-4.6',
      cwd: '/tmp/workspace',
      resume: false,
    });
  });

  test('buildJsonDoneEvent_func emits the canonical done contract', () => {
    expect(buildJsonDoneEvent_func(
      '8ed28f7a-1a83-42fa-b88c-a12dda0af152',
    )).toEqual({
      type: 'done',
      session_id: '8ed28f7a-1a83-42fa-b88c-a12dda0af152',
      cascadeId: '8ed28f7a-1a83-42fa-b88c-a12dda0af152',
      exit_code: 0,
    });
  });

  test('buildJsonErrorEvent_func supports null and known session identifiers', () => {
    expect(buildJsonErrorEvent_func('boom')).toEqual({
      type: 'error',
      session_id: null,
      cascadeId: null,
      message: 'boom',
      exit_code: 1,
    });

    expect(buildJsonErrorEvent_func('boom', 'cascade-id')).toEqual({
      type: 'error',
      session_id: 'cascade-id',
      cascadeId: 'cascade-id',
      message: 'boom',
      exit_code: 1,
    });
  });
});

describe('formatFatalErrorForStderr_func', () => {
  test('prints CliFatalError message without a stack trace', () => {
    expect(formatFatalErrorForStderr_func(
      new CliFatalError('Usage: antigravity-cli "message"'),
    )).toBe('Usage: antigravity-cli "message"');
  });

  test('keeps regular errors debuggable', () => {
    const error_var = new Error('boom');
    const rendered_var = formatFatalErrorForStderr_func(error_var);

    expect(rendered_var).toContain('boom');
  });
});

describe('JSON lifecycle session id attachment', () => {
  test('attaches and extracts session id from existing errors', () => {
    const error_var = new Error('boom');
    const attached_var = attachJsonLifecycleSessionId_func(error_var, 'cascade-id');

    expect(attached_var).toBe(error_var);
    expect(extractJsonLifecycleSessionId_func(attached_var)).toBe('cascade-id');
  });

  test('wraps non-error values and preserves the requested session id', () => {
    const attached_var = attachJsonLifecycleSessionId_func('boom', 'cascade-id');

    expect(attached_var.message).toBe('boom');
    expect(extractJsonLifecycleSessionId_func(attached_var)).toBe('cascade-id');
  });
});

describe('JSON lifecycle fatal contract', () => {
  test('emits a stdout error event for fatal validation failures in --json mode', () => {
    const cli_path_var = fileURLToPath(new URL('./entrypoints/cli.ts', import.meta.url));
    const result_var = Bun.spawnSync({
      cmd: [process.execPath, cli_path_var, '--json'],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stdout_text_var = Buffer.from(result_var.stdout).toString('utf8').trim();
    const stderr_text_var = Buffer.from(result_var.stderr).toString('utf8').trim();

    expect(result_var.exitCode).toBe(1);
    expect(stderr_text_var).toContain('[error] stdin was empty');
    expect(JSON.parse(stdout_text_var)).toEqual({
      type: 'error',
      session_id: null,
      cascadeId: null,
      message: '[error] stdin was empty',
      exit_code: 1,
    });
  });
});

describe('entrypoint execution contract', () => {
  test('prints help once without stderr noise', () => {
    const cli_path_var = fileURLToPath(new URL('./entrypoints/cli.ts', import.meta.url));
    const result_var = Bun.spawnSync({
      cmd: [process.execPath, cli_path_var, '-h'],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stdout_text_var = Buffer.from(result_var.stdout).toString('utf8');
    const stderr_text_var = Buffer.from(result_var.stderr).toString('utf8');
    const usage_count_var = stdout_text_var.match(/^Usage: antigravity-cli \[options] \[message]$/gm)?.length ?? 0;

    expect(result_var.exitCode).toBe(0);
    expect(usage_count_var).toBe(1);
    expect(stderr_text_var).toBe('');
  });
});

describe('buildSessionContinuationNotice_func', () => {
  test('renders a plain continuation notice with a home-relative transcript path', () => {
    const notice_var = buildSessionContinuationNotice_func({
      cascadeId_var: '8ed28f7a-1a83-42fa-b88c-a12dda0af152',
      transcriptPath_var: '/Users/noseung-gyeong/.antigravity-cli/projects/-Users-noseung-gyeong-Dropbox/8ed28f7a-1a83-42fa-b88c-a12dda0af152.jsonl',
      homeDirPath_var: '/Users/noseung-gyeong',
      useColor_var: false,
    });

    expect(notice_var).toBe([
      'cascadeId: 8ed28f7a-1a83-42fa-b88c-a12dda0af152',
      'transcript_path: ~/.antigravity-cli/projects/-Users-noseung-gyeong-Dropbox/8ed28f7a-1a83-42fa-b88c-a12dda0af152.jsonl',
      '',
      "To continue this session, run antigravity-cli --resume 8ed28f7a-1a83-42fa-b88c-a12dda0af152 '<message>'",
    ].join('\n'));
  });

  test('colors the values when ansi output is enabled', () => {
    const notice_var = buildSessionContinuationNotice_func({
      cascadeId_var: 'cascade-id',
      transcriptPath_var: '/tmp/cascade-id.jsonl',
      homeDirPath_var: '/Users/noseung-gyeong',
      useColor_var: true,
    });

    expect(notice_var).toContain('\u001b[38;5;49mcascadeId\u001b[0m: cascade-id');
    expect(notice_var).toContain('\u001b[38;5;49mtranscript_path\u001b[0m: /tmp/cascade-id.jsonl');
    expect(notice_var).toContain("run \u001b[38;5;49mantigravity-cli --resume cascade-id\u001b[0m '<message>'");
  });
});

describe('shouldFetchStepsForUpdate_func', () => {
  test('refetches when stream update touches any step index, including overwrite-only updates', () => {
    expect(shouldFetchStepsForUpdate_func({
      mainStepsTotalLength: 5,
      stepIndices: [3],
    }, 4)).toBe(true);
  });

  test('skips refetch when the update has no step indices and no total length growth signal', () => {
    expect(shouldFetchStepsForUpdate_func({
      mainStepsTotalLength: null,
      stepIndices: [],
    }, 4)).toBe(false);
  });

  test('refetches when total length grows even if the stream update omitted explicit step indices', () => {
    expect(shouldFetchStepsForUpdate_func({
      mainStepsTotalLength: 5,
      stepIndices: [],
    }, 4)).toBe(true);
  });
});

describe('resolveCanonicalModelNameFromEnum_func', () => {
  test('maps known model enums to documented CLI names', () => {
    expect(resolveCanonicalModelNameFromEnum_func(1026)).toBe('claude-opus-4.6');
    expect(resolveCanonicalModelNameFromEnum_func(1035)).toBe('claude-sonnet-4.6');
    expect(resolveCanonicalModelNameFromEnum_func(1018)).toBe('gemini-3-flash');
  });
});

describe('collectFetchedStepEvents_func', () => {
  test('holds the latest tail step until a later step confirms it', () => {
    const initial_steps_var = [
      { type: 'CORTEX_STEP_TYPE_USER_INPUT' },
      { type: 'CORTEX_STEP_TYPE_CONVERSATION_HISTORY' },
      { type: 'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE' },
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        plannerResponse: {
          thinking: 'Simple',
          messageId: 'bot-1',
        },
      },
    ] satisfies Array<Record<string, unknown>>;

    const initial_state_var = createFetchedStepAppendState_func();
    const initial_plan_var = collectFetchedStepEvents_func(
      initial_steps_var,
      initial_state_var,
    );

    expect(initial_plan_var.transcriptEntries_var).toEqual([
      { index: 0, step: initial_steps_var[0] },
      { index: 1, step: initial_steps_var[1] },
      { index: 2, step: initial_steps_var[2] },
    ]);
    expect(initial_plan_var.stdoutEntries_var).toEqual(initial_plan_var.transcriptEntries_var);
    expect(initial_plan_var.nextState_var).toEqual({
      lastAppendedIndex_var: 2,
      lastFetchedStepCount_var: 4,
      pendingTailEntry_var: {
        index: 3,
        step: initial_steps_var[3],
      },
    });

    const overwrite_steps_var = [
      initial_steps_var[0],
      initial_steps_var[1],
      initial_steps_var[2],
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        plannerResponse: {
          response: '안녕하세요',
          messageId: 'bot-1',
        },
      },
    ] satisfies Array<Record<string, unknown>>;

    const overwrite_plan_var = collectFetchedStepEvents_func(
      overwrite_steps_var,
      initial_plan_var.nextState_var,
    );

    expect(overwrite_plan_var.transcriptEntries_var).toEqual([]);
    expect(overwrite_plan_var.stdoutEntries_var).toEqual([]);
    expect(overwrite_plan_var.nextState_var).toEqual({
      lastAppendedIndex_var: 2,
      lastFetchedStepCount_var: 4,
      pendingTailEntry_var: {
        index: 3,
        step: overwrite_steps_var[3],
      },
    });
    expect(overwrite_plan_var.responseText_var).toBe('안녕하세요');

    const checkpoint_steps_var = [
      ...overwrite_steps_var,
      {
        type: 'CORTEX_STEP_TYPE_CHECKPOINT',
        checkpoint: {
          checkpointId: 'cp-1',
        },
      },
    ] satisfies Array<Record<string, unknown>>;

    const checkpoint_plan_var = collectFetchedStepEvents_func(
      checkpoint_steps_var,
      overwrite_plan_var.nextState_var,
    );

    expect(checkpoint_plan_var.transcriptEntries_var).toEqual([
      {
        index: 3,
        step: overwrite_steps_var[3],
      },
    ]);
    expect(checkpoint_plan_var.stdoutEntries_var).toEqual(checkpoint_plan_var.transcriptEntries_var);
    expect(checkpoint_plan_var.nextState_var).toEqual({
      lastAppendedIndex_var: 3,
      lastFetchedStepCount_var: 5,
      pendingTailEntry_var: {
        index: 4,
        step: checkpoint_steps_var[4],
      },
    });
  });
});

describe('flushPendingTailStepEvent_func', () => {
  test('flushes the final pending tail once at shutdown', () => {
    const pending_state_var = {
      lastAppendedIndex_var: 3,
      lastFetchedStepCount_var: 5,
      pendingTailEntry_var: {
        index: 4,
        step: {
          type: 'CORTEX_STEP_TYPE_CHECKPOINT',
        },
      },
    };

    const flush_plan_var = flushPendingTailStepEvent_func(pending_state_var);

    expect(flush_plan_var.transcriptEntries_var).toEqual([
      {
        index: 4,
        step: {
          type: 'CORTEX_STEP_TYPE_CHECKPOINT',
        },
      },
    ]);
    expect(flush_plan_var.stdoutEntries_var).toEqual(flush_plan_var.transcriptEntries_var);
    expect(flush_plan_var.nextState_var).toEqual({
      lastAppendedIndex_var: 4,
      lastFetchedStepCount_var: 5,
      pendingTailEntry_var: null,
    });
  });
});

describe('extractTrajectorySummaryEntries_func', () => {
  test('supports trajectorySummaries response shape', () => {
    const entries_var = extractTrajectorySummaryEntries_func({
      trajectorySummaries: {
        abc: { summary: 'first' },
      },
    });

    expect(entries_var).toEqual([['abc', { summary: 'first' }]]);
  });

  test('supports legacy cascadeTrajectories response shape', () => {
    const entries_var = extractTrajectorySummaryEntries_func({
      cascadeTrajectories: {
        def: { title: 'second' },
      },
    });

    expect(entries_var).toEqual([['def', { title: 'second' }]]);
  });
});

describe('collectTrajectoryWorkspaceUris_func', () => {
  test('collects workspace URIs from top-level, metadata, and nested workspaces', () => {
    const uris_var = collectTrajectoryWorkspaceUris_func({
      workspaceUris: ['file:///top-level'],
      trajectoryMetadata: {
        workspaceUris: ['file:///metadata'],
      },
      workspaces: [
        {
          workspaceFolderAbsoluteUri: 'file:///folder',
          gitRootAbsoluteUri: 'file:///git-root',
        },
      ],
    });

    expect(uris_var).toEqual([
      'file:///top-level',
      'file:///metadata',
      'file:///folder',
      'file:///git-root',
    ]);
  });
});

describe('buildUiSurfacedWarningMessage_func', () => {
  test('formats a single-line degraded-success warning', () => {
    expect(buildUiSurfacedWarningMessage_func(
      'cascade-fail',
      'state db write failed',
    )).toBe(
      '[warn][ui-surfaced] cascadeId=cascade-fail reason=state db write failed ui_visibility=degraded',
    );
  });

  test('normalizes empty or multiline reasons to keep stderr parseable', () => {
    expect(buildUiSurfacedWarningMessage_func(
      'cascade-fail',
      ' \n  ',
    )).toBe(
      '[warn][ui-surfaced] cascadeId=cascade-fail reason=unknown ui_visibility=degraded',
    );
    expect(buildUiSurfacedWarningMessage_func(
      'cascade-fail',
      'sqlite busy\nretry later',
    )).toBe(
      '[warn][ui-surfaced] cascadeId=cascade-fail reason=sqlite busy retry later ui_visibility=degraded',
    );
  });
});

describe('buildPostPromptRotateRestartWarningMessage_func', () => {
  test('formats a restart-required warning for live post-prompt rotate', () => {
    expect(buildPostPromptRotateRestartWarningMessage_func('acc-2')).toBe(
      '[warn][post-prompt-rotate] target_account_id=acc-2 live_session_restart_required=true reason=restart_antigravity_app_to_use_switched_account',
    );
  });
});

describe('dedupeLocalConversationRecords_func', () => {
  test('keeps only the latest record for the same cascadeId', () => {
    const records_var = dedupeLocalConversationRecords_func([
      {
        cascadeId: 'same-id',
        prompt: 'old prompt',
        createdAt: '2026-04-07T10:00:00.000Z',
        model: 'flash',
      },
      {
        cascadeId: 'same-id',
        prompt: 'new prompt',
        createdAt: '2026-04-07T11:00:00.000Z',
        model: 'flash',
      },
    ]);

    expect(records_var).toEqual([
      {
        cascadeId: 'same-id',
        prompt: 'new prompt',
        createdAt: '2026-04-07T11:00:00.000Z',
        model: 'flash',
      },
    ]);
  });
});

describe('buildResumeListEntries_func', () => {
  test('merges rpc/local entries, excludes foreign workspaces, sorts newest first, and caps to 30', () => {
    const rpc_entries_var: Array<[string, Record<string, unknown>]> = [
      [
        'rpc-shared',
        {
          status: 'done',
          summary: 'rpc summary',
          updatedAt: '2026-04-07T11:00:00.000Z',
          workspaceUris: ['file:///workspace'],
        },
      ],
      [
        'rpc-only',
        {
          status: 'running',
          title: 'rpc only title',
          createdAt: '2026-04-07T09:30:00.000Z',
          workspaceUris: ['file:///workspace'],
        },
      ],
      [
        'foreign-rpc',
        {
          status: 'done',
          title: 'should be filtered',
          updatedAt: '2026-04-07T12:00:00.000Z',
          workspaceUris: ['file:///other-workspace'],
        },
      ],
    ];

    const local_records_var = [
      {
        cascadeId: 'rpc-shared',
        prompt: 'newer local prompt',
        createdAt: '2026-04-07T12:15:00.000Z',
        model: 'flash',
      },
      {
        cascadeId: 'local-only',
        prompt: 'local only prompt',
        createdAt: '2026-04-07T10:45:00.000Z',
        model: 'flash',
      },
      ...Array.from({ length: 31 }, (_, index_var) => ({
        cascadeId: `local-${index_var.toString().padStart(2, '0')}`,
        prompt: `prompt ${index_var}`,
        createdAt: new Date(Date.UTC(2026, 2, index_var + 1)).toISOString(),
        model: 'flash',
      })),
    ];

    const entries_var = buildResumeListEntries_func({
      rpcEntries_var: rpc_entries_var,
      localRecords_var: local_records_var,
      workspaceUri_var: 'file:///workspace',
    });

    expect(entries_var).toHaveLength(30);
    expect(entries_var[0]).toMatchObject({
      cascadeId: 'rpc-shared',
      status: 'done',
      title: 'rpc summary',
    });
    expect(entries_var[0].displayTime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(entries_var.some((entry_var) => entry_var.cascadeId === 'foreign-rpc')).toBe(false);
    expect(entries_var.some((entry_var) => entry_var.cascadeId === 'local-only')).toBe(true);
    expect(entries_var.some((entry_var) => entry_var.cascadeId === 'local-00')).toBe(false);
    expect(entries_var.findIndex((entry_var) => entry_var.cascadeId === 'rpc-shared')).toBeLessThan(
      entries_var.findIndex((entry_var) => entry_var.cascadeId === 'rpc-only'),
    );
  });

  test('falls back to unknown time labels without crashing on invalid timestamps', () => {
    const entries_var = buildResumeListEntries_func({
      rpcEntries_var: [
        [
          'broken-time',
          {
            status: 'unknown',
            title: 'broken',
            updatedAt: 'not-a-date',
            workspaceUris: ['file:///workspace'],
          },
        ],
      ],
      localRecords_var: [],
      workspaceUri_var: 'file:///workspace',
    });

    expect(entries_var).toEqual([
      expect.objectContaining({
        cascadeId: 'broken-time',
        displayTime: '(unknown time)',
      }),
    ]);
  });
});

describe('resume list output helpers', () => {
  test('renders time labels in each output line', () => {
    const line_var = formatResumeListEntryLine_func({
      cascadeId: '8ed28f7a-1a83-42fa-b88c-a12dda0af152',
      status: 'done',
      title: 'summary',
      source: 'rpc',
      sortTimestampMs: Date.parse('2026-04-07T11:00:00.000Z'),
      displayTime: '2026-04-07 20:00',
    });

    expect(line_var).toBe(
      '  2026-04-07 20:00  8ed28f7a-1a83-42fa-b88c-a12dda0af152  [done]  summary',
    );
  });

  test('keeps the empty state message unchanged', () => {
    expect(buildResumeListOutputLines_func([], '/tmp/workspace')).toEqual([
      'No conversations found for workspace: /tmp/workspace',
    ]);
  });
});

describe('recoverPlannerResponseTextFromSteps_func', () => {
  test('prefers plannerResponse.response when present', () => {
    const response_var = recoverPlannerResponseTextFromSteps_func([
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        plannerResponse: {
          response: 'OK',
        },
      },
    ]);

    expect(response_var).toBe('OK');
  });

  test('falls back to plannerResponse.modifiedResponse', () => {
    const response_var = recoverPlannerResponseTextFromSteps_func([
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        plannerResponse: {
          modifiedResponse: 'OK-ish',
        },
      },
    ]);

    expect(response_var).toBe('OK-ish');
  });

  test('returns the latest non-empty planner response text', () => {
    const response_var = recoverPlannerResponseTextFromSteps_func([
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        plannerResponse: {
          modifiedResponse: '',
        },
      },
      {
        type: 'CORTEX_STEP_TYPE_VIEW_FILE',
      },
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        plannerResponse: {
          text: 'final text',
        },
      },
    ]);

    expect(response_var).toBe('final text');
  });
});

describe('extractUserFacingErrorMessagesFromStep_func', () => {
  test('returns shortError and userErrorMessage for error steps', () => {
    const messages_var = extractUserFacingErrorMessagesFromStep_func({
      type: 'CORTEX_STEP_TYPE_ERROR_MESSAGE',
      errorMessage: {
        error: {
          shortError: 'UNAVAILABLE (code 503): No capacity available',
          userErrorMessage: 'Our servers are experiencing high traffic right now.',
        },
      },
    });

    expect(messages_var).toEqual([
      'UNAVAILABLE (code 503): No capacity available',
      'Our servers are experiencing high traffic right now.',
    ]);
  });

  test('deduplicates identical error strings inside the same step', () => {
    const messages_var = extractUserFacingErrorMessagesFromStep_func({
      type: 'CORTEX_STEP_TYPE_ERROR_MESSAGE',
      errorMessage: {
        error: {
          shortError: 'same message',
          userErrorMessage: 'same message',
        },
      },
    });

    expect(messages_var).toEqual(['same message']);
  });

  test('also reads user-facing messages from regular step.error payload', () => {
    const messages_var = extractUserFacingErrorMessagesFromStep_func({
      type: 'CORTEX_STEP_TYPE_FIND',
      error: {
        shortError: 'UNAVAILABLE (code 503): No capacity available',
        userErrorMessage: 'Our servers are experiencing high traffic right now.',
      },
    });

    expect(messages_var).toEqual([
      'UNAVAILABLE (code 503): No capacity available',
      'Our servers are experiencing high traffic right now.',
    ]);
  });
});

describe('recoverLatestUserFacingErrorMessagesFromSteps_func', () => {
  test('returns the latest user-facing error messages when no planner text exists', () => {
    const messages_var = recoverLatestUserFacingErrorMessagesFromSteps_func([
      {
        type: 'CORTEX_STEP_TYPE_ERROR_MESSAGE',
        errorMessage: {
          error: {
            shortError: 'old short',
            userErrorMessage: 'old user',
          },
        },
      },
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        plannerResponse: {
          stopReason: 'STOP_REASON_CLIENT_STREAM_ERROR',
        },
      },
      {
        type: 'CORTEX_STEP_TYPE_ERROR_MESSAGE',
        errorMessage: {
          error: {
            shortError: 'new short',
            userErrorMessage: 'new user',
          },
        },
      },
    ]);

    expect(messages_var).toEqual(['new short', 'new user']);
  });
});

describe('replay helpers', () => {
  test('extracts structured error details from errorMessage steps', () => {
    const error_details_var = extractStepErrorDetailsFromStep_func({
      type: 'CORTEX_STEP_TYPE_ERROR_MESSAGE',
      errorMessage: {
        error: {
          errorCode: 503,
          shortError: 'UNAVAILABLE (code 503): No capacity available for model',
          userErrorMessage: 'Our servers are experiencing high traffic right now, please try again in a minute.',
          details: '{"error":{"code":503}}',
          rpcErrorDetails: ['{"reason":"MODEL_CAPACITY_EXHAUSTED"}'],
        },
      },
    });

    expect(error_details_var).toEqual({
      errorCode: 503,
      shortError: 'UNAVAILABLE (code 503): No capacity available for model',
      userErrorMessage: 'Our servers are experiencing high traffic right now, please try again in a minute.',
      modelErrorMessage: null,
      fullError: null,
      details: '{"error":{"code":503}}',
      rpcErrorDetails: ['{"reason":"MODEL_CAPACITY_EXHAUSTED"}'],
    });
  });

  test('treats 503 capacity errors as auto-replay eligible', () => {
    expect(isRetryableStepErrorForReplay_func({
      errorCode: 503,
      shortError: 'UNAVAILABLE (code 503): No capacity available for model claude-opus-4-6-thinking on the server',
      userErrorMessage: 'Our servers are experiencing high traffic right now, please try again in a minute.',
      modelErrorMessage: null,
      fullError: null,
      details: null,
      rpcErrorDetails: [],
    })).toBe(true);
  });

  test('excludes 429 insufficient credits errors from auto-replay', () => {
    expect(isRetryableStepErrorForReplay_func({
      errorCode: 429,
      shortError: 'RESOURCE_EXHAUSTED (code 429): Resource has been exhausted (e.g. check quota).',
      userErrorMessage: 'Agent execution terminated due to error.',
      modelErrorMessage: null,
      fullError: null,
      details: '{"error":{"details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"INSUFFICIENT_G1_CREDITS_BALANCE"}]}}',
      rpcErrorDetails: ['{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"INSUFFICIENT_G1_CREDITS_BALANCE"}'],
    })).toBe(false);
  });

  test('finds the latest replayable error candidate from mixed steps', () => {
    const candidate_var = findLatestReplayableStepErrorInSteps_func([
      {
        type: 'CORTEX_STEP_TYPE_CODE_ACTION',
        error: {
          shortError: 'target content not found',
        },
      },
      {
        type: 'CORTEX_STEP_TYPE_ERROR_MESSAGE',
        errorMessage: {
          error: {
            errorCode: 503,
            shortError: 'UNAVAILABLE (code 503): No capacity available for model claude-opus-4-6-thinking on the server',
            userErrorMessage: 'Our servers are experiencing high traffic right now, please try again in a minute.',
          },
        },
      },
    ]);

    expect(candidate_var?.errorCode).toBe(503);
    expect(candidate_var?.shortError).toContain('UNAVAILABLE');
  });

  test('builds replay prompt with CDATA-safe original prompt', () => {
    const replay_prompt_var = buildReplayPrompt_func('before ]]> after');

    expect(replay_prompt_var).toContain('<system-reminder>');
    expect(replay_prompt_var).toContain('<previous-user-prompt><![CDATA[');
    expect(replay_prompt_var).toContain('before ]]]]><![CDATA[> after');
  });
});

describe('recovery log helpers', () => {
  test('prefers pinned log session dir unless a newer one exists', () => {
    const root_var = mkdtempSync(path.join(tmpdir(), 'ag-log-session-'));
    const pinned_var = path.join(root_var, '20260420T133423');
    const newer_var = path.join(root_var, '20260421T000242');
    mkdirSync(pinned_var);
    mkdirSync(newer_var);

    utimesSync(pinned_var, new Date('2026-04-20T13:34:23Z'), new Date('2026-04-20T13:34:23Z'));
    utimesSync(newer_var, new Date('2026-04-21T00:02:42Z'), new Date('2026-04-21T00:02:42Z'));

    expect(pickRecoveryLogSessionDirPath_func(root_var, pinned_var)).toBe(newer_var);
  });

  test('classifies auth/network recovery signals from fallback logs', () => {
    expect(classifyRecoveryLogSignalFromText_func(
      'Failed to get OAuth token: failed to compute token: Post "https://oauth2.googleapis.com/token": net/http: TLS handshake timeout',
    )?.category).toBe('awaitNetworkRecovery');

    expect(classifyRecoveryLogSignalFromText_func(
      'Error refreshing user status: request to https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist failed, reason: getaddrinfo ENOTFOUND',
    )?.category).toBe('awaitNetworkRecovery');
  });
});

describe('auto replay integration', () => {
  function buildRetryable503Error_var() {
    return {
      errorCode: 503,
      shortError: 'UNAVAILABLE (code 503): No capacity available for model claude-opus-4-6-thinking on the server',
      userErrorMessage: 'Our servers are experiencing high traffic right now, please try again in a minute.',
      modelErrorMessage: null,
      fullError: null,
      details: null,
      rpcErrorDetails: [],
    };
  }

  test('replays when partial response text and retryable 503 step coexist', async () => {
    const prompts_var: string[] = [];
    let attempt_index_var = 0;

    await runAutoReplayLoop_func({
      original_prompt_var: '계속 해라고',
      runAttempt_func: async (prompt_text_var) => {
        prompts_var.push(prompt_text_var);
        attempt_index_var += 1;
        if (attempt_index_var === 1) {
          return {
            finalResponseText_var: 'partial response',
            latestErrorMessages_var: [],
            latestReplayableStepError_var: buildRetryable503Error_var(),
            timedOut_var: false,
            streamError_var: null,
          };
        }

        return {
          finalResponseText_var: 'final response',
          latestErrorMessages_var: [],
          latestReplayableStepError_var: null,
          timedOut_var: false,
          streamError_var: null,
        };
      },
      detectRecoverySignal_func: () => null,
    });

    expect(prompts_var).toHaveLength(2);
    expect(prompts_var[1]).toContain('<system-reminder>');
  });

  test('does not replay when response exists and no retryable error exists', async () => {
    const prompts_var: string[] = [];

    await runAutoReplayLoop_func({
      original_prompt_var: '계속 해라고',
      runAttempt_func: async (prompt_text_var) => {
        prompts_var.push(prompt_text_var);
        return {
          finalResponseText_var: 'complete response',
          latestErrorMessages_var: [],
          latestReplayableStepError_var: null,
          timedOut_var: false,
          streamError_var: null,
        };
      },
      detectRecoverySignal_func: () => null,
    });

    expect(prompts_var).toHaveLength(1);
  });

  test('keeps replaying through three retryable 503 attempts before success', async () => {
    const prompts_var: string[] = [];
    let attempt_index_var = 0;

    await runAutoReplayLoop_func({
      original_prompt_var: '계속 해라고',
      runAttempt_func: async (prompt_text_var) => {
        prompts_var.push(prompt_text_var);
        attempt_index_var += 1;

        if (attempt_index_var < 4) {
          return {
            finalResponseText_var: attempt_index_var === 1 ? 'partial response' : null,
            latestErrorMessages_var: [],
            latestReplayableStepError_var: buildRetryable503Error_var(),
            timedOut_var: false,
            streamError_var: null,
          };
        }

        return {
          finalResponseText_var: 'success after retries',
          latestErrorMessages_var: [],
          latestReplayableStepError_var: null,
          timedOut_var: false,
          streamError_var: null,
        };
      },
      detectRecoverySignal_func: () => null,
    });

    expect(prompts_var).toHaveLength(4);
    expect(prompts_var[1]).toContain('<system-reminder>');
    expect(prompts_var[2]).toContain('<system-reminder>');
    expect(prompts_var[3]).toContain('<system-reminder>');
  });

  test('stops replay immediately when SIGINT abort signal fires after first 503', async () => {
    const prompts_var: string[] = [];
    const abort_controller_var = new AbortController();

    await expect(runAutoReplayLoop_func({
      original_prompt_var: '계속 해라고',
      abortSignal_var: abort_controller_var.signal,
      runAttempt_func: async (prompt_text_var) => {
        prompts_var.push(prompt_text_var);
        return {
          finalResponseText_var: 'partial response',
          latestErrorMessages_var: [],
          latestReplayableStepError_var: buildRetryable503Error_var(),
          timedOut_var: false,
          streamError_var: null,
        };
      },
      detectRecoverySignal_func: () => null,
      onReplayScheduled_func: () => {
        abort_controller_var.abort();
      },
    })).rejects.toBeInstanceOf(ReplayCancelledError);

    expect(prompts_var).toHaveLength(1);
    expect(getExitCodeFromError_func(new ReplayCancelledError())).toBe(130);
  });
});

// ─── Phase 1: detectRootCommand_func 라우팅 회귀 테스트 ───────

describe('detectRootCommand_func', () => {
  test('agcl auth list → auth path', () => {
    const result = detectRootCommand_func(['auth', 'list']);
    expect(result.kind).toBe('auth');
    expect(result.argv).toEqual(['list']);
  });

  test('agcl auth login → auth path', () => {
    const result = detectRootCommand_func(['auth', 'login']);
    expect(result.kind).toBe('auth');
    expect(result.argv).toEqual(['login']);
  });

  test('agcl auth list --json → auth path, argv 포함', () => {
    const result = detectRootCommand_func(['auth', 'list', '--json']);
    expect(result.kind).toBe('auth');
    expect(result.argv).toEqual(['list', '--json']);
  });

  test('agcl --json auth list → auth path (pre-auth flag 보존)', () => {
    const result = detectRootCommand_func(['--json', 'auth', 'list']);
    expect(result.kind).toBe('auth');
    expect(result.argv).toEqual(['--json', 'list']);
  });

  test('agcl hello world → chat path', () => {
    const result = detectRootCommand_func(['hello', 'world']);
    expect(result.kind).toBe('chat');
  });

  test('agcl --model flash "hello" → chat path', () => {
    const result = detectRootCommand_func(['--model', 'flash', 'hello']);
    expect(result.kind).toBe('chat');
  });

  test('agcl (no args) → chat path', () => {
    const result = detectRootCommand_func([]);
    expect(result.kind).toBe('chat');
  });

  test("agcl 'auth is a great session' → chat path (auth 아닌 토큰)", () => {
    const result = detectRootCommand_func(['auth is a great session']);
    // 첫 번째 비-flag 토큰이 'auth' 정확히 일치해야만 auth path
    expect(result.kind).toBe('chat');
  });
});

describe('live auth account matching helpers', () => {
  test('matches live account by a single distinct user-data-dir', () => {
    const account_name_var = findLiveAuthAccountByUserDataDir_func(
      [
        { name: 'default', userDataDirPath: '/Users/test/Library/Application Support/Antigravity' },
        { name: 'user-01', userDataDirPath: '/Users/test/.antigravity-cli/user-data/user-01' },
      ],
      [
        { pid: 100, userDataDirPath: '/Users/test/Library/Application Support/Antigravity' },
        { pid: 101, userDataDirPath: '/Users/test/Library/Application Support/Antigravity' },
      ],
    );

    expect(account_name_var).toBe('default');
  });

  test('returns null when multiple distinct running user-data-dir values exist', () => {
    const account_name_var = findLiveAuthAccountByUserDataDir_func(
      [
        { name: 'default', userDataDirPath: '/Users/test/Library/Application Support/Antigravity' },
        { name: 'user-01', userDataDirPath: '/Users/test/.antigravity-cli/user-data/user-01' },
      ],
      [
        { pid: 100, userDataDirPath: '/Users/test/Library/Application Support/Antigravity' },
        { pid: 200, userDataDirPath: '/Users/test/.antigravity-cli/user-data/user-01' },
      ],
    );

    expect(account_name_var).toBeNull();
  });

  test('falls back to a unique persisted email match', () => {
    const live_summary_var = parseLiveUserStatusJsonToSummary_func({
      userStatus: {
        email: 'user@gmail.com',
        userTier: { id: 'g1-pro-tier', name: 'Google AI Pro' },
        cascadeModelConfigData: { clientModelConfigs: [] },
      },
    });

    expect(findLiveAuthAccountByEmailFallback_func(
      [
        {
          name: 'default',
          parseResult: {
            email: 'user@gmail.com',
            userTierId: 'g1-pro-tier',
            userTierName: 'Google AI Pro',
            familyQuotaSummaries: [],
          },
        },
        {
          name: 'user-01',
          parseResult: {
            email: 'work@company.com',
            userTierId: 'g1-ultra-tier',
            userTierName: 'Google AI Ultra',
            familyQuotaSummaries: [],
          },
        },
      ],
      live_summary_var,
    )).toBe('default');
  });

  test('does not use email fallback when multiple accounts share the same email', () => {
    const live_summary_var = parseLiveUserStatusJsonToSummary_func({
      userStatus: {
        email: 'user@gmail.com',
        cascadeModelConfigData: { clientModelConfigs: [] },
      },
    });

    expect(findLiveAuthAccountByEmailFallback_func(
      [
        {
          name: 'default',
          parseResult: {
            email: 'user@gmail.com',
            userTierId: null,
            userTierName: null,
            familyQuotaSummaries: [],
          },
        },
        {
          name: 'user-01',
          parseResult: {
            email: 'user@gmail.com',
            userTierId: null,
            userTierName: null,
            familyQuotaSummaries: [],
          },
        },
      ],
      live_summary_var,
    )).toBeNull();
  });
});

describe('applyAuthListSelection_func', () => {
  test('injects auth, updates current_account_id, and reports restartRequired=false without live LS', async () => {
    const test_root_var = await import('node:fs/promises').then(({ mkdtemp, mkdir, writeFile }) => ({ mkdtemp, mkdir, writeFile }));
    const path_var = await import('node:path');
    const os_var = await import('node:os');
    const { upsertAccount_func, getCurrentAccountId_func, updateAccountFingerprintState_func } = await import('./services/accounts.js');

    const root_var = await test_root_var.mkdtemp(path_var.default.join(os_var.tmpdir(), 'ag-main-auth-list-'));
    const cli_dir_var = path_var.default.join(root_var, 'cli');
    const default_data_dir_var = path_var.default.join(root_var, 'default');
    await test_root_var.mkdir(cli_dir_var, { recursive: true });
    await test_root_var.mkdir(path_var.default.join(default_data_dir_var, 'User', 'globalStorage'), { recursive: true });
    await test_root_var.writeFile(path_var.default.join(default_data_dir_var, 'User', 'globalStorage', 'state.vscdb'), '');

    const account_var = await upsertAccount_func({
      cliDir: cli_dir_var,
      email: 'user@example.com',
      name: 'User Example',
      token: {
        access_token: 'access-123',
        refresh_token: 'refresh-123',
        expires_in: 3600,
        expiry_timestamp: 1_712_345_678,
        token_type: 'Bearer',
        project_id: null,
      },
    });
    await updateAccountFingerprintState_func({
      cliDir: cli_dir_var,
      accountId: account_var.account.id,
      fingerprintId: 'fp-1',
      deviceProfile: {
        machine_id: 'auth0|user_deadbeefdeadbeefdeadbeefdeadbeef',
        mac_machine_id: '11111111-2222-4333-8444-555555555555',
        dev_device_id: '66666666-7777-4888-9999-aaaaaaaaaaaa',
        sqm_id: '{BBBBBBBB-CCCC-4DDD-8EEE-FFFFFFFFFFFF}',
        service_machine_id: '12345678-1234-4234-9234-123456789abc',
      },
    });

    const injected_var: Array<Record<string, unknown>> = [];
    const fingerprint_calls_var: Array<Record<string, unknown>> = [];
    const result_var = await applyAuthListSelection_func({
      cliDir: cli_dir_var,
      defaultDataDir: default_data_dir_var,
      accountId: account_var.account.id,
      injectAuth: async (options_var) => {
        injected_var.push(options_var as unknown as Record<string, unknown>);
      },
      applyDeviceProfile: (options_var) => {
        fingerprint_calls_var.push(options_var as unknown as Record<string, unknown>);
      },
      discoverLiveLanguageServer: async () => null,
    });

    expect(injected_var).toHaveLength(1);
    expect(injected_var[0].accessToken).toBe('access-123');
    expect(fingerprint_calls_var).toHaveLength(1);
    expect(fingerprint_calls_var[0].fingerprintId).toBe('fp-1');
    expect(await getCurrentAccountId_func({ cliDir: cli_dir_var })).toBe(account_var.account.id);
    expect(result_var.restartRequired).toBe(false);

    await import('node:fs/promises').then(({ rm }) => rm(root_var, { recursive: true, force: true }));
  });

  test('rolls auth back when fingerprint apply fails after inject', async () => {
    const fs_var = await import('node:fs/promises');
    const path_var = await import('node:path');
    const os_var = await import('node:os');
    const {
      upsertAccount_func,
      getCurrentAccountId_func,
      updateAccountFingerprintState_func,
      setCurrentAccountId_func,
    } = await import('./services/accounts.js');

    const root_var = await fs_var.mkdtemp(path_var.default.join(os_var.tmpdir(), 'ag-main-auth-rollback-'));
    const cli_dir_var = path_var.default.join(root_var, 'cli');
    const default_data_dir_var = path_var.default.join(root_var, 'default');
    await fs_var.mkdir(path_var.default.join(default_data_dir_var, 'User', 'globalStorage'), { recursive: true });

    const previous_account_var = await upsertAccount_func({
      cliDir: cli_dir_var,
      email: 'previous@example.com',
      name: 'Previous User',
      token: {
        access_token: 'access-prev',
        refresh_token: 'refresh-prev',
        expires_in: 3600,
        expiry_timestamp: 1_712_345_678,
        token_type: 'Bearer',
        project_id: null,
      },
    });
    await updateAccountFingerprintState_func({
      cliDir: cli_dir_var,
      accountId: previous_account_var.account.id,
      fingerprintId: 'fp-prev',
      deviceProfile: {
        machine_id: 'auth0|user_prevprevprevprevprevprevprevprev',
        mac_machine_id: '11111111-2222-4333-8444-555555555555',
        dev_device_id: '66666666-7777-4888-9999-aaaaaaaaaaaa',
        sqm_id: '{BBBBBBBB-CCCC-4DDD-8EEE-FFFFFFFFFFFF}',
        service_machine_id: '12345678-1234-4234-9234-123456789abc',
      },
    });

    const target_account_var = await upsertAccount_func({
      cliDir: cli_dir_var,
      email: 'target@example.com',
      name: 'Target User',
      token: {
        access_token: 'access-target',
        refresh_token: 'refresh-target',
        expires_in: 3600,
        expiry_timestamp: 1_712_345_679,
        token_type: 'Bearer',
        project_id: null,
      },
    });
    await updateAccountFingerprintState_func({
      cliDir: cli_dir_var,
      accountId: target_account_var.account.id,
      fingerprintId: 'fp-target',
      deviceProfile: {
        machine_id: 'auth0|user_targettargettargettargettargetta',
        mac_machine_id: '22222222-3333-4444-8555-666666666666',
        dev_device_id: '77777777-8888-4999-aaaa-bbbbbbbbbbbb',
        sqm_id: '{CCCCCCCC-DDDD-4EEE-8FFF-AAAAAAAAAAAA}',
        service_machine_id: '22345678-1234-4234-9234-123456789abc',
      },
    });
    await setCurrentAccountId_func({ cliDir: cli_dir_var, accountId: previous_account_var.account.id });

    const injected_var: Array<Record<string, unknown>> = [];

    await expect(applyAuthListSelection_func({
      cliDir: cli_dir_var,
      defaultDataDir: default_data_dir_var,
      accountId: target_account_var.account.id,
      injectAuth: async (options_var) => {
        injected_var.push(options_var as unknown as Record<string, unknown>);
      },
      applyDeviceProfile: () => {
        throw new Error('fingerprint failed');
      },
      discoverLiveLanguageServer: async () => null,
    })).rejects.toThrow('Fingerprint apply failed after auth inject');

    expect(injected_var).toHaveLength(2);
    expect(injected_var[0].accessToken).toBe('access-target');
    expect(injected_var[1].accessToken).toBe('access-prev');
    expect(await getCurrentAccountId_func({ cliDir: cli_dir_var })).toBe(previous_account_var.account.id);

    await fs_var.rm(root_var, { recursive: true, force: true });
  });
});

describe('auto-rotate helpers', () => {
  test('R-4 read-only help path does not produce pending switch intent', async () => {
    const fs_var = await import('node:fs/promises');
    const path_var = await import('node:path');
    const os_var = await import('node:os');

    const root_var = await fs_var.mkdtemp(path_var.default.join(os_var.tmpdir(), 'ag-rotate-main-'));
    const runtime_dir_var = path_var.default.join(root_var, 'runtime');

    const result_var = await decideAndPersistAutoRotate_func({
      cli: {
        prompt: null,
        model: undefined,
        json: false,
        resume: false,
        resumeCascadeId: null,
        background: false,
        help: true,
        timeoutMs: 15000,
      },
      runtimeDir: runtime_dir_var,
      loadAccounts: async () => [],
    });

    expect(result_var.pendingSwitch).toBeNull();
    await fs_var.rm(root_var, { recursive: true, force: true });
  });

  test('defaults effective family to CLAUDE when model is omitted', async () => {
    const fs_var = await import('node:fs/promises');
    const path_var = await import('node:path');
    const os_var = await import('node:os');

    const root_var = await fs_var.mkdtemp(path_var.default.join(os_var.tmpdir(), 'ag-rotate-family-'));
    const runtime_dir_var = path_var.default.join(root_var, 'runtime');

    const result_var = await decideAndPersistAutoRotate_func({
      cli: {
        prompt: 'hello',
        model: undefined,
        json: false,
        resume: false,
        resumeCascadeId: null,
        background: false,
        help: false,
        timeoutMs: 15000,
      },
      runtimeDir: runtime_dir_var,
      currentAccountId: 'acc-1',
      loadAccounts: async () => [
        {
          id: 'acc-1',
          email: 'one@example.com',
          account_status: 'active',
          last_used: 100,
          quota_cache: {
            subscription_tier: 'ultra',
            families: {
              GEMINI: { remaining_pct: 15, reset_time: null },
              CLAUDE: { remaining_pct: 69, reset_time: null },
            },
            pre_turn_snapshot: {
              families: {
                GEMINI: { remaining_pct: 15 },
                CLAUDE: { remaining_pct: 75 },
              },
              captured_at: 1_700_000_000 - 60,
            },
          },
          rotation: {
            family_buckets: { GEMINI: null, CLAUDE: null, _min: '40' },
          },
        },
        {
          id: 'acc-2',
          email: 'two@example.com',
          account_status: 'active',
          last_used: 50,
          quota_cache: {
            subscription_tier: 'ultra',
            families: {
              GEMINI: { remaining_pct: 90, reset_time: null },
              CLAUDE: { remaining_pct: 88, reset_time: null },
            },
            pre_turn_snapshot: null,
          },
          rotation: {
            family_buckets: { GEMINI: null, CLAUDE: null, _min: null },
          },
        },
      ],
    });

    expect(result_var.pendingSwitch?.target_account_id).toBe('acc-2');
    await fs_var.rm(root_var, { recursive: true, force: true });
  });

  test('pending switch helper applies a persisted record only on explicit message-send helper paths', async () => {
    const fs_var = await import('node:fs/promises');
    const path_var = await import('node:path');
    const os_var = await import('node:os');

    const root_var = await fs_var.mkdtemp(path_var.default.join(os_var.tmpdir(), 'ag-pending-switch-'));
    const runtime_dir_var = path_var.default.join(root_var, 'runtime');
    const applied_var: string[] = [];

    await fs_var.mkdir(runtime_dir_var, { recursive: true });
    await fs_var.writeFile(path_var.default.join(runtime_dir_var, 'pending-switch.json'), JSON.stringify({
      target_account_id: 'acc-2',
      source_account_id: 'acc-1',
      reason: 'rotate',
      pre_turn_pct: 73,
      post_turn_pct: 68,
      bucket_crossed: '70',
      effective_family: 'GEMINI',
      fingerprint_id: null,
      service_machine_id: null,
      applied_at: 1_700_000_000,
    }));

    const read_only_var = await applyPendingSwitchIntentIfNeeded_func({
      cli: {
        prompt: null,
        model: undefined,
        json: false,
        resume: false,
        resumeCascadeId: null,
        background: false,
        help: true,
        timeoutMs: 15000,
      },
      runtimeDir: runtime_dir_var,
      applySelection: async (account_id_var) => {
        applied_var.push(account_id_var);
      },
      nowSeconds: 1_700_000_100,
    });

    expect(read_only_var.applied).toBe(false);
    expect(applied_var).toEqual([]);

    const write_path_var = await applyPendingSwitchIntentIfNeeded_func({
      cli: {
        prompt: 'hello',
        model: undefined,
        json: false,
        resume: false,
        resumeCascadeId: null,
        background: false,
        help: false,
        timeoutMs: 15000,
      },
      runtimeDir: runtime_dir_var,
      applySelection: async (account_id_var) => {
        applied_var.push(account_id_var);
      },
      nowSeconds: 1_700_000_100,
    });

    expect(write_path_var.applied).toBe(true);
    expect(applied_var).toEqual(['acc-2']);
    await fs_var.rm(root_var, { recursive: true, force: true });
  });
});

describe('resolvePostPromptQuotaUpdate_func', () => {
  const cloud_quota_var = {
    cachedAtMs: 1_712_345_678_000,
    subscriptionTier: 'ultra',
    projectId: 'project-1',
    credits: [],
    families: {
      CLAUDE: { remaining_pct: 64, reset_time: '2026-04-20T17:00:00Z' },
    },
    fetchError: null,
    accountStatus: 'active' as const,
  };

  test('uses cloud fallback when local quota is missing', () => {
    const result_var = resolvePostPromptQuotaUpdate_func({
      localQuota: null,
      cloudQuota: cloud_quota_var,
      localQuotaTrusted: false,
      existingOfflineQuotaVerifiedAt: null,
      nowSeconds: 1_712_345_678,
    });

    expect(result_var.needsCloudFetch).toBe(false);
    expect(result_var.lastSource).toBe('cloud');
    expect(result_var.offlineQuotaVerifiedAt).toBeNull();
    expect(result_var.nextQuotaData?.families.CLAUDE.remaining_pct).toBe(64);
  });

  test('uses verified local state.vscdb quota without cloud fetch', () => {
    const result_var = resolvePostPromptQuotaUpdate_func({
      localQuota: {
        subscriptionTier: 'ultra',
        families: {
          CLAUDE: { remaining_pct: 64, reset_time: '2026-04-20T17:00:00Z' },
        },
      },
      cloudQuota: null,
      localQuotaTrusted: true,
      existingOfflineQuotaVerifiedAt: 1_712_300_000,
      nowSeconds: 1_712_345_678,
    });

    expect(result_var.needsCloudFetch).toBe(false);
    expect(result_var.lastSource).toBe('state_vscdb');
    expect(result_var.offlineQuotaVerifiedAt).toBe(1_712_300_000);
    expect(result_var.nextQuotaData?.families.CLAUDE.remaining_pct).toBe(64);
  });

  test('marks local quota verified when unverified local state matches cloud', () => {
    const result_var = resolvePostPromptQuotaUpdate_func({
      localQuota: {
        subscriptionTier: 'ultra',
        families: {
          CLAUDE: { remaining_pct: 64, reset_time: '2026-04-20T17:00:00Z' },
        },
      },
      cloudQuota: cloud_quota_var,
      localQuotaTrusted: false,
      existingOfflineQuotaVerifiedAt: null,
      nowSeconds: 1_712_345_678,
    });

    expect(result_var.needsCloudFetch).toBe(false);
    expect(result_var.lastSource).toBe('state_vscdb');
    expect(result_var.offlineQuotaVerifiedAt).toBe(1_712_345_678);
    expect(result_var.nextQuotaData?.families.CLAUDE.remaining_pct).toBe(64);
  });

  test('falls back to cloud and clears verification when unverified local state mismatches', () => {
    const result_var = resolvePostPromptQuotaUpdate_func({
      localQuota: {
        subscriptionTier: 'ultra',
        families: {
          CLAUDE: { remaining_pct: 80, reset_time: '2026-04-20T18:00:00Z' },
        },
      },
      cloudQuota: cloud_quota_var,
      localQuotaTrusted: false,
      existingOfflineQuotaVerifiedAt: null,
      nowSeconds: 1_712_345_678,
    });

    expect(result_var.needsCloudFetch).toBe(false);
    expect(result_var.lastSource).toBe('cloud');
    expect(result_var.offlineQuotaVerifiedAt).toBeNull();
    expect(result_var.nextQuotaData?.families.CLAUDE.remaining_pct).toBe(64);
  });
});

describe('parseAuthArgv_func', () => {
  test('parses auth refresh with --json', () => {
    expect(parseAuthArgv_func(['--json', 'refresh'])).toEqual({
      subcommand: 'refresh',
      json: true,
    });
  });
});
