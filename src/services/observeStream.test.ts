/**
 * observeStream.ts — Integration 테스트
 *
 * 원본: scripts/headless-backend/observe_stream.test.ts에서 이관.
 * applyAgentStateUpdate의 step overwrite, status tracking,
 * recoverObservedResponseText의 response / modifiedResponse fallback을 검증.
 */

import { describe, test, expect } from "bun:test";

import {
  applyAgentStateUpdate_func,
  createObservedConversationState_func,
  hasObservedTerminalSuccess_func,
  recoverObservedResponseText_func,
} from "./observeStream.js";

describe("applyAgentStateUpdate", () => {
  test("repeated index overwrite + step case 분류 + status tracking", () => {
    const state = createObservedConversationState_func();

    applyAgentStateUpdate_func(state, {
      conversationId: "cascade-1",
      trajectoryId: "trajectory-1",
      status: "CASCADE_RUN_STATUS_RUNNING",
      mainTrajectoryUpdate: {
        stepsUpdate: {
          indices: [0, 1],
          totalLength: 2,
          pageBounds: { startIndex: 0, endIndexExclusive: 2 },
          steps: [
            {
              case: "viewFile",
              value: { relativeWorkspacePath: "README.md" },
            },
            {
              case: "plannerResponse",
              status: "CORTEX_STEP_STATUS_DONE",
              metadata: {
                executionId: "exec-1",
                completedAt: "2026-04-22T10:00:00.000Z",
                finishedGeneratingAt: "2026-04-22T10:00:01.000Z",
              },
              value: {
                stopReason: "STOP_REASON_STOP_PATTERN",
                modifiedResponse: "FIRST DRAFT",
                toolCalls: [{ id: "tool-1" }],
              },
            },
          ],
        },
        generatorMetadatasUpdate: {
          indices: [1],
          totalLength: 1,
        },
      },
      queuedStepsUpdate: {
        indices: [0],
        totalLength: 1,
        queuedSteps: [
          {
            case: "userInput",
            value: { isQueuedMessage: true },
          },
        ],
      },
    });

    // index 1을 overwrite하는 두 번째 update
    applyAgentStateUpdate_func(state, {
      conversationId: "cascade-1",
      trajectoryId: "trajectory-1",
      status: "CASCADE_RUN_STATUS_IDLE",
      mainTrajectoryUpdate: {
        stepsUpdate: {
          indices: [1, 2],
          totalLength: 3,
          pageBounds: { startIndex: 0, endIndexExclusive: 3 },
          steps: [
            {
              case: "plannerResponse",
              status: "CORTEX_STEP_STATUS_DONE",
              metadata: {
                executionId: "exec-1",
                completedAt: "2026-04-22T10:00:02.000Z",
                finishedGeneratingAt: "2026-04-22T10:00:03.000Z",
              },
              value: {
                stopReason: "STOP_REASON_STOP_PATTERN",
                response: "FINAL ANSWER",
                toolCalls: [{ id: "tool-1" }, { id: "tool-2" }],
                thinking: "trimmed",
              },
            },
            {
              case: "checkpoint",
              value: { checkpointIndex: 2 },
            },
          ],
        },
      },
    });

    // 검증
    expect(state.stepMap.size).toBe(3);
    expect(state.repeatedStepIndices).toEqual([1]);
    expect(
      Array.from(state.stepMap.values()).map((s) => s.caseName),
    ).toEqual(["viewFile", "plannerResponse", "checkpoint"]);
    expect(state.latestStatus).toBe("CASCADE_RUN_STATUS_IDLE");
    expect(state.latestQueuedTotalLength).toBe(1);
    expect(state.latestGeneratorTotalLength).toBe(1);
    expect(state.stepMap.get(1)?.responseText).toBe("FINAL ANSWER");
    expect(state.stepMap.get(1)?.toolCallCount).toBe(2);
    expect(state.stepMap.get(1)?.hasThinking).toBe(true);
    expect(state.stepMap.get(1)?.isTerminalSuccess).toBe(true);
    expect(recoverObservedResponseText_func(state)).toBe("FINAL ANSWER");
  });
});

