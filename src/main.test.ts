import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { HeadlessBackendConfig } from './utils/config.js';

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
  finalizePostRewindSync_func,
  formatFatalErrorForStderr_func,
  formatResumeListEntryLine_func,
  extractJsonLifecycleSessionId_func,
  dedupeLocalConversationRecords_func,
  extractTrajectorySummaryEntries_func,
  findLatestReplayableStepErrorInSteps_func,
  findLiveAuthAccountByEmailFallback_func,
  findLiveAuthAccountByStoredEmail_func,
  findLiveAuthAccountByUserDataDir_func,
  getExitCodeFromError_func,
  hasAnyToolUsageInStepRange_func,
  isRetryableStepErrorForReplay_func,
  joinRuntimeErrorMessages_func,
  normalizeSummaryValueForBundleSchema_func,
  parseArgv_func,
  parseLiveUserStatusJsonToSummary_func,
  pickRecoveryLogSessionDirPath_func,
  prepareReplayAction_func,
  recoverLatestUserFacingErrorMessagesFromSteps_func,
  recoverPlannerResponseTextFromSteps_func,
  ReplayCancelledError,
  resolveCurrentAttemptStepRange_func,
  resolveRewindTargetStepIndex_func,
  resolveRuntimeStatusLineDisplayOptions_func,
  resolveOfflineBootstrapTimeoutMs_func,
  resolveCanonicalModelNameFromEnum_func,
  resolvePostPromptQuotaUpdate_func,
  runAutoReplayLoop_func,
  shouldRewindBeforeReplay_func,
  shouldEmitMissingResponseWarning_func,
  shouldFetchStepsForUpdate_func,
  verifyLiveRewindProfileMatch_func,
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
      'transcript_path: ~/.antigravity-cli/projects/-Users-noseung-gyeong-Dropbox/8ed28f7a-1a83-42fa-b88c-a12dda0af152.jsonl',
      "To continue this session, run antigravity-cli -r 8ed28f7a-1a83-42fa-b88c-a12dda0af152 '<message>'",
    ].join('\n'));
    expect(notice_var).not.toContain('agcl -r');
  });

  test('colors the values when ansi output is enabled', () => {
    const notice_var = buildSessionContinuationNotice_func({
      cascadeId_var: 'cascade-id',
      transcriptPath_var: '/tmp/cascade-id.jsonl',
      homeDirPath_var: '/Users/noseung-gyeong',
      useColor_var: true,
    });

    expect(notice_var).toContain('transcript_path: \u001b[38;5;245m/tmp/cascade-id.jsonl\u001b[0m');
    expect(notice_var).toContain("To continue this session, run \u001b[38;5;49mantigravity-cli -r cascade-id '<message>'\u001b[0m");
    expect(notice_var).not.toContain('agcl -r');
  });
});

describe('joinRuntimeErrorMessages_func', () => {
  test('joins unique non-empty messages into a single event line', () => {
    expect(joinRuntimeErrorMessages_func([
      'UNAVAILABLE (code 503): No capacity available',
      'Our servers are experiencing high traffic right now',
      'UNAVAILABLE (code 503): No capacity available',
      '   ',
    ])).toBe(
      'UNAVAILABLE (code 503): No capacity available · Our servers are experiencing high traffic right now',
    );
  });

  test('returns null when every message is empty', () => {
    expect(joinRuntimeErrorMessages_func(['', '   '])).toBeNull();
  });
});

