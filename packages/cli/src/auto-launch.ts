import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { BridgeClient } from './client.js';
import { discoverInstance, type DiscoveredInstance } from './discovery.js';

const INSTANCES_FILE = join(homedir(), '.antigravity-cli', 'instances.json');
const ANTIGRAVITY_APP_BINARY_PATH_PREFIX = '/Applications/Antigravity.app/Contents/MacOS/';
const ANTIGRAVITY_LAUNCH_BINARY_PATH = '/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity';
const ANTIGRAVITY_BUNDLE_ID = 'com.google.antigravity';
const HELPER_BINARY_PATH = fileURLToPath(
  new URL('../native-bin/ag-minimize-darwin-universal', import.meta.url),
);

interface InstanceEntry {
  port: number;
  workspace: string;
  pid: number;
}

export interface ResolvedClient {
  client_var: BridgeClient;
  instance_var: DiscoveredInstance;
  auto_launch_var: boolean;
}

function normalizeRealPath_func(path_var: string): string {
  try {
    return realpathSync(path_var);
  } catch {
    return path_var;
  }
}

function readInstanceEntries_func(): InstanceEntry[] {
  try {
    if (!existsSync(INSTANCES_FILE)) {
      return [];
    }

    const raw_var = readFileSync(INSTANCES_FILE, 'utf-8');
    return JSON.parse(raw_var) as InstanceEntry[];
  } catch {
    return [];
  }
}

function isAntigravityRunning_func(): boolean {
  if (
    process.env.ANTIGRAVITY_CLI_TEST_LAUNCH_SCRIPT
    || process.env.ANTIGRAVITY_CLI_TEST_HELPER_EXIT_CODE
  ) {
    return true;
  }

  if (process.platform !== 'darwin') {
    return false;
  }

  const result_var = spawnSync(
    'pgrep',
    ['-f', ANTIGRAVITY_APP_BINARY_PATH_PREFIX],
    { stdio: 'ignore' },
  );
  return result_var.status === 0;
}

function resolveHelperError_func(exit_code_var: number, workspace_var: string): Error {
  if (exit_code_var === 10) {
    return new Error(
      [
        'macOS 접근성 권한이 필요합니다.',
        '현재 CLI를 실행한 앱에 손쉬운 사용(Accessibility) 권한을 허용한 뒤 다시 시도하세요.',
        `현재 경로: ${workspace_var}`,
      ].join('\n'),
    );
  }

  if (exit_code_var === 11) {
    return new Error(
      [
        '실행 중인 Antigravity 앱을 찾지 못했습니다.',
        `현재 경로: ${workspace_var}`,
      ].join('\n'),
    );
  }

  if (exit_code_var === 12) {
    return new Error(
      [
        'B 작업영역 창 생성에 실패했습니다.',
        `현재 경로: ${workspace_var}`,
      ].join('\n'),
    );
  }

  if (exit_code_var === 13 || exit_code_var === 14) {
    return new Error(
      [
        'B 창은 열렸을 수 있지만 최소화 확인에 실패했습니다.',
        'A 창은 바꾸지 않았습니다.',
        `현재 경로: ${workspace_var}`,
      ].join('\n'),
    );
  }

  return new Error(
    [
      `auto-launch helper 실패 (exit=${exit_code_var})`,
      `현재 경로: ${workspace_var}`,
    ].join('\n'),
  );
}

async function waitForExit_func(child_var: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolve_var, reject_var) => {
    child_var.once('error', reject_var);
    child_var.once('close', (code_var) => {
      resolve_var(code_var ?? 1);
    });
  });
}

