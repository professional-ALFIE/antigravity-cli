/**
 * djb2 string hash — fast non-cryptographic hash returning a signed 32-bit int.
 * Deterministic across runtimes (unlike Bun.hash which uses wyhash).
 *
 * Claude Code의 src/utils/hash.ts에서 그대로 가져옴.
 * 역할: sanitizePath()에서 200자 초과 경로에 hash suffix를 붙일 때 사용.
 */
export function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}
