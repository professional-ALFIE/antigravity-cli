/**
 * config.ts — Integration 테스트
 *
 * 원본: scripts/headless-backend/config.test.ts에서 이관.
 * 변경: workspaceRootPath fallback이 homeDirPath → process.cwd()로 바뀜 (stage57 결정).
 */

import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadEnvFile, resolveHeadlessBackendConfig } from "./config.js";

describe("loadEnvFile", () => {
  test("key-value 파싱 + 따옴표 제거", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-config-"));
    try {
      const envFile = path.join(root, ".env");
      writeFileSync(
        envFile,
        [
          "# comment",
          'ANTIGRAVITY_OAUTH_ACCESS_TOKEN="token-value"',
          "ANTIGRAVITY_OAUTH_SENTINEL_KEY=oauthTokenInfoSentinelKey",
          "EMPTY_VALUE=",
        ].join("\n"),
        "utf8",
      );

      expect(loadEnvFile(envFile)).toEqual({
        ANTIGRAVITY_OAUTH_ACCESS_TOKEN: "token-value",
        ANTIGRAVITY_OAUTH_SENTINEL_KEY: "oauthTokenInfoSentinelKey",
        EMPTY_VALUE: "",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("resolveHeadlessBackendConfig", () => {
  test("env에 workspace 미설정 시 process.cwd() fallback (stage57 변경)", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-config-"));
    try {
      const envFile = path.join(root, ".env");
      writeFileSync(envFile, "ANTIGRAVITY_OAUTH_ACCESS_TOKEN=test-token\n", "utf8");

      const config = resolveHeadlessBackendConfig({
        repoRootPath: "/repo/root",
        homeDirPath: "/Users/example",
        envFilePath: envFile,
        now: new Date("2026-03-25T12:34:56Z"),
      });

      expect(config.appPath).toBe("/Applications/Antigravity.app");
      expect(config.languageServerPath).toContain("language_server_macos_arm");
      expect(config.certPath).toContain("cert.pem");
      // stage57 변경: process.cwd()로 fallback
      expect(config.workspaceRootPath).toBe(process.cwd());
      expect(config.env.ANTIGRAVITY_OAUTH_ACCESS_TOKEN).toBe("test-token");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });



  test("workspace는 항상 process.cwd()이다 (.env 무시)", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-config-"));
    try {
      const envFile = path.join(root, ".env");
      writeFileSync(
        envFile,
        "ANTIGRAVITY_OAUTH_ACCESS_TOKEN=test-token\nANTIGRAVITY_WORKSPACE_ROOT_PATH=/Projects/my-workspace\n",
        "utf8",
      );

      const config = resolveHeadlessBackendConfig({
        repoRootPath: "/repo/root",
        homeDirPath: "/Users/example",
        envFilePath: envFile,
        now: new Date("2026-03-25T12:34:56Z"),
      });

      // .env에 경로가 있어도 process.cwd()를 쓴다
      expect(config.workspaceRootPath).toBe(process.cwd());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("[P1] repoRootPath 미주입 시 기본값이 현재 저장소 루트를 가리킨다", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-config-"));
    try {
      const envFile = path.join(root, ".env");
      writeFileSync(envFile, "ANTIGRAVITY_OAUTH_ACCESS_TOKEN=test-token\n", "utf8");

      const config = resolveHeadlessBackendConfig({
        homeDirPath: "/Users/example",
        envFilePath: envFile,
        now: new Date("2026-03-25T12:34:56Z"),
      });

      // 이 파일은 issue-36-antigravity-headless/src/utils/config.ts 이므로
      // 기본 repoRootPath는 2단계 상위 = 현재 저장소 루트다.
      expect(config.repoRootPath).toMatch(/issue-36-antigravity-headless$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
