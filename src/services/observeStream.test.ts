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
              value: {
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
              value: {
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
              value: {
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
});
