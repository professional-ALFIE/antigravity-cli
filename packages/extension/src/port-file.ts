import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const INSTANCES_DIR = path.join(os.homedir(), '.antigravity-cli');
const INSTANCES_FILE = path.join(INSTANCES_DIR, 'instances.json');
const LOCK_FILE = INSTANCES_FILE + '.lock';
const LOCK_MAX_RETRIES = 10;
const LOCK_RETRY_DELAY_MS = 100;
const LOCK_STALE_MS = 5000;

interface InstanceEntry {
  port: number;
  workspace: string;
  pid: number;
}

function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* busy wait — Extension activate 에서만 사용, 최대 1초 */
  }
}

function acquireLock(): boolean {
  if (!fs.existsSync(INSTANCES_DIR)) {
    fs.mkdirSync(INSTANCES_DIR, { recursive: true });
  }

  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt++) {
    try {
      fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
      return true;
    } catch {
      // lock 파일이 이미 존재 — stale 검사 후 retry
      try {
        const stat = fs.statSync(LOCK_FILE);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          // stale lock — 강제 제거 후 재시도
          try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
          continue;
        }
      } catch { /* stat 실패 — 파일이 사라졌으므로 재시도 */ }

      sleepSync(LOCK_RETRY_DELAY_MS);
    }
  }

  return false;
}

function releaseLock(): void {
  try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
}

/**
 * CLI가 발견할 수 있도록 포트/워크스페이스 정보를 파일에 기록한다.
 *
 * NOTE: acquireLock()은 best-effort 잠금이다.
 * 잠금 실패 시에도 등록은 수행한다 — 등록 누락(CLI가 인스턴스를 못 찾음)이
 * 레이스 컨디션(항목 일시 누락)보다 더 심각한 문제이기 때문이다.
 * 실제 경쟁 구간은 readFileSync+writeFileSync(< 1ms)이므로
 * 10회 재시도(~1초) 후에도 잠금 실패할 확률은 극히 낮다.
 */
export class PortFile {
  static register(port: number, workspace: string): void {
    const locked = acquireLock();
    if (!locked) {
      process.stderr.write('[Bridge] WARNING: instances.json lock 획득 실패 — best-effort로 등록 진행\n');
    }
    try {
      const entries = PortFile.readEntries();

      // 같은 워크스페이스의 기존 항목 제거 (재시작 대응)
      const filtered = entries.filter((entry) => entry.workspace !== workspace);
      filtered.push({ port, workspace, pid: process.pid });

      PortFile.writeEntries(filtered);
    } finally {
      if (locked) releaseLock();
    }
  }

  static unregister(port: number): void {
    const locked = acquireLock();
    if (!locked) {
      process.stderr.write('[Bridge] WARNING: instances.json lock 획득 실패 — best-effort로 해제 진행\n');
    }
    try {
      const entries = PortFile.readEntries();
      const filtered = entries.filter((entry) => entry.port !== port);
      PortFile.writeEntries(filtered);
    } finally {
      if (locked) releaseLock();
    }
  }

  private static readEntries(): InstanceEntry[] {
    try {
      if (!fs.existsSync(INSTANCES_FILE)) {
        return [];
      }
      const raw = fs.readFileSync(INSTANCES_FILE, 'utf-8');
      return JSON.parse(raw) as InstanceEntry[];
    } catch {
      return [];
    }
  }

  private static writeEntries(entries: InstanceEntry[]): void {
    if (!fs.existsSync(INSTANCES_DIR)) {
      fs.mkdirSync(INSTANCES_DIR, { recursive: true });
    }
    fs.writeFileSync(INSTANCES_FILE, JSON.stringify(entries, null, 2), 'utf-8');
  }
}
