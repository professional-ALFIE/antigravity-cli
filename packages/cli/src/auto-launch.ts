import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { BridgeClient } from './client.js';
import { discoverInstance, type DiscoveredInstance } from './discovery.js';
import { Spinner } from './spinner.js';

const INSTANCES_FILE = join(homedir(), '.antigravity-cli', 'instances.json');
const ANTIGRAVITY_APP_BINARY_PATH_PREFIX = 'Antigravity.app';
const ANTIGRAVITY_LAUNCH_BINARY_PATH = '/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity';
const ANTIGRAVITY_BUNDLE_ID = 'com.google.antigravity';
const ANTIGRAVITY_WINDOWS_PROCESS_NAME = 'Antigravity';
const HELPER_BINARY_PATH = fileURLToPath(
  new URL('../native-bin/ag-minimize-darwin-universal', import.meta.url),
);

interface InstanceEntry {
  port: number;
  workspace: string;
  pid: number;
}

interface WindowsLaunchTarget {
  launch_binary_var: string;
  launch_args_var: string[];
  launch_env_var: Record<string, string>;
  cli_script_var: string | null;
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

function normalizeComparablePath_func(path_var: string): string {
  const normalized_var = normalizeRealPath_func(path_var)
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');

  if (process.platform === 'win32') {
    return normalized_var.toLowerCase();
  }

  return normalized_var;
}

function getWindowsLaunchBinaryCandidates_func(): string[] {
  const local_app_data_var = process.env.LOCALAPPDATA;
  if (!local_app_data_var) {
    return [];
  }

  const install_root_var = join(local_app_data_var, 'Programs', 'Antigravity');
  return [
    join(install_root_var, 'bin', 'antigravity.cmd'),
    join(install_root_var, 'bin', 'antigravity'),
    join(install_root_var, 'Antigravity.exe'),
    join(install_root_var, 'resources', 'app', 'bin', 'antigravity.cmd'),
    join(install_root_var, 'resources', 'app', 'bin', 'antigravity'),
  ];
}

function resolveLaunchBinaryPath_func(): string | null {
  if (process.platform === 'darwin') {
    return existsSync(ANTIGRAVITY_LAUNCH_BINARY_PATH) ? ANTIGRAVITY_LAUNCH_BINARY_PATH : null;
  }

  if (process.platform === 'win32') {
    return getWindowsLaunchBinaryCandidates_func().find((candidate_var) => existsSync(candidate_var)) ?? null;
  }

  return null;
}

function resolveWindowsLaunchTarget_func(launch_binary_var: string, workspace_var: string): WindowsLaunchTarget {
  const launch_name_var = basename(launch_binary_var).toLowerCase();
  const install_root_var = launch_name_var === 'antigravity.exe'
    ? dirname(launch_binary_var)
    : dirname(dirname(launch_binary_var));
  const electron_binary_var = join(install_root_var, 'Antigravity.exe');
  const cli_script_var = join(install_root_var, 'resources', 'app', 'out', 'cli.js');

  if (existsSync(electron_binary_var) && existsSync(cli_script_var)) {
    return {
      launch_binary_var: electron_binary_var,
      launch_args_var: [cli_script_var, '--new-window', workspace_var],
      launch_env_var: {
        ELECTRON_RUN_AS_NODE: '1',
        VSCODE_DEV: '',
      },
      cli_script_var,
    };
  }

  return {
    launch_binary_var,
    launch_args_var: ['--new-window', workspace_var],
    launch_env_var: {},
    cli_script_var: null,
  };
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
    if (process.platform === 'win32') {
      const script_var = "$process_var = Get-Process 'Antigravity' -ErrorAction SilentlyContinue; if ($process_var) { exit 0 }; exit 1";
      const encoded_var = Buffer.from(script_var, 'utf16le').toString('base64');
      const result_var = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-EncodedCommand', encoded_var],
        {
          stdio: 'ignore',
          windowsHide: true,
        },
      );
      return result_var.status === 0;
    }

