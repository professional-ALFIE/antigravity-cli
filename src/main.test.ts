import { describe, expect, test } from 'bun:test';

import {
  buildRootHelp_func,
  collectPositionalArgs_func,
  collectTrajectoryWorkspaceUris_func,
  dedupeLocalConversationRecords_func,
  extractTrajectorySummaryEntries_func,
  parseArgv_func,
  resolveCanonicalModelNameFromEnum_func,
  recoverPlannerResponseTextFromSteps_func,
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
      '  -r, --resume          List sessions',
      '      --resume [uuid]   Resume a session',
      '  -b, --background      Skip UI surfaced registration',
      '  -j, --json            Output in JSON format',
      '      --timeout-ms <number>',
      '                        Override timeout in milliseconds',
      '  -h, --help            display help for command',
      '',
      'Examples:',
      `  $ antigravity-cli 'hello'                               Single-quoted message`,
      `  $ antigravity-cli "hello"                               Double-quoted message`,
      `  $ antigravity-cli 'say "hello" literally'               Single quotes preserve inner double quotes`,
      `  $ antigravity-cli 'review this code'                    Create new conversation`,
      '  $ antigravity-cli -r                                    List workspace sessions',
      `  $ antigravity-cli -r SESSION_UUID 'continue'            Send message to existing session`,
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

describe('resolveCanonicalModelNameFromEnum_func', () => {
  test('maps known model enums to documented CLI names', () => {
    expect(resolveCanonicalModelNameFromEnum_func(1026)).toBe('claude-opus-4.6');
    expect(resolveCanonicalModelNameFromEnum_func(1035)).toBe('claude-sonnet-4.6');
    expect(resolveCanonicalModelNameFromEnum_func(1018)).toBe('gemini-3-flash');
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