async function launchWorkspaceWindowAndMinimize_func(workspace_var: string): Promise<void> {
  const forced_exit_code_var = process.env.ANTIGRAVITY_CLI_TEST_HELPER_EXIT_CODE;
  if (forced_exit_code_var) {
    throw resolveHelperError_func(Number.parseInt(forced_exit_code_var, 10), workspace_var);
  }

  const script_path_var = process.env.ANTIGRAVITY_CLI_TEST_LAUNCH_SCRIPT;
  if (script_path_var) {
    const child_var = spawn(process.execPath, [script_path_var, workspace_var], {
      env: process.env,
      stdio: 'ignore',
      detached: true,
    });
    child_var.unref();
    process.stderr.write('  ◉ 새 작업영역 창을 생성 직후 최소화하는 중...\n');
    return;
  }

  if (!existsSync(HELPER_BINARY_PATH)) {
    throw new Error(
      [
        'ag-minimize helper 바이너리를 찾을 수 없습니다.',
        `기대 경로: ${HELPER_BINARY_PATH}`,
      ].join('\n'),
    );
  }

  const child_var = spawn(
    HELPER_BINARY_PATH,
    [
      '--bundle-id', ANTIGRAVITY_BUNDLE_ID,
      '--launch-bin', ANTIGRAVITY_LAUNCH_BINARY_PATH,
      '--workspace', workspace_var,
      '--poll-ms', '1',
      '--timeout-ms', '2000',
    ],
    {
      env: process.env,
      stdio: 'ignore',
    },
  );

  process.stderr.write('  ◉ 새 작업영역 창을 생성 직후 최소화하는 중...\n');
  const exit_code_var = await waitForExit_func(child_var);
  if (exit_code_var !== 0) {
    throw resolveHelperError_func(exit_code_var, workspace_var);
  }
}

function findExactInstance_func(workspace_var: string): DiscoveredInstance | null {
  const normalized_workspace_var = normalizeRealPath_func(workspace_var);
  const entries_var = readInstanceEntries_func();
  const matched_var = entries_var.find(
    (entry_var) => normalizeRealPath_func(entry_var.workspace) === normalized_workspace_var,
  );

  if (!matched_var) {
    return null;
  }

  return {
    port: matched_var.port,
    workspace: matched_var.workspace,
  };
}

function sleep_func(ms_var: number): Promise<void> {
  return new Promise((resolve_var) => {
    setTimeout(resolve_var, ms_var);
  });
}

async function waitForBridge_func(workspace_var: string): Promise<DiscoveredInstance> {
  const timeout_ms_var = Number.parseInt(process.env.ANTIGRAVITY_CLI_BOOT_TIMEOUT_MS ?? '30000', 10);
  const deadline_var = Date.now() + timeout_ms_var;

  while (Date.now() < deadline_var) {
    const instance_var = findExactInstance_func(workspace_var);
    if (instance_var) {
      try {
        const client_var = new BridgeClient(instance_var.port);
        const health_var = await client_var.get('health');
        if (health_var.success) {
          return instance_var;
        }
      } catch {
        // ignore until timeout
      }
    }

    await sleep_func(200);
  }

  throw new Error(
    [
      'B 작업영역 Bridge 준비가 끝나지 않았습니다.',
      `현재 경로: ${workspace_var}`,
    ].join('\n'),
  );
}

export async function resolveClientForWorkspace_func(
  override_port_var?: number,
  cwd_var: string = process.cwd(),
): Promise<ResolvedClient> {
  if (override_port_var) {
    const instance_var = discoverInstance(override_port_var, cwd_var);
    return {
      client_var: new BridgeClient(instance_var.port),
      instance_var,
      auto_launch_var: false,
    };
  }

  try {
    const instance_var = discoverInstance(undefined, cwd_var);
    return {
      client_var: new BridgeClient(instance_var.port),
      instance_var,
      auto_launch_var: false,
    };
  } catch (error_var) {
    if (!isAntigravityRunning_func()) {
      throw error_var;
    }

    await launchWorkspaceWindowAndMinimize_func(cwd_var);
    const instance_var = await waitForBridge_func(cwd_var);
    return {
      client_var: new BridgeClient(instance_var.port),
      instance_var,
      auto_launch_var: true,
    };
  }
}
