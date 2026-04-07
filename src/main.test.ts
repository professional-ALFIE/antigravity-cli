import { describe, expect, test } from 'bun:test';

import {
  collectTrajectoryWorkspaceUris_func,
  dedupeLocalConversationRecords_func,
  extractTrajectorySummaryEntries_func,
  recoverPlannerResponseTextFromSteps_func,
} from './main.js';

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
