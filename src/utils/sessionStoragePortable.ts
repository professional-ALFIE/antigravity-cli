/**
 * Portable session storage utilities for Antigravity CLI.
 *
 * Claude Code의 src/utils/sessionStoragePortable.ts에서 필요한 축만 가져옴.
 * - sanitizePath(): 프로젝트 경로를 안전한 디렉토리 이름으로 변환
 * - getProjectsDir(): ~/.antigravity-cli/projects/ 반환
 * - getProjectDir(): 프로젝트별 디렉토리
 * - getTranscriptPath(): <cascadeId>.jsonl 경로
 *
 * Claude Code와의 차이:
 * - getClaudeConfigHomeDir() 대신 ~/.antigravity-cli 직접 사용
 * - sessionId 대신 cascadeId로 transcript 파일 키를 씀
 * - worktree fallback, compact-boundary 등 고급 기능은 이 stage에서 불필요
 */

import { join } from "path";
import { mkdirSync } from "fs";
import { realpath } from "fs/promises";
import { djb2Hash } from "./hash.js";

// ---------------------------------------------------------------------------
// Path sanitization
// ---------------------------------------------------------------------------

/**
 * Maximum length for a single filesystem path component (directory or file name).
 * Most filesystems (ext4, APFS, NTFS) limit individual components to 255 bytes.
 * We use 200 to leave room for the hash suffix and separator.
 *
 * Claude Code의 MAX_SANITIZED_LENGTH와 동일.
 */
export const MAX_SANITIZED_LENGTH = 200;

function simpleHash(str: string): string {
  return Math.abs(djb2Hash(str)).toString(36);
}

/**
 * Makes a string safe for use as a directory or file name.
 * Replaces all non-alphanumeric characters with hyphens.
 *
 * Claude Code의 sanitizePath()와 **동일한 규칙**.
 *
 * @param name - The string to make safe (e.g., '/Users/foo/my-project' or 'plugin:name:server')
 * @returns A safe name (e.g., '-Users-foo-my-project' or 'plugin-name-server')
 */
export function sanitizePath(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9]/g, "-");
  if (sanitized.length <= MAX_SANITIZED_LENGTH) {
    return sanitized;
  }
  // 200자 초과 시 hash suffix 추가
  // Bun 환경: Bun.hash (wyhash), Node 환경: djb2Hash fallback
  const hash =
    typeof Bun !== "undefined" ? Bun.hash(name).toString(36) : simpleHash(name);
  return `${sanitized.slice(0, MAX_SANITIZED_LENGTH)}-${hash}`;
}

// ---------------------------------------------------------------------------
// Project directory helpers
// ---------------------------------------------------------------------------

/**
 * Antigravity CLI의 설정 홈 디렉토리.
 * Claude Code: ~/.claude → Antigravity: ~/.antigravity-cli
 */
function getConfigHomeDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
  return join(home, ".antigravity-cli");
}

/**
 * 모든 프로젝트의 상위 디렉토리.
 * Claude Code의 getProjectsDir()와 동일 패턴.
 *
 * @returns ~/.antigravity-cli/projects/
 */
export function getProjectsDir(): string {
  const dir = join(getConfigHomeDir(), "projects");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 특정 프로젝트의 디렉토리.
 * projectDir를 sanitizePath()로 변환하여 안전한 디렉토리명으로 만든다.
 *
 * @param projectDir - 보통 process.cwd() (spec에서 고정)
 * @returns ~/.antigravity-cli/projects/<sanitized-project-dir>/
 */
export function getProjectDir(projectDir: string): string {
  return join(getProjectsDir(), sanitizePath(projectDir));
}

/**
 * transcript JSONL 파일 경로.
 * Claude Code: <sessionId>.jsonl → Antigravity: <cascadeId>.jsonl
 *
 * @param projectDir - process.cwd()
 * @param cascadeId - Antigravity의 대화 식별자
 * @returns ~/.antigravity-cli/projects/<sanitized-project-dir>/<cascadeId>.jsonl
 */
export function getTranscriptPath(
  projectDir: string,
  cascadeId: string,
): string {
  return join(getProjectDir(projectDir), `${cascadeId}.jsonl`);
}

/**
 * transcript 저장 디렉토리가 존재하는지 확인하고, 없으면 생성.
 * transcript append 전에 호출해야 한다.
 *
 * @param projectDir - process.cwd()
 */
export function ensureProjectDir(projectDir: string): void {
  mkdirSync(getProjectDir(projectDir), { recursive: true });
}

// ---------------------------------------------------------------------------
// Path canonicalization
// ---------------------------------------------------------------------------

/**
 * 디렉토리 경로를 canonical form으로 변환 (realpath + NFC normalization).
 * symlink 해석 실패 시 NFC-only fallback.
 *
 * Claude Code의 canonicalizePath()와 동일.
 * macOS에서 /tmp → /private/tmp 같은 symlink를 해석해서 같은 프로젝트 디렉토리로 매핑.
 */
export async function canonicalizePath(dir: string): Promise<string> {
  try {
    return (await realpath(dir)).normalize("NFC");
  } catch {
    return dir.normalize("NFC");
  }
}