describe('resolveRuntimeStatusLineDisplayOptions_func', () => {
  test('keeps the runtime status line interactive even when NO_COLOR is set', () => {
    expect(resolveRuntimeStatusLineDisplayOptions_func({
      stderrIsTTY_var: true,
      term_var: 'xterm-256color',
      noColor_var: '1',
    })).toEqual({
      interactive_var: true,
      useColor_var: false,
    });
  });

  test('disables the runtime status line on dumb terminals', () => {
    expect(resolveRuntimeStatusLineDisplayOptions_func({
      stderrIsTTY_var: true,
      term_var: 'dumb',
      noColor_var: null,
    })).toEqual({
      interactive_var: false,
      useColor_var: false,
    });
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
  test('STOP_PATTERN + toolCalls only success planner is appended to transcript but does not produce response text', () => {
    const steps_var = [
      {
        type: 'CORTEX_STEP_TYPE_USER_INPUT',
        status: 'CORTEX_STEP_STATUS_DONE',
        metadata: {
          executionId: 'exec-success',
        },
      },
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        status: 'CORTEX_STEP_STATUS_DONE',
        metadata: {
          executionId: 'exec-success',
          completedAt: '2026-04-22T10:00:00.000Z',
          finishedGeneratingAt: '2026-04-22T10:00:01.000Z',
        },
        plannerResponse: {
          messageId: 'bot-1',
          stopReason: 'STOP_REASON_STOP_PATTERN',
          toolCalls: [{ name: 'write_to_file' }],
        },
      },
    ] satisfies Array<Record<string, unknown>>;

    const plan_var = collectFetchedStepEvents_func(
      steps_var,
      createFetchedStepAppendState_func(),
      new Set(),
    );

    expect(plan_var.transcriptEntries_var).toEqual([
      { index: 0, step: steps_var[0] },
      { index: 1, step: steps_var[1] },
    ]);
    expect(plan_var.stdoutEntries_var).toEqual(plan_var.transcriptEntries_var);
    expect(plan_var.responseText_var).toBeNull();
    expect(plan_var.hasTerminalSuccess_var).toBe(true);
    expect(plan_var.nextState_var).toEqual({
      lastAppendedIndex_var: 1,
      lastFetchedStepCount_var: 2,
      deferredEntries_var: [],
    });
  });

  test('CLIENT_STREAM_ERROR planner stub is not appended, errorMessage remains, stale success from ignoredExecutionId is dropped', () => {
    const first_snapshot_var = [
      {
        type: 'CORTEX_STEP_TYPE_USER_INPUT',
        status: 'CORTEX_STEP_STATUS_DONE',
        metadata: {
          executionId: 'exec-user',
        },
      },
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        status: 'CORTEX_STEP_STATUS_DONE',
        metadata: {
          executionId: 'exec-stale',
          completedAt: '2026-04-22T10:00:00.000Z',
          finishedGeneratingAt: '2026-04-22T10:00:01.000Z',
        },
        plannerResponse: {
          stopReason: 'STOP_REASON_CLIENT_STREAM_ERROR',
        },
      },
      {
        type: 'CORTEX_STEP_TYPE_ERROR_MESSAGE',
        status: 'CORTEX_STEP_STATUS_DONE',
        errorMessage: {
          error: {
            errorCode: 503,
            shortError: 'UNAVAILABLE (code 503): No capacity available',
            userErrorMessage: 'try again',
          },
        },
      },
    ] satisfies Array<Record<string, unknown>>;

    const first_plan_var = collectFetchedStepEvents_func(
      first_snapshot_var,
      createFetchedStepAppendState_func(),
      new Set(),
    );

    expect(first_plan_var.transcriptEntries_var).toEqual([
      { index: 0, step: first_snapshot_var[0] },
      { index: 2, step: first_snapshot_var[2] },
    ]);
    expect(first_plan_var.latestReplayableStepErrorCandidate_var).toMatchObject({
      stepIndex_var: 2,
      ignoredExecutionId_var: 'exec-stale',
      errorDetails_var: {
        errorCode: 503,
      },
    });

    const ignored_execution_ids_var = new Set<string>(['exec-stale']);
    const replay_snapshot_var = [
      ...first_snapshot_var,
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        status: 'CORTEX_STEP_STATUS_DONE',
        metadata: {
          executionId: 'exec-stale',
          completedAt: '2026-04-22T10:00:03.000Z',
          finishedGeneratingAt: '2026-04-22T10:00:04.000Z',
        },
        plannerResponse: {
          stopReason: 'STOP_REASON_STOP_PATTERN',
          response: 'stale success',
        },
      },
      {
        type: 'CORTEX_STEP_TYPE_CHECKPOINT',
        status: 'CORTEX_STEP_STATUS_DONE',
        metadata: {
          executionId: 'exec-stale',
          completedAt: '2026-04-22T10:00:05.000Z',
        },
      },
    ] satisfies Array<Record<string, unknown>>;

    const replay_plan_var = collectFetchedStepEvents_func(
      replay_snapshot_var,
      first_plan_var.nextState_var,
      ignored_execution_ids_var,
    );

    expect(replay_plan_var.transcriptEntries_var).toEqual([]);
    expect(replay_plan_var.stdoutEntries_var).toEqual([]);
    expect(replay_plan_var.responseText_var).toBeNull();
    expect(replay_plan_var.hasTerminalSuccess_var).toBe(false);
    expect(replay_plan_var.nextState_var).toEqual({
      lastAppendedIndex_var: 2,
      lastFetchedStepCount_var: 5,
      deferredEntries_var: [],
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

describe('normalizeSummaryValueForBundleSchema_func', () => {
  test('converts ISO timestamp strings in summary and nested messages to Timestamp-like objects', () => {
    const schema_var = {
      fields: [
        {
          localName: 'createdTime',
          fieldKind: 'message',
          message: { typeName: 'google.protobuf.Timestamp' },
        },
        {
          localName: 'status',
          fieldKind: 'enum',
          enum: {
            values: [
              { name: 'CASCADE_RUN_STATUS_UNSPECIFIED', localName: 'UNSPECIFIED', number: 0 },
              { name: 'CASCADE_RUN_STATUS_IDLE', localName: 'IDLE', number: 1 },
            ],
          },
        },
        {
          localName: 'trajectoryMetadata',
          fieldKind: 'message',
          message: {
            fields: [
              {
                localName: 'createdAt',
                fieldKind: 'message',
                message: { typeName: 'google.protobuf.Timestamp' },
              },
            ],
          },
        },
        {
          localName: 'annotations',
          fieldKind: 'message',
          message: {
            fields: [
              {
                localName: 'lastUserViewTime',
                fieldKind: 'message',
                message: { typeName: 'google.protobuf.Timestamp' },
              },
            ],
          },
        },
      ],
    };

    const normalized_var = normalizeSummaryValueForBundleSchema_func({
      createdTime: '2026-04-22T06:10:29.615579Z',
      status: 'CASCADE_RUN_STATUS_IDLE',
      trajectoryMetadata: {
        createdAt: '2026-04-22T06:10:29.615579Z',
      },
      annotations: {
        lastUserViewTime: '2026-04-22T06:10:32.123Z',
      },
    }, schema_var);

    expect(normalized_var).toEqual({
      createdTime: {
        seconds: 1776838229n,
        nanos: 615579000,
      },
      status: 1,
      trajectoryMetadata: {
        createdAt: {
          seconds: 1776838229n,
          nanos: 615579000,
        },
      },
      annotations: {
        lastUserViewTime: {
          seconds: 1776838232n,
          nanos: 123000000,
        },
      },
    });
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
        status: 'CORTEX_STEP_STATUS_DONE',
        metadata: {
          completedAt: '2026-04-22T10:00:00.000Z',
          finishedGeneratingAt: '2026-04-22T10:00:01.000Z',
        },
        plannerResponse: {
          stopReason: 'STOP_REASON_STOP_PATTERN',
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
        status: 'CORTEX_STEP_STATUS_DONE',
        metadata: {
          completedAt: '2026-04-22T10:00:00.000Z',
          finishedGeneratingAt: '2026-04-22T10:00:01.000Z',
        },
        plannerResponse: {
          stopReason: 'STOP_REASON_STOP_PATTERN',
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
        status: 'CORTEX_STEP_STATUS_DONE',
        metadata: {
          completedAt: '2026-04-22T10:00:00.000Z',
          finishedGeneratingAt: '2026-04-22T10:00:01.000Z',
        },
        plannerResponse: {
          stopReason: 'STOP_REASON_STOP_PATTERN',
          modifiedResponse: '',
        },
      },
      {
        type: 'CORTEX_STEP_TYPE_VIEW_FILE',
      },
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        status: 'CORTEX_STEP_STATUS_DONE',
        metadata: {
          completedAt: '2026-04-22T10:00:02.000Z',
          finishedGeneratingAt: '2026-04-22T10:00:03.000Z',
        },
        plannerResponse: {
          stopReason: 'STOP_REASON_STOP_PATTERN',
          text: 'final text',
        },
      },
    ]);

    expect(response_var).toBe('final text');
  });

  test('ignores planner text when the planner step is not a terminal success', () => {
    const response_var = recoverPlannerResponseTextFromSteps_func([
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        status: 'CORTEX_STEP_STATUS_GENERATING',
        metadata: {
          completedAt: '2026-04-22T10:00:00.000Z',
          finishedGeneratingAt: '2026-04-22T10:00:01.000Z',
        },
        plannerResponse: {
          stopReason: 'STOP_REASON_STOP_PATTERN',
          response: 'still generating',
        },
      },
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        status: 'CORTEX_STEP_STATUS_DONE',
        metadata: {
          completedAt: '2026-04-22T10:00:02.000Z',
          finishedGeneratingAt: '2026-04-22T10:00:03.000Z',
        },
        plannerResponse: {
          stopReason: 'STOP_REASON_CLIENT_STREAM_ERROR',
          response: 'failed response',
        },
      },
    ]);

    expect(response_var).toBeNull();
  });
});

describe('shouldEmitMissingResponseWarning_func', () => {
  test('suppresses warning for textless terminal success', () => {
    expect(shouldEmitMissingResponseWarning_func({
      finalResponseText_var: null,
      latestErrorMessages_var: [],
      hasTerminalSuccess_var: true,
    })).toBe(false);
  });

  test('emits warning only when there is neither response, error, nor terminal success', () => {
    expect(shouldEmitMissingResponseWarning_func({
      finalResponseText_var: null,
      latestErrorMessages_var: [],
      hasTerminalSuccess_var: false,
    })).toBe(true);
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
  function buildStep_var(options_var: {
    type: string;
    executionId_var?: string | null;
    status_var?: string;
    plannerResponse_var?: Record<string, unknown>;
    errorMessage_var?: Record<string, unknown>;
  }): Record<string, unknown> {
    const status_var = options_var.status_var ?? 'CORTEX_STEP_STATUS_DONE';
    const metadata_var: Record<string, unknown> = {};
    if (options_var.executionId_var !== undefined && options_var.executionId_var !== null) {
      metadata_var.executionId = options_var.executionId_var;
    }
    if (status_var === 'CORTEX_STEP_STATUS_DONE' && options_var.type !== 'CORTEX_STEP_TYPE_ERROR_MESSAGE') {
      metadata_var.completedAt = '2026-04-23T00:00:00.000Z';
      if (options_var.type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
        metadata_var.finishedGeneratingAt = '2026-04-23T00:00:01.000Z';
      }
    }

    return {
      type: options_var.type,
      status: status_var,
      ...(Object.keys(metadata_var).length > 0 ? { metadata: metadata_var } : {}),
      ...(options_var.plannerResponse_var ? { plannerResponse: options_var.plannerResponse_var } : {}),
      ...(options_var.errorMessage_var ? { errorMessage: options_var.errorMessage_var } : {}),
    };
  }

  function buildRetryableErrorMessageStep_var(): Record<string, unknown> {
    return buildStep_var({
      type: 'CORTEX_STEP_TYPE_ERROR_MESSAGE',
      errorMessage_var: {
        error: {
          errorCode: 503,
          shortError: 'UNAVAILABLE (code 503): No capacity available for model claude-opus-4-6-thinking on the server',
          userErrorMessage: 'Our servers are experiencing high traffic right now, please try again in a minute.',
        },
      },
    });
  }

  function buildReplayCandidate_var(step_index_var: number, execution_id_var: string | null) {
    return {
      errorDetails_var: {
        errorCode: 503,
        shortError: 'UNAVAILABLE (code 503): No capacity available for model claude-opus-4-6-thinking on the server',
        userErrorMessage: 'Our servers are experiencing high traffic right now, please try again in a minute.',
        modelErrorMessage: null,
        fullError: null,
        details: null,
        rpcErrorDetails: [],
      },
      stepIndex_var: step_index_var,
      ignoredExecutionId_var: execution_id_var,
    };
  }

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
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        status: 'CORTEX_STEP_STATUS_DONE',
        metadata: {
          executionId: 'exec-before-error',
          completedAt: '2026-04-22T10:00:00.000Z',
          finishedGeneratingAt: '2026-04-22T10:00:01.000Z',
        },
        plannerResponse: {
          stopReason: 'STOP_REASON_CLIENT_STREAM_ERROR',
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

    expect(candidate_var).toMatchObject({
      stepIndex_var: 1,
      ignoredExecutionId_var: 'exec-before-error',
      errorDetails_var: {
        errorCode: 503,
      },
    });
    expect(candidate_var?.errorDetails_var.shortError).toContain('UNAVAILABLE');
  });

  test('builds replay prompt with XML markers and raw original prompt', () => {
    const replay_prompt_var = buildReplayPrompt_func('before ]]> after');

    expect(replay_prompt_var).toBe([
      '<system-reminder>',
      'A previous attempt failed due to a transient server-side error. Continue the user\'s original request below.',
      '<previous-user-prompt>',
      'before ]]> after',
      '</previous-user-prompt>',
      '</system-reminder>',
    ].join('\n'));
    expect(replay_prompt_var).not.toContain('<![CDATA[');
  });

  test('resolves current attempt as the whole range after the latest user_input, not only the latest executionId', () => {
    const steps_var = [
      buildStep_var({ type: 'CORTEX_STEP_TYPE_USER_INPUT', executionId_var: 'exec-user' }),
      buildStep_var({ type: 'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE', executionId_var: 'exec-user' }),
      buildStep_var({
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        executionId_var: 'exec-A',
        plannerResponse_var: { toolCalls: [{ toolName: 'mcp_tool' }] },
      }),
      buildStep_var({ type: 'CORTEX_STEP_TYPE_MCP_TOOL', executionId_var: 'exec-A' }),
      buildStep_var({ type: 'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE', executionId_var: 'exec-A' }),
      buildStep_var({
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        executionId_var: 'exec-B',
        status_var: 'CORTEX_STEP_STATUS_GENERATING',
        plannerResponse_var: { thinking: '...' },
      }),
      buildStep_var({ type: 'CORTEX_STEP_TYPE_CHECKPOINT', executionId_var: 'exec-B' }),
      buildRetryableErrorMessageStep_var(),
    ];

    const range_var = resolveCurrentAttemptStepRange_func(
      steps_var,
      buildReplayCandidate_var(7, 'exec-B'),
    );

    expect(range_var).toMatchObject({
      startIndex_var: 0,
      endIndex_var: 7,
      userInputIndex_var: 0,
      anchorExecutionId_var: 'exec-B',
    });
    expect(range_var?.executionGroups_var.map((group_var) => group_var.executionId_var)).toEqual([
      'exec-user',
      'exec-A',
      'exec-B',
      null,
    ]);
  });

  test('returns no current attempt range when the replay candidate is older than the latest user_input', () => {
    const steps_var = [
      buildStep_var({ type: 'CORTEX_STEP_TYPE_USER_INPUT', executionId_var: 'exec-old' }),
      buildRetryableErrorMessageStep_var(),
      buildStep_var({ type: 'CORTEX_STEP_TYPE_USER_INPUT', executionId_var: 'exec-new' }),
    ];

    expect(resolveCurrentAttemptStepRange_func(
      steps_var,
      buildReplayCandidate_var(1, 'exec-old'),
    )).toBeNull();
  });

  test('does not classify planner, checkpoint, history, knowledge, or error steps as tool usage', () => {
    const steps_var = [
      buildStep_var({ type: 'CORTEX_STEP_TYPE_USER_INPUT', executionId_var: 'exec-1' }),
      buildStep_var({ type: 'CORTEX_STEP_TYPE_CONVERSATION_HISTORY', executionId_var: 'exec-1' }),
      buildStep_var({ type: 'CORTEX_STEP_TYPE_KNOWLEDGE_ARTIFACTS', executionId_var: 'exec-1' }),
      buildStep_var({ type: 'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE', executionId_var: 'exec-1' }),
      buildStep_var({
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        executionId_var: 'exec-1',
        status_var: 'CORTEX_STEP_STATUS_GENERATING',
        plannerResponse_var: { thinking: '...' },
      }),
      buildStep_var({ type: 'CORTEX_STEP_TYPE_CHECKPOINT', executionId_var: 'exec-1' }),
      buildRetryableErrorMessageStep_var(),
    ];

    const range_var = resolveCurrentAttemptStepRange_func(
      steps_var,
      buildReplayCandidate_var(6, 'exec-1'),
    )!;

    expect(hasAnyToolUsageInStepRange_func(steps_var, range_var)).toBe(false);
  });

  test('classifies actual tool/result step types as tool usage even when planner toolCalls is empty', () => {
    const steps_var = [
      buildStep_var({ type: 'CORTEX_STEP_TYPE_USER_INPUT', executionId_var: 'exec-1' }),
      buildStep_var({ type: 'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE', executionId_var: 'exec-1' }),
      buildStep_var({
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        executionId_var: 'exec-1',
        status_var: 'CORTEX_STEP_STATUS_GENERATING',
        plannerResponse_var: { thinking: '...', response: '조사 중입니다.' },
      }),
      buildStep_var({ type: 'CORTEX_STEP_TYPE_VIEW_FILE', executionId_var: 'exec-1' }),
      buildRetryableErrorMessageStep_var(),
    ];

    const range_var = resolveCurrentAttemptStepRange_func(
      steps_var,
      buildReplayCandidate_var(4, 'exec-1'),
    )!;

    expect(hasAnyToolUsageInStepRange_func(steps_var, range_var)).toBe(true);
  });

  test('allows rewind for a thinking-only whole attempt', () => {
    const steps_var = [
      buildStep_var({ type: 'CORTEX_STEP_TYPE_USER_INPUT', executionId_var: 'exec-1' }),
      buildStep_var({ type: 'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE', executionId_var: 'exec-1' }),
      buildStep_var({
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        executionId_var: 'exec-1',
        status_var: 'CORTEX_STEP_STATUS_GENERATING',
        plannerResponse_var: { thinking: '...' },
      }),
      buildStep_var({ type: 'CORTEX_STEP_TYPE_CHECKPOINT', executionId_var: 'exec-1' }),
      buildRetryableErrorMessageStep_var(),
    ];

    const range_var = resolveCurrentAttemptStepRange_func(
      steps_var,
      buildReplayCandidate_var(4, 'exec-1'),
    )!;

    expect(shouldRewindBeforeReplay_func(steps_var, range_var)).toEqual({
      shouldRewind_var: true,
      hasAssistantVisibleOutput_var: false,
      hasPlannerToolCall_var: false,
      hasToolUsageStep_var: false,
    });
  });

  test('blocks rewind when assistant-visible output already exists in the attempt range', () => {
    const steps_var = [
      buildStep_var({ type: 'CORTEX_STEP_TYPE_USER_INPUT', executionId_var: 'exec-1' }),
      buildStep_var({ type: 'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE', executionId_var: 'exec-1' }),
      buildStep_var({
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        executionId_var: 'exec-1',
        plannerResponse_var: {
          stopReason: 'STOP_REASON_STOP_PATTERN',
          response: '이미 답변이 나갔습니다.',
          modifiedResponse: '이미 답변이 나갔습니다.',
        },
      }),
      buildRetryableErrorMessageStep_var(),
    ];

    const range_var = resolveCurrentAttemptStepRange_func(
      steps_var,
      buildReplayCandidate_var(3, 'exec-1'),
    )!;

    expect(shouldRewindBeforeReplay_func(steps_var, range_var)).toMatchObject({
      shouldRewind_var: false,
      hasAssistantVisibleOutput_var: true,
    });
  });

  test('blocks rewind when planner toolCalls exists in the attempt range', () => {
    const steps_var = [
      buildStep_var({ type: 'CORTEX_STEP_TYPE_USER_INPUT', executionId_var: 'exec-1' }),
      buildStep_var({
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        executionId_var: 'exec-1',
        plannerResponse_var: { toolCalls: [{ toolName: 'run_command' }] },
      }),
      buildRetryableErrorMessageStep_var(),
    ];

    const range_var = resolveCurrentAttemptStepRange_func(
      steps_var,
      buildReplayCandidate_var(2, 'exec-1'),
    )!;

    expect(shouldRewindBeforeReplay_func(steps_var, range_var)).toMatchObject({
      shouldRewind_var: false,
      hasPlannerToolCall_var: true,
    });
  });

  test('blocks rewind for a multi-execution attempt when an earlier execution already used tools', () => {
    const steps_var = [
      buildStep_var({ type: 'CORTEX_STEP_TYPE_USER_INPUT', executionId_var: 'exec-user' }),
      buildStep_var({ type: 'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE', executionId_var: 'exec-user' }),
      buildStep_var({
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        executionId_var: 'exec-A',
        plannerResponse_var: { toolCalls: [{ toolName: 'list_resources' }] },
      }),
      buildStep_var({ type: 'CORTEX_STEP_TYPE_MCP_TOOL', executionId_var: 'exec-A' }),
      buildStep_var({
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        executionId_var: 'exec-B',
        status_var: 'CORTEX_STEP_STATUS_GENERATING',
        plannerResponse_var: { thinking: '...' },
      }),
      buildStep_var({ type: 'CORTEX_STEP_TYPE_CHECKPOINT', executionId_var: 'exec-B' }),
      buildRetryableErrorMessageStep_var(),
    ];

    const range_var = resolveCurrentAttemptStepRange_func(
      steps_var,
      buildReplayCandidate_var(6, 'exec-B'),
    )!;

    expect(shouldRewindBeforeReplay_func(steps_var, range_var)).toMatchObject({
      shouldRewind_var: false,
      hasPlannerToolCall_var: true,
      hasToolUsageStep_var: true,
    });
  });

  test('treats same-execution planner/view/run/command-status chain as tool usage', () => {
    const steps_var = [
      buildStep_var({ type: 'CORTEX_STEP_TYPE_USER_INPUT', executionId_var: 'exec-1' }),
      buildStep_var({
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        executionId_var: 'exec-1',
        plannerResponse_var: { toolCalls: [{ toolName: 'view_file' }] },
      }),
      buildStep_var({ type: 'CORTEX_STEP_TYPE_VIEW_FILE', executionId_var: 'exec-1' }),
      buildStep_var({
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        executionId_var: 'exec-1',
        plannerResponse_var: { toolCalls: [{ toolName: 'run_command' }], response: '실행합니다.' },
      }),
      buildStep_var({ type: 'CORTEX_STEP_TYPE_RUN_COMMAND', executionId_var: 'exec-1' }),
      buildStep_var({ type: 'CORTEX_STEP_TYPE_COMMAND_STATUS', executionId_var: 'exec-1' }),
      buildRetryableErrorMessageStep_var(),
    ];

    const range_var = resolveCurrentAttemptStepRange_func(
      steps_var,
      buildReplayCandidate_var(6, 'exec-1'),
    )!;

    expect(hasAnyToolUsageInStepRange_func(steps_var, range_var)).toBe(true);
  });

  test('rewind target uses the last finalizable step before user_input instead of execution split boundaries', () => {
    const steps_var = [
      buildStep_var({ type: 'CORTEX_STEP_TYPE_USER_INPUT', executionId_var: 'exec-prev' }),
      buildStep_var({ type: 'CORTEX_STEP_TYPE_ERROR_MESSAGE', errorMessage_var: { error: { shortError: 'old error' } } }),
      buildStep_var({ type: 'CORTEX_STEP_TYPE_USER_INPUT', executionId_var: 'exec-current-a' }),
      buildStep_var({
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        executionId_var: 'exec-current-a',
        status_var: 'CORTEX_STEP_STATUS_GENERATING',
        plannerResponse_var: { thinking: '...' },
      }),
      buildStep_var({ type: 'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE', executionId_var: 'exec-current-b' }),
      buildStep_var({
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        executionId_var: 'exec-current-b',
        status_var: 'CORTEX_STEP_STATUS_GENERATING',
        plannerResponse_var: { thinking: '...' },
      }),
      buildRetryableErrorMessageStep_var(),
    ];

    const range_var = resolveCurrentAttemptStepRange_func(
      steps_var,
      buildReplayCandidate_var(6, 'exec-current-b'),
    )!;

    expect(resolveRewindTargetStepIndex_func(steps_var, range_var)).toBe(1);
  });

  test('rewind target becomes -1 for the first prompt with no earlier finalizable step', () => {
    const steps_var = [
      buildStep_var({ type: 'CORTEX_STEP_TYPE_USER_INPUT', executionId_var: 'exec-1' }),
      buildStep_var({ type: 'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE', executionId_var: 'exec-1' }),
      buildStep_var({
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        executionId_var: 'exec-1',
        status_var: 'CORTEX_STEP_STATUS_GENERATING',
        plannerResponse_var: { thinking: '...' },
      }),
      buildRetryableErrorMessageStep_var(),
    ];

    const range_var = resolveCurrentAttemptStepRange_func(
      steps_var,
      buildReplayCandidate_var(3, 'exec-1'),
    )!;

    expect(resolveRewindTargetStepIndex_func(steps_var, range_var)).toBe(-1);
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

  test('does not replay when response text and retryable 503 step coexist', async () => {
    const prompts_var: string[] = [];

    await runAutoReplayLoop_func({
      original_prompt_var: '계속 해라고',
      runAttempt_func: async (prompt_text_var) => {
        prompts_var.push(prompt_text_var);
        return {
          finalResponseText_var: 'complete response',
          latestErrorMessages_var: [],
          latestReplayableStepErrorCandidate_var: {
            errorDetails_var: buildRetryable503Error_var(),
            stepIndex_var: 7,
            ignoredExecutionId_var: 'exec-1',
          },
          timedOut_var: false,
          streamError_var: null,
        };
      },
      detectRecoverySignal_func: () => null,
    });

    expect(prompts_var).toEqual(['계속 해라고']);
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
          latestReplayableStepErrorCandidate_var: null,
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
            finalResponseText_var: null,
            latestErrorMessages_var: [],
            latestReplayableStepErrorCandidate_var: {
              errorDetails_var: buildRetryable503Error_var(),
              stepIndex_var: attempt_index_var,
              ignoredExecutionId_var: `exec-${attempt_index_var}`,
            },
            timedOut_var: false,
            streamError_var: null,
          };
        }

        return {
          finalResponseText_var: 'success after retries',
          latestErrorMessages_var: [],
          latestReplayableStepErrorCandidate_var: null,
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
          finalResponseText_var: null,
          latestErrorMessages_var: [],
          latestReplayableStepErrorCandidate_var: {
            errorDetails_var: buildRetryable503Error_var(),
            stepIndex_var: 1,
            ignoredExecutionId_var: 'exec-1',
          },
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

  test('accumulates ignored execution ids across replay attempts', async () => {
    const seen_ignored_sets_var: string[][] = [];
    let attempt_index_var = 0;

    await runAutoReplayLoop_func({
      original_prompt_var: '계속 해라고',
      runAttempt_func: async (_prompt_text_var, _is_replay_var, ignored_execution_ids_var) => {
        seen_ignored_sets_var.push([...ignored_execution_ids_var].sort());
        attempt_index_var += 1;

        if (attempt_index_var === 1) {
          return {
            finalResponseText_var: null,
            latestErrorMessages_var: [],
            latestReplayableStepErrorCandidate_var: {
              errorDetails_var: buildRetryable503Error_var(),
              stepIndex_var: 1,
              ignoredExecutionId_var: 'exec-A',
            },
            timedOut_var: false,
            streamError_var: null,
          };
        }

        if (attempt_index_var === 2) {
          return {
            finalResponseText_var: null,
            latestErrorMessages_var: [],
            latestReplayableStepErrorCandidate_var: {
              errorDetails_var: buildRetryable503Error_var(),
              stepIndex_var: 2,
              ignoredExecutionId_var: 'exec-B',
            },
            timedOut_var: false,
            streamError_var: null,
          };
        }

        return {
          finalResponseText_var: 'done',
          latestErrorMessages_var: [],
          latestReplayableStepErrorCandidate_var: null,
          timedOut_var: false,
          streamError_var: null,
        };
      },
      detectRecoverySignal_func: () => null,
    });

    expect(seen_ignored_sets_var).toEqual([
      [],
      ['exec-A'],
      ['exec-A', 'exec-B'],
    ]);
  });

  test('keeps the original prompt and does not accumulate ignored execution ids on rewind replay path', async () => {
    const prompts_var: string[] = [];
    const seen_ignored_sets_var: string[][] = [];
    let attempt_index_var = 0;

    await runAutoReplayLoop_func({
      original_prompt_var: '원본 프롬프트',
      runAttempt_func: async (prompt_text_var, _is_replay_var, ignored_execution_ids_var) => {
        prompts_var.push(prompt_text_var);
        seen_ignored_sets_var.push([...ignored_execution_ids_var].sort());
        attempt_index_var += 1;

        if (attempt_index_var === 1) {
          return {
            finalResponseText_var: null,
            latestErrorMessages_var: [],
            latestReplayableStepErrorCandidate_var: {
              errorDetails_var: buildRetryable503Error_var(),
              stepIndex_var: 1,
              ignoredExecutionId_var: 'exec-rewind',
            },
            timedOut_var: false,
            streamError_var: null,
          };
        }

        return {
          finalResponseText_var: 'rewind success',
          latestErrorMessages_var: [],
          latestReplayableStepErrorCandidate_var: null,
          timedOut_var: false,
          streamError_var: null,
        };
      },
      detectRecoverySignal_func: () => null,
      prepareReplayAction_func: async () => ({
        replayKind_var: 'rewind',
        nextPromptText_var: '원본 프롬프트',
        ignoredExecutionId_var: null,
      }),
    });

    expect(prompts_var).toEqual(['원본 프롬프트', '원본 프롬프트']);
    expect(seen_ignored_sets_var).toEqual([[], []]);
  });

  test('surfaces REWIND_ABORTED immediately and does not degrade to wrapper replay', async () => {
    const prompts_var: string[] = [];

    await expect(runAutoReplayLoop_func({
      original_prompt_var: '원본 프롬프트',
      runAttempt_func: async (prompt_text_var) => {
        prompts_var.push(prompt_text_var);
        return {
          finalResponseText_var: null,
          latestErrorMessages_var: [],
          latestReplayableStepErrorCandidate_var: {
            errorDetails_var: buildRetryable503Error_var(),
            stepIndex_var: 1,
            ignoredExecutionId_var: 'exec-rewind',
          },
          timedOut_var: false,
          streamError_var: null,
        };
      },
      detectRecoverySignal_func: () => null,
      prepareReplayAction_func: async () => {
        throw new Error('REWIND_ABORTED: revert_rpc_failed');
      },
    })).rejects.toThrow('REWIND_ABORTED');

    expect(prompts_var).toEqual(['원본 프롬프트']);
  });

  test('rewrites transcript before raising validation failure after rewind', () => {
    const transcript_dir_var = mkdtempSync(path.join(tmpdir(), 'ag-rewind-sync-'));
    const transcript_path_var = path.join(transcript_dir_var, 'rewind.jsonl');
    writeFileSync(
      transcript_path_var,
      `${JSON.stringify({ index: 99, step: { type: 'CORTEX_STEP_TYPE_STALE' } })}\n`,
      'utf8',
    );

    const post_revert_steps_var = [
      {
        type: 'CORTEX_STEP_TYPE_USER_INPUT',
        status: 'CORTEX_STEP_STATUS_DONE',
        metadata: {
          executionId: 'exec-1',
          completedAt: '2026-04-23T00:00:00.000Z',
        },
      },
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        status: 'CORTEX_STEP_STATUS_DONE',
        metadata: {
          executionId: 'exec-1',
          completedAt: '2026-04-23T00:00:00.000Z',
          finishedGeneratingAt: '2026-04-23T00:00:01.000Z',
        },
        plannerResponse: { response: '되감기 후 응답' },
      },
    ];

    expect(() => finalizePostRewindSync_func({
      transcript_path_var,
      post_revert_steps_var,
      rewind_to_step_index_var: 0,
      user_input_index_var: 2,
    })).toThrow('REWIND_ABORTED: validation_failed');

    const rewritten_entries_var = readFileSync(transcript_path_var, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line_var) => JSON.parse(line_var) as { index: number; step: { type: string } });
    const expected_entries_var = collectFetchedStepEvents_func(
      post_revert_steps_var,
      createFetchedStepAppendState_func(),
      new Set(),
    ).transcriptEntries_var.map((entry_var) => ({
      index: entry_var.index,
      step: { type: String(entry_var.step.type) },
    }));

    expect(rewritten_entries_var.map((entry_var) => ({
      index: entry_var.index,
      step: { type: entry_var.step.type },
    }))).toEqual(expected_entries_var);
  });

  test('aborts rewind when transcript rewrite fails and keeps the warning log', () => {
    const transcript_dir_var = mkdtempSync(path.join(tmpdir(), 'ag-rewind-sync-fail-'));
    const warning_messages_var: string[] = [];
    const post_revert_steps_var = [
      {
        type: 'CORTEX_STEP_TYPE_USER_INPUT',
        status: 'CORTEX_STEP_STATUS_DONE',
        metadata: {
          executionId: 'exec-1',
          completedAt: '2026-04-23T00:00:00.000Z',
        },
      },
    ];

    expect(() => finalizePostRewindSync_func({
      transcript_path_var: transcript_dir_var,
      post_revert_steps_var,
      rewind_to_step_index_var: 0,
      user_input_index_var: 1,
      warningLogger_func: (warning_text_var) => {
        warning_messages_var.push(warning_text_var);
      },
    })).toThrow('REWIND_ABORTED: transcript_sync_failed');

    expect(warning_messages_var).toHaveLength(1);
    expect(warning_messages_var[0]).toContain('transcript_rewrite_failed=true');
  });

  test('falls back to wrapper replay when live rewind precheck mismatches and skips rewind rpc', async () => {
    let rewind_rpc_calls_var = 0;
    const replayable_candidate_var = {
      errorDetails_var: {
        errorCode: 503,
        shortError: 'UNAVAILABLE (code 503): No capacity available for model claude-opus-4-6-thinking on the server',
        userErrorMessage: 'Our servers are experiencing high traffic right now, please try again in a minute.',
        modelErrorMessage: null,
        fullError: null,
        details: null,
        rpcErrorDetails: [],
      },
      stepIndex_var: 1,
      ignoredExecutionId_var: 'exec-rewind',
    };

    const prepared_action_var = await prepareReplayAction_func({
      discovery_var: {
        pid: 1,
        httpsPort: 8443,
        csrfToken: 'csrf-token',
      },
      config_var: {
        appPath: '/Applications/Antigravity.app',
        certPath: '/tmp/cert.pem',
        env: {} as never,
        extensionVersion: '1.0.0',
        extensionRootPath: '/tmp/ext',
        homeDirPath: '/Users/test',
        ideVersion: '1.20.6',
        stateDbPath: '/tmp/state.vscdb',
      } as unknown as HeadlessBackendConfig,
      cli_var: {
        prompt: '원본 프롬프트',
        model: undefined,
        json: false,
        resume: false,
        resumeCascadeId: null,
        background: false,
        help: false,
        timeoutMs: 15_000,
      },
      cascade_id_var: 'cascade-id',
      transcript_path_var: '/tmp/transcript.jsonl',
      original_prompt_var: '원본 프롬프트',
      cascade_config_var: {
        planModel: 1026,
        requestedModel: { kind: 'model', value: 1026 },
        agenticMode: true,
      },
      replayable_candidate_var,
      ignored_execution_ids_var: new Set(),
      live_rewind_context_var: {
        activeAccountName_var: 'default',
        cliDir_var: '/tmp/cli',
        defaultDataDir_var: '/tmp/default-data',
      },
      deps_var: {
        fetchTrajectoryStepsSnapshot_func: async () => [
          {
            type: 'CORTEX_STEP_TYPE_USER_INPUT',
            status: 'CORTEX_STEP_STATUS_DONE',
            metadata: {
              executionId: 'exec-1',
              completedAt: '2026-04-23T00:00:00.000Z',
            },
          },
          {
            type: 'CORTEX_STEP_TYPE_ERROR_MESSAGE',
            status: 'CORTEX_STEP_STATUS_DONE',
            errorMessage: {
              error: {
                errorCode: 503,
                shortError: 'UNAVAILABLE (code 503): No capacity available for model claude-opus-4-6-thinking on the server',
                userErrorMessage: 'Our servers are experiencing high traffic right now, please try again in a minute.',
              },
            },
          },
        ],
        verifyLiveRewindProfileMatch_func: async () => ({
          status: 'mismatch',
          reason: 'stored_email_account=user-01',
        }),
        previewAndRevertAttempt_func: async () => {
          rewind_rpc_calls_var += 1;
        },
      },
    });

    expect(prepared_action_var).toEqual({
      replayKind_var: 'wrapper',
      nextPromptText_var: buildReplayPrompt_func('원본 프롬프트'),
      ignoredExecutionId_var: 'exec-rewind',
    });
    expect(rewind_rpc_calls_var).toBe(0);
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
    expect(findLiveAuthAccountByStoredEmail_func(
      [
        { name: 'default', email: 'user@gmail.com' },
        { name: 'user-01', email: 'work@company.com' },
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
    expect(findLiveAuthAccountByStoredEmail_func(
      [
        { name: 'default', email: 'user@gmail.com' },
        { name: 'user-01', email: 'user@gmail.com' },
      ],
      live_summary_var,
    )).toBeNull();
  });

  test('verifies live rewind profile via stored email when user-data-dir is ambiguous', async () => {
    const result_var = await verifyLiveRewindProfileMatch_func({
      discovery_var: {
        pid: 1,
        httpsPort: 8443,
        csrfToken: 'csrf-token',
      },
      config_var: {
        appPath: '/Applications/Antigravity.app',
        certPath: '/tmp/cert.pem',
      },
      activeAccountName_var: 'default',
      cliDir_var: '/tmp/cli',
      defaultDataDir_var: '/tmp/default',
      deps_var: {
        loadAuthAccountEntries_func: async () => [
          {
            name: 'default',
            userDataDirPath: '/tmp/default',
            email: 'user@gmail.com',
            accountStatus: 'active',
            token: null,
            quota_cache: null,
          },
          {
            name: 'user-01',
            userDataDirPath: '/tmp/user-01',
            email: 'other@gmail.com',
            accountStatus: 'active',
            token: null,
            quota_cache: null,
          },
        ],
        findRunningAntigravityApps_func: () => [
          { pid: 100, userDataDirPath: '/tmp/default' },
          { pid: 200, userDataDirPath: '/tmp/user-01' },
        ],
        fetchLiveGetUserStatusJson_func: async () => ({
          userStatus: {
            email: 'user@gmail.com',
            cascadeModelConfigData: { clientModelConfigs: [] },
          },
        }),
      },
    });

    expect(result_var).toEqual({ status: 'verified' });
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