describe("recoverObservedResponseText", () => {
  test("response가 빈 문자열이면 modifiedResponse fallback", () => {
    const state = createObservedConversationState_func();

    applyAgentStateUpdate_func(state, {
      conversationId: "cascade-2",
      trajectoryId: "trajectory-2",
      status: "CASCADE_RUN_STATUS_IDLE",
      mainTrajectoryUpdate: {
        stepsUpdate: {
          indices: [0],
          totalLength: 1,
          steps: [
            {
              case: "plannerResponse",
              status: "CORTEX_STEP_STATUS_DONE",
              metadata: {
                executionId: "exec-2",
                completedAt: "2026-04-22T10:00:00.000Z",
                finishedGeneratingAt: "2026-04-22T10:00:01.000Z",
              },
              value: {
                stopReason: "STOP_REASON_STOP_PATTERN",
                response: "",
                modifiedResponse: "USE MODIFIED",
              },
            },
          ],
        },
      },
    });

    expect(recoverObservedResponseText_func(state)).toBe("USE MODIFIED");
  });

  test("terminal success가 아니면 planner text를 복구하지 않는다", () => {
    const state = createObservedConversationState_func();

    applyAgentStateUpdate_func(state, {
      conversationId: "cascade-3",
      trajectoryId: "trajectory-3",
      status: "CASCADE_RUN_STATUS_IDLE",
      mainTrajectoryUpdate: {
        stepsUpdate: {
          indices: [0, 1],
          totalLength: 2,
          steps: [
            {
              case: "plannerResponse",
              status: "CORTEX_STEP_STATUS_GENERATING",
              metadata: {
                executionId: "exec-3",
                completedAt: "2026-04-22T10:00:00.000Z",
                finishedGeneratingAt: "2026-04-22T10:00:01.000Z",
              },
              value: {
                stopReason: "STOP_REASON_STOP_PATTERN",
                response: "still generating",
              },
            },
            {
              case: "plannerResponse",
              status: "CORTEX_STEP_STATUS_DONE",
              metadata: {
                executionId: "exec-4",
                completedAt: "2026-04-22T10:00:02.000Z",
                finishedGeneratingAt: "2026-04-22T10:00:03.000Z",
              },
              value: {
                stopReason: "STOP_REASON_CLIENT_STREAM_ERROR",
                response: "failed text",
              },
            },
          ],
        },
      },
    });

    expect(state.stepMap.get(0)?.isTerminalSuccess).toBe(false);
    expect(state.stepMap.get(1)?.isTerminalSuccess).toBe(false);
    expect(recoverObservedResponseText_func(state)).toBeNull();
  });

  test("ignored execution id에 속한 stale success는 복구하지 않는다", () => {
    const state = createObservedConversationState_func();

    applyAgentStateUpdate_func(state, {
      conversationId: "cascade-4",
      trajectoryId: "trajectory-4",
      status: "CASCADE_RUN_STATUS_IDLE",
      mainTrajectoryUpdate: {
        stepsUpdate: {
          indices: [0, 1],
          totalLength: 2,
          steps: [
            {
              case: "plannerResponse",
              status: "CORTEX_STEP_STATUS_DONE",
              metadata: {
                executionId: "exec-stale",
                completedAt: "2026-04-22T10:00:00.000Z",
                finishedGeneratingAt: "2026-04-22T10:00:01.000Z",
              },
              value: {
                stopReason: "STOP_REASON_STOP_PATTERN",
                response: "stale success",
              },
            },
            {
              case: "plannerResponse",
              status: "CORTEX_STEP_STATUS_DONE",
              metadata: {
                executionId: "exec-textless",
                completedAt: "2026-04-22T10:00:02.000Z",
                finishedGeneratingAt: "2026-04-22T10:00:03.000Z",
              },
              value: {
                stopReason: "STOP_REASON_STOP_PATTERN",
                toolCalls: [{ id: "tool-1" }],
              },
            },
          ],
        },
      },
    });

    expect(hasObservedTerminalSuccess_func(state)).toBe(true);
    expect(hasObservedTerminalSuccess_func(state, new Set(["exec-stale"]))).toBe(true);
    expect(recoverObservedResponseText_func(state, new Set(["exec-stale"]))).toBeNull();
  });
});