    return false;
  }

  const result_var = spawnSync(
    'pgrep',
    ['-f', ANTIGRAVITY_APP_BINARY_PATH_PREFIX],
    { stdio: 'ignore' },
  );
  return result_var.status === 0;
}

function canAutoLaunch_func(): boolean {
  if (
    process.env.ANTIGRAVITY_CLI_TEST_LAUNCH_SCRIPT
    || process.env.ANTIGRAVITY_CLI_TEST_HELPER_EXIT_CODE
  ) {
    return true;
  }

  return Boolean(resolveLaunchBinaryPath_func());
}

function resolveHelperError_func(exit_code_var: number, workspace_var: string): Error {
  if (process.platform === 'win32') {
    if (exit_code_var === 10) {
      return new Error(
        [
          'Windows 창 제어 helper 초기화에 실패했습니다.',
          `현재 경로: ${workspace_var}`,
        ].join('\n'),
      );
    }

    if (exit_code_var === 11) {
      return new Error(
        [
          '실행 가능한 Antigravity Windows 런처를 찾지 못했습니다.',
          `현재 경로: ${workspace_var}`,
        ].join('\n'),
      );
    }

    if (exit_code_var === 12) {
      return new Error(
        [
          '새 작업영역 창 생성에 실패했습니다.',
          `현재 경로: ${workspace_var}`,
        ].join('\n'),
      );
    }

    if (exit_code_var === 13 || exit_code_var === 14) {
      return new Error(
        [
          '새 작업영역 창이 열렸을 수 있지만 최소화 확인에 실패했습니다.',
          `현재 경로: ${workspace_var}`,
        ].join('\n'),
      );
    }
  }

  if (exit_code_var === 10) {
    return new Error(
      [
        'macOS Accessibility permission required.',
        'Grant Accessibility permission to the app running this CLI and try again.',
        `Current path: ${workspace_var}`,
      ].join('\n'),
    );
  }

  if (exit_code_var === 11) {
    return new Error(
      [
        'Could not find a running Antigravity app.',
        `Current path: ${workspace_var}`,
      ].join('\n'),
    );
  }

  if (exit_code_var === 12) {
    return new Error(
      [
        'Failed to create a new workspace window.',
        `Current path: ${workspace_var}`,
      ].join('\n'),
    );
  }

  if (exit_code_var === 13 || exit_code_var === 14) {
    return new Error(
      [
        'New workspace window opened but minimization failed.',
        'Existing windows were not affected.',
        `Current path: ${workspace_var}`,
      ].join('\n'),
    );
  }

  return new Error(
    [
      `auto-launch helper failed (exit=${exit_code_var})`,
      `Current path: ${workspace_var}`,
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

function buildWindowsLaunchScript_func(): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Collections.Generic;',
    'using System.Runtime.InteropServices;',
    'namespace AGCli {',
    'public static class Win32 {',
    '  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);',
    '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);',
    '  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindowVisible(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);',
    '  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);',
    '  public static long[] GetVisibleWindowHandles(int[] processIds) {',
    '    var pids = new HashSet<int>(processIds ?? Array.Empty<int>());',
    '    var handles = new List<long>();',
    '    EnumWindows(delegate (IntPtr hWnd, IntPtr lParam) {',
    '      if (!IsWindowVisible(hWnd)) return true;',
    '      uint pid;',
    '      GetWindowThreadProcessId(hWnd, out pid);',
    '      if (pids.Contains((int)pid)) handles.Add(hWnd.ToInt64());',
    '      return true;',
    '    }, IntPtr.Zero);',
    '    return handles.ToArray();',
    '  }',
    '}',
    '}',
    '"@',
    "$launchBinary = $env:AG_WINDOWS_LAUNCH_BINARY",
    "$cliScript = $env:AG_WINDOWS_CLI_SCRIPT",
    "$workspace = $env:AG_WINDOWS_WORKSPACE",
    "if ([string]::IsNullOrWhiteSpace($launchBinary) -or -not (Test-Path $launchBinary)) { exit 11 }",
    `$beforePids = @(Get-Process '${ANTIGRAVITY_WINDOWS_PROCESS_NAME}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)`,
    '$beforeHandles = [System.Collections.Generic.HashSet[long]]::new()',
    'foreach ($handle in [AGCli.Win32]::GetVisibleWindowHandles([int[]]$beforePids)) { [void]$beforeHandles.Add($handle) }',
    'if ([string]::IsNullOrWhiteSpace($cliScript)) {',
    "  Start-Process -FilePath $launchBinary -ArgumentList @('--new-window', $workspace) | Out-Null",
    '} else {',
    '  $startInfo = New-Object System.Diagnostics.ProcessStartInfo',
    '  $startInfo.FileName = $launchBinary',
    '  $startInfo.UseShellExecute = $false',
    "  $startInfo.Arguments = ('\"' + $cliScript + '\" --new-window \"' + $workspace + '\"')",
    "  $startInfo.Environment['ELECTRON_RUN_AS_NODE'] = '1'",
    "  $startInfo.Environment['VSCODE_DEV'] = ''",
    '  [System.Diagnostics.Process]::Start($startInfo) | Out-Null',
    '}',
    '$deadline = [DateTime]::UtcNow.AddMilliseconds(2500)',
    'while ([DateTime]::UtcNow -lt $deadline) {',
    `  $afterPids = @(Get-Process '${ANTIGRAVITY_WINDOWS_PROCESS_NAME}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)`,
    '  foreach ($handle in [AGCli.Win32]::GetVisibleWindowHandles([int[]]$afterPids)) {',
    '    if (-not $beforeHandles.Contains($handle)) {',
    '      [AGCli.Win32]::ShowWindowAsync([IntPtr]$handle, 6) | Out-Null',
    '      exit 0',
    '    }',
    '  }',
    '  Start-Sleep -Milliseconds 100',
    '}',
    'exit 0',
  ].join('\n');
}

async function launchWorkspaceWindowBasicWindows_func(
  launch_binary_var: string,
  workspace_var: string,
  spinner_var?: Spinner,
): Promise<void> {
  const launch_target_var = resolveWindowsLaunchTarget_func(launch_binary_var, workspace_var);
  const child_var = spawn(
    launch_target_var.launch_binary_var,
    launch_target_var.launch_args_var,
    {
      env: {
        ...process.env,
        ...launch_target_var.launch_env_var,
      },
      stdio: 'ignore',
      detached: true,
    },
  );

  child_var.unref();

  if (spinner_var) spinner_var.update('새 작업영역 생성');
}

async function launchWorkspaceWindowAndMinimizeWindows_func(
  workspace_var: string,
  spinner_var?: Spinner,
): Promise<void> {
  const launch_binary_var = resolveLaunchBinaryPath_func();
  if (!launch_binary_var) {
    throw resolveHelperError_func(11, workspace_var);
  }

  const launch_target_var = resolveWindowsLaunchTarget_func(launch_binary_var, workspace_var);
  const script_var = buildWindowsLaunchScript_func();
  const encoded_var = Buffer.from(script_var, 'utf16le').toString('base64');
  const child_var = spawn(
    'powershell.exe',
    ['-NoProfile', '-EncodedCommand', encoded_var],
    {
      env: {
        ...process.env,
        AG_WINDOWS_LAUNCH_BINARY: launch_target_var.launch_binary_var,
        AG_WINDOWS_CLI_SCRIPT: launch_target_var.cli_script_var ?? '',
        AG_WINDOWS_WORKSPACE: workspace_var,
      },
      stdio: 'ignore',
      windowsHide: true,
    },
  );

  if (spinner_var) spinner_var.update('새 작업영역 생성 후 최소화');
  const exit_code_var = await waitForExit_func(child_var);
  if (exit_code_var === 0) {
    return;
  }

  if (exit_code_var === 13 || exit_code_var === 14) {
    if (spinner_var) spinner_var.update('새 작업영역 생성 (최소화 생략)');
    return;
  }

  try {
    await launchWorkspaceWindowBasicWindows_func(launch_binary_var, workspace_var, spinner_var);
    return;
  } catch {
    throw resolveHelperError_func(exit_code_var, workspace_var);
  }
}

async function launchWorkspaceWindowAndMinimize_func(workspace_var: string, spinner_var?: Spinner): Promise<void> {
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
    if (spinner_var) spinner_var.update('Creating new workspace window (minimized)');
    return;
  }

  if (process.platform === 'win32') {
    await launchWorkspaceWindowAndMinimizeWindows_func(workspace_var, spinner_var);
    return;
  }

  if (!existsSync(HELPER_BINARY_PATH)) {
    throw new Error(
      [
        'ag-minimize helper binary not found.',
        `Expected path: ${HELPER_BINARY_PATH}`,
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

  if (spinner_var) spinner_var.update('Creating new workspace window (minimized)');
  const exit_code_var = await waitForExit_func(child_var);
  if (exit_code_var !== 0) {
    throw resolveHelperError_func(exit_code_var, workspace_var);
  }
}

function findExactInstance_func(workspace_var: string): DiscoveredInstance | null {
  const normalized_workspace_var = normalizeComparablePath_func(workspace_var);
  const entries_var = readInstanceEntries_func();
  const matched_var = entries_var.find(
    (entry_var) => normalizeComparablePath_func(entry_var.workspace) === normalized_workspace_var,
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

async function waitForBridge_func(workspace_var: string, spinner_var?: Spinner): Promise<DiscoveredInstance> {
  const timeout_ms_var = Number.parseInt(process.env.ANTIGRAVITY_CLI_BOOT_TIMEOUT_MS ?? '30000', 10);
  const deadline_var = Date.now() + timeout_ms_var;

  if (spinner_var) spinner_var.update('Waiting for Bridge — starting background instance... (subsequent runs connect instantly)');

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
      'Bridge for the new workspace did not become ready in time.',
      `Current path: ${workspace_var}`,
    ].join('\n'),
  );
}

function captureForegroundApp_func(): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    const output_var = execFileSync('osascript', [
      '-e',
      'tell application "System Events" to get bundle identifier of first process whose frontmost is true',
    ], { encoding: 'utf-8', timeout: 3000 });
    return output_var.trim() || null;
  } catch {
    return null;
  }
}

function guardForegroundApp_func(bundle_id_var: string | null): void {
  if (!bundle_id_var || process.platform !== 'darwin') return;
  try {
    const child_var = spawn('osascript', [
      '-e',
      [
        `repeat 3 times`,
        `  tell application id "${bundle_id_var}" to activate`,
        `  delay 0.5`,
        `end repeat`,
      ].join('\n'),
    ], {
      detached: true,
      stdio: 'ignore',
    });
    child_var.unref();
  } catch {
    // best-effort
  }
}

export async function resolveClientForWorkspace_func(
  override_port_var?: number,
  cwd_var: string = process.cwd(),
  spinner_var?: Spinner,
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
    if (!isAntigravityRunning_func() && !canAutoLaunch_func()) {
      throw error_var;
    }

    const previous_app_var = captureForegroundApp_func();
    await launchWorkspaceWindowAndMinimize_func(cwd_var, spinner_var);
    guardForegroundApp_func(previous_app_var);
    const instance_var = await waitForBridge_func(cwd_var, spinner_var);
    return {
      client_var: new BridgeClient(instance_var.port),
      instance_var,
      auto_launch_var: true,
    };
  }
}
