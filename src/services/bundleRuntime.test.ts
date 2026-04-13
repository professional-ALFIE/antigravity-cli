/**
 * bundleRuntime.ts — Integration 테스트
 *
 * 원본: scripts/headless-backend/bundle_runtime.test.ts에서 이관.
 * 실제 Antigravity.app의 extension.js를 VM으로 로드하여
 * StreamAgentStateUpdates request/response schema 필드를 검증.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { resolveHeadlessBackendConfig } from "../utils/config.js";
import { loadAntigravityBundle_func } from "./bundleRuntime.js";

describe("loadAntigravityBundle", () => {
  test("현재 앱 번들의 swapped bootstrap 식별자 패턴에서도 로드된다", () => {
    const config = resolveHeadlessBackendConfig({
      repoRootPath: "/repo/root",
      homeDirPath: "/Users/example",
      envFilePath: "/repo/root/.env",
    });

    const extension_bundle_path_var = path.join(config.distPath, "extension.js");
    const bundle_source_var = readFileSync(extension_bundle_path_var, "utf8");

    expect(bundle_source_var).toContain("var s=o(o.s=27015),r=exports;");

    const bundle = loadAntigravityBundle_func({
      extensionBundlePath: extension_bundle_path_var,
    });

    expect(bundle.languageServerService).toBeDefined();
  });

  test("StreamAgentStateUpdates request/response schema 필드 노출", () => {
    const config = resolveHeadlessBackendConfig({
      repoRootPath: "/repo/root",
      homeDirPath: "/Users/example",
      envFilePath: "/repo/root/.env",
    });

    const bundle = loadAntigravityBundle_func({
      extensionBundlePath: path.join(config.distPath, "extension.js"),
    });

    const request_field_names_var = Array.from(
      bundle.schemaInfo.streamAgentStateUpdatesRequestFields,
      (f: { localName: string }) => f.localName,
    );
    const response_field_names_var = Array.from(
      bundle.schemaInfo.streamAgentStateUpdatesResponseFields,
      (f: { localName: string }) => f.localName,
    );

    expect(request_field_names_var).toContain("conversationId");
    expect(request_field_names_var).toContain("subscriberId");
    expect(request_field_names_var).toContain("initialStepsPageBounds");

    expect(response_field_names_var).toContain("update");

    expect(bundle.schemas.cascadeTrajectorySummary).toBeDefined();
    expect(bundle.schemas.cascadeTrajectorySummaries).toBeDefined();
    expect(bundle.schemas.conversationAnnotations).toBeDefined();
    expect(typeof bundle.toBinary_func).toBe("function");
    expect(typeof bundle.fromBinary_func).toBe("function");
  });
});
