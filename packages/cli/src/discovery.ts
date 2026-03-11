import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const INSTANCES_FILE = join(homedir(), '.antigravity-cli', 'instances.json');

interface InstanceEntry {
  port: number;
  workspace: string;
  pid: number;
}

export interface DiscoveredInstance {
  port: number;
  workspace: string;
}

function normalizePath_func(path_var: string): string {
  try {
    return realpathSync(path_var);
  } catch {
    return path_var;
  }
}

/**
 * 현재 디렉토리(pwd)를 기반으로 매칭되는 Antigravity 인스턴스를 찾는다.
 * 매칭 우선순위: 정확 일치 > 상위 경로 포함
 */
export function discoverInstance(
  overridePort?: number,
  cwd_var: string = process.cwd(),
): DiscoveredInstance {
  if (overridePort) {
    return { port: overridePort, workspace: '(manual)' };
  }

  if (!existsSync(INSTANCES_FILE)) {
    throw new Error(
      'Antigravity Bridge is not running.\n' +
      'Please activate the Bridge Extension in Antigravity IDE.',
    );
  }

  let entries: InstanceEntry[];
  try {
    const raw = readFileSync(INSTANCES_FILE, 'utf-8');
    entries = JSON.parse(raw) as InstanceEntry[];
  } catch {
    throw new Error('Failed to parse instances.json');
  }

  if (entries.length === 0) {
    throw new Error('No active Antigravity instances.');
  }

  const normalized_cwd_var = normalizePath_func(cwd_var);

  // 1) 정확 일치
  const exact = entries.find((entry) => normalizePath_func(entry.workspace) === normalized_cwd_var);
  if (exact) return { port: exact.port, workspace: exact.workspace };

  // 2) cwd가 워크스페이스 하위 경로인 경우, 가장 긴(가장 구체적인) 매칭
  const parents = entries
    .filter((entry) => normalized_cwd_var.startsWith(normalizePath_func(entry.workspace) + '/'))
    .sort((a, b) => normalizePath_func(b.workspace).length - normalizePath_func(a.workspace).length);

  if (parents.length > 0) {
    return { port: parents[0].port, workspace: parents[0].workspace };
  }

  const workspaces_var = entries.map((entry) => `- ${entry.workspace}`).join('\n');
  throw new Error(
    [
      'No Antigravity instance found for the current workspace.',
      `Current path: ${cwd_var}`,
      'Active instances:',
      workspaces_var,
    ].join('\n'),
  );
}
