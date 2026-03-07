import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const INSTANCES_DIR = path.join(os.homedir(), '.antigravity-cli');
const INSTANCES_FILE = path.join(INSTANCES_DIR, 'instances.json');

interface InstanceEntry {
  port: number;
  workspace: string;
  pid: number;
}

/** CLI가 발견할 수 있도록 포트/워크스페이스 정보를 파일에 기록한다. */
export class PortFile {
  static register(port: number, workspace: string): void {
    const entries = PortFile.readEntries();

    // 같은 워크스페이스의 기존 항목 제거 (재시작 대응)
    const filtered = entries.filter((entry) => entry.workspace !== workspace);
    filtered.push({ port, workspace, pid: process.pid });

    PortFile.writeEntries(filtered);
  }

  static unregister(port: number): void {
    const entries = PortFile.readEntries();
    const filtered = entries.filter((entry) => entry.port !== port);
    PortFile.writeEntries(filtered);
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
