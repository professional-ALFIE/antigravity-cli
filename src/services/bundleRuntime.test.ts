/**
 * bundleRuntime.ts — Integration 테스트
 *
 * 원본: scripts/headless-backend/bundle_runtime.test.ts에서 이관.
 * 실제 Antigravity.app의 extension.js를 VM으로 로드하여
 * StreamAgentStateUpdates request/response schema 필드를 검증.
 */

import { describe, test, expect } from "bun:test";
import path from "node:path";

import { resolveHeadlessBackendConfig } from "../utils/config.js";
import { loadAntigravityBundle_func } from "./bundleRuntime.js";

describe("loadAntigravityBundle", () => {
  test("StreamAgentStateUpdates request/response schema 필드 노출", () => {
    const config = resolveHeadlessBackendConfig({
      repoRootPath: "/repo/root",
      homeDirPath: "/Users/example",
      envFilePath: "/repo/root/.env",
    });

    const bundle = loadAntigravityBundle_func({
      extensionBundlePath: path.join(config.distPath, "extension.js"),
    });

    expect(
      Array.from(
        bundle.schemaInfo.streamAgentStateUpdatesRequestFields,
        (f: { localName: string }) => f.localName,
      ),
    ).toEqual(["conversationId", "subscriberId", "initialStepsPageBounds"]);

    expect(
      Array.from(
        bundle.schemaInfo.streamAgentStateUpdatesResponseFields,
        (f: { localName: string }) => f.localName,
      ),
    ).toEqual(["update"]);

    expect(bundle.schemas.cascadeTrajectorySummary).toBeDefined();
    expect(bundle.schemas.cascadeTrajectorySummaries).toBeDefined();
    expect(bundle.schemas.conversationAnnotations).toBeDefined();
    expect(typeof bundle.toBinary_func).toBe("function");
    expect(typeof bundle.fromBinary_func).toBe("function");
  });
});
