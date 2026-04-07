/**
 * sessionStoragePortable.ts — Integration 테스트
 *
 * 검증 대상:
 * - sanitizePath(): Claude Code 규칙과 1:1 일치
 * - getProjectsDir(), getProjectDir(), getTranscriptPath(): 올바른 경로 생성
 * - ensureProjectDir(): 디렉토리 실제 생성
 * - canonicalizePath(): realpath + NFC normalization
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import {
  sanitizePath,
  MAX_SANITIZED_LENGTH,
  getProjectsDir,
  getProjectDir,
  getTranscriptPath,
  ensureProjectDir,
  canonicalizePath,
} from "./sessionStoragePortable.js";

// ---------------------------------------------------------------------------
// sanitizePath — Claude Code 규칙과 동일한 출력인지 검증
// ---------------------------------------------------------------------------

describe("sanitizePath — Claude Code 규칙 일치", () => {
  test("일반 경로: 비영숫자 문자가 전부 하이픈으로 치환된다", () => {
    // Arrange
    const input = "/Users/foo/my-project";
    // Act
    const result = sanitizePath(input);
    // Assert — Claude Code JSDoc 예시와 1:1 일치
    expect(result).toBe("-Users-foo-my-project");
  });

  test("콜론 포함: plugin:name:server → plugin-name-server", () => {
    const result = sanitizePath("plugin:name:server");
    expect(result).toBe("plugin-name-server");
  });

  test("선행 슬래시도 하이픈이 된다", () => {
    const result = sanitizePath("/absolute/path");
    expect(result.startsWith("-")).toBe(true);
    expect(result).toBe("-absolute-path");
  });

  test("영숫자만 있으면 그대로", () => {
    expect(sanitizePath("abc123")).toBe("abc123");
  });

  test("빈 문자열", () => {
    expect(sanitizePath("")).toBe("");
  });

  test("200자 이하면 hash suffix 없음", () => {
    const input = "a".repeat(200);
    const result = sanitizePath(input);
    expect(result).toBe(input);
    expect(result.length).toBe(200);
  });

  test("200자 초과면 hash suffix가 붙는다", () => {
    const input = "/".repeat(201);
    const result = sanitizePath(input);
    // 200자로 잘리고 + '-' + hash
    expect(result.startsWith("-".repeat(200) + "-")).toBe(true);
    expect(result.length).toBeGreaterThan(200);
    expect(result.length).toBeLessThanOrEqual(MAX_SANITIZED_LENGTH + 1 + 20); // hash 길이 여유
  });

  test("같은 긴 입력은 같은 해시를 생성한다 (결정적)", () => {
    const longPath = "/Users/someone/" + "very-deep-nested/".repeat(20) + "project";
    const result1 = sanitizePath(longPath);
    const result2 = sanitizePath(longPath);
    expect(result1).toBe(result2);
  });

  test("다른 긴 입력은 다른 해시를 생성한다", () => {
    const pathA = "/a/" + "x".repeat(250);
    const pathB = "/b/" + "x".repeat(250);
    const resultA = sanitizePath(pathA);
    const resultB = sanitizePath(pathB);
    expect(resultA).not.toBe(resultB);
  });
});

// ---------------------------------------------------------------------------
// 경로 헬퍼 — 올바른 경로 조합 검증
// ---------------------------------------------------------------------------

describe("경로 헬퍼 함수", () => {
  test("getProjectsDir()는 ~/.antigravity-cli/projects를 반환한다", () => {
    const result = getProjectsDir();
    expect(result).toContain(".antigravity-cli");
    expect(result).toMatch(/projects$/);
  });

  test("[P2] getProjectsDir()는 디렉토리가 없으면 생성한다 (plan L66 계약)", () => {
    // getProjectsDir()를 호출하면 반환 경로가 실제로 존재해야 한다
    const dir = getProjectsDir();
    expect(existsSync(dir)).toBe(true);
  });

  test("getProjectDir()는 getProjectsDir() + sanitizePath(projectDir)이다", () => {
    const projectDir = "/Users/test/my-project";
    const result = getProjectDir(projectDir);
    expect(result).toBe(
      join(getProjectsDir(), sanitizePath(projectDir)),
    );
  });

  test("getTranscriptPath()는 <projectDir>/<cascadeId>.jsonl이다", () => {
    const projectDir = "/Users/test/project";
    const cascadeId = "abc-123-def";
    const result = getTranscriptPath(projectDir, cascadeId);
    expect(result).toBe(
      join(getProjectDir(projectDir), `${cascadeId}.jsonl`),
    );
    expect(result).toMatch(/\.jsonl$/);
  });
});

// ---------------------------------------------------------------------------
// ensureProjectDir — 실제 디렉토리 생성 검증
// ---------------------------------------------------------------------------

describe("ensureProjectDir — 디렉토리 생성", () => {
  const testProjectDir = join("/tmp", `antigravity-test-${Date.now()}`);

  afterAll(() => {
    // 정리: 테스트용 디렉토리 삭제
    try {
      const projectDir = getProjectDir(testProjectDir);
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      // 이미 없으면 무시
    }
  });

  test("디렉토리가 없으면 생성한다", () => {
    // Arrange
    const targetDir = getProjectDir(testProjectDir);
    expect(existsSync(targetDir)).toBe(false);
    // Act
    ensureProjectDir(testProjectDir);
    // Assert
    expect(existsSync(targetDir)).toBe(true);
  });

  test("이미 존재해도 에러 없이 통과한다", () => {
    // Arrange — 위 테스트에서 이미 생성됨
    // Act + Assert — 에러 안 남
    expect(() => ensureProjectDir(testProjectDir)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// canonicalizePath — realpath + NFC
// ---------------------------------------------------------------------------

describe("canonicalizePath", () => {
  test("존재하는 경로는 realpath로 해석된다", async () => {
    // macOS에서 /tmp → /private/tmp
    const result = await canonicalizePath("/tmp");
    // /tmp이 symlink면 /private/tmp으로 해석됨
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });

  test("존재하지 않는 경로는 NFC-only fallback", async () => {
    const fakePath = "/nonexistent-path-12345";
    const result = await canonicalizePath(fakePath);
    expect(result).toBe(fakePath.normalize("NFC"));
  });
});
