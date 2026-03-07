import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const INSTANCES_FILE = join(homedir(), '.antigravity-cli', 'instances.json');

interface InstanceEntry {
  port: number;
  workspace: string;
  pid: number;
}

/**
 * 현재 디렉토리(pwd)를 기반으로 매칭되는 Antigravity 인스턴스를 찾는다.
 * 매칭 우선순위: 정확 일치 > 상위 경로 포함 > 첫 번째 항목 fallback
 */
export function discoverInstance(overridePort?: number): { port: number; workspace: string } {
  if (overridePort) {
    return { port: overridePort, workspace: '(manual)' };
  }

  if (!existsSync(INSTANCES_FILE)) {
    throw new Error(
      'Antigravity Bridge가 실행 중이 아닙니다.\n' +
      'Antigravity IDE에서 Bridge Extension을 활성화해주세요.',
    );
  }

  let entries: InstanceEntry[];
  try {
    const raw = readFileSync(INSTANCES_FILE, 'utf-8');
    entries = JSON.parse(raw) as InstanceEntry[];
  } catch {
    throw new Error('instances.json 파싱 실패');
  }

  if (entries.length === 0) {
    throw new Error('활성 Antigravity 인스턴스가 없습니다.');
  }

  const cwd = process.cwd();

  // 1) 정확 일치
  const exact = entries.find((entry) => entry.workspace === cwd);
  if (exact) return { port: exact.port, workspace: exact.workspace };

  // 2) cwd가 워크스페이스 하위 경로인 경우, 가장 긴(가장 구체적인) 매칭
  const parents = entries
    .filter((entry) => cwd.startsWith(entry.workspace + '/'))
    .sort((a, b) => b.workspace.length - a.workspace.length);

  if (parents.length > 0) {
    return { port: parents[0].port, workspace: parents[0].workspace };
  }

  // 3) fallback — 첫 번째 항목
  return { port: entries[0].port, workspace: entries[0].workspace };
}
