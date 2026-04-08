import { describe, expect, test } from 'bun:test';

import {
  buildSessionContinuationNotice_func,
  buildRootHelp_func,
  collectFetchedStepEvents_func,
  collectPositionalArgs_func,
  collectTrajectoryWorkspaceUris_func,
  createFetchedStepAppendState_func,
  dedupeLocalConversationRecords_func,
  extractTrajectorySummaryEntries_func,
  flushPendingTailStepEvent_func,
  parseArgv_func,
   resolveCanonicalModelNameFromEnum_func,
   recoverPlannerResponseTextFromSteps_func,
  shouldFetchStepsForUpdate_func,
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
      timeoutMs: 120_000,
    });
  });

  test('keeps a single positional message token with literal double quotes inside', () => {
    const literal_message_var = '이건 메시지 내용인데, 강조할 땐 "이렇게"강조를 하더라도, 끊기지 않는단말이야';

    const options_var = parseArgv_func(['-m', 'flash', literal_message_var]);

    expect(options_var.prompt).toBe(literal_message_var);
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
      '  -r, --resume               List sessions',
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
      `  $ antigravity-cli 'say "hello" literally'               Single quotes preserve inner double quotes`,
      `  $ antigravity-cli 'review this code'                    Create new conversation`,
      '  $ antigravity-cli -r                                    List workspace sessions',
      `  $ antigravity-cli -r <cascadeId> 'continue'             Send message to existing session`,
      `  $ antigravity-cli -b 'background task'                  Skip UI surfaced registration`,
      `  $ antigravity-cli -j 'summarize this'                   Print transcript events as JSONL`,
      '',
      'Root Mode:',
      '  - New and resumed conversations talk to the Antigravity language server directly',
      '  - If --background is omitted, local tracking and UI surfaced post-processing are attempted',
      '  - --resume list only shows sessions for the current workspace, with full UUIDs',
      '  - Messages must be passed as a single positional argument — use quotes for spaces',
      '  - Prefer single quotes for literal text; use double quotes inside them for emphasis',
    ].join('\n');

    expect(buildRootHelp_func('claude-opus-4.6')).toBe(expected_help_var);
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
