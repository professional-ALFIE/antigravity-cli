/**
 * Antigravity headless backend configuration.
 *
 * 원본: scripts/headless-backend/config.ts (stage20~55에서 검증됨)
 * 이관 방법: 검증된 코드를 그대로 복사.
 *
 * 변경 사항:
 * - workspaceRootPath default를 process.cwd()로 고정 (spec 결정)
 * - import 경로만 수정
 */

import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// AppVariant 개념 제거: clone은 로컬 실험 흔적이었음.
// Antigravity.app 하나만 지원한다.

export interface HeadlessBackendEnv {
  ANTIGRAVITY_OAUTH_SENTINEL_KEY?: string;
  ANTIGRAVITY_OAUTH_ACCESS_TOKEN?: string;
  ANTIGRAVITY_OAUTH_REFRESH_TOKEN?: string;
  ANTIGRAVITY_OAUTH_TOKEN_TYPE?: string;
  ANTIGRAVITY_OAUTH_EXPIRY_SECONDS?: string;
  ANTIGRAVITY_AUTHSTATUS_API_KEY?: string;
  ANTIGRAVITY_WORKSPACE_ROOT_PATH?: string;
  [key_var: string]: string | undefined;
}

export interface HeadlessBackendConfig {
  repoRootPath: string;
  homeDirPath: string;
  envFilePath: string;
  env: HeadlessBackendEnv;
  appPath: string;
  extensionRootPath: string;
  distPath: string;
  binPath: string;
  languageServerPath: string;
  certPath: string;
  extensionVersion: string;
  ideVersion: string;
  workspaceRootPath: string;
  workspaceRootUri: string;
  workspaceId: string;
  profileDirPath: string;
  stateDbPath: string;
  daemonDirPath: string;
  outputDirPath: string;
}

export interface ResolveHeadlessBackendConfigOptions {
  repoRootPath?: string;
  homeDirPath?: string;
  envFilePath?: string;
  outputDirPath?: string;
  now?: Date;
}

const APP_PATH = '/Applications/Antigravity.app';
const IDE_VERSION = '1.20.6';

function getDefaultRepoRootPath_func(): string {
  // 이 파일 위치: src/utils/config.ts
  // 현재 저장소 루트: issue-36-antigravity-headless/
  // 경로: src/utils → src → repo root
  const current_file_var = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(current_file_var), '..', '..');
}

function stripQuotes_func(value_var: string): string {
  if (
    (value_var.startsWith('"') && value_var.endsWith('"'))
    || (value_var.startsWith("'") && value_var.endsWith("'"))
  ) {
    return value_var.slice(1, -1);
  }
  return value_var;
}

function formatTimestamp_func(date_var: Date): string {
  const year_var = date_var.getUTCFullYear();
  const month_var = String(date_var.getUTCMonth() + 1).padStart(2, '0');
  const day_var = String(date_var.getUTCDate()).padStart(2, '0');
  const hour_var = String(date_var.getUTCHours()).padStart(2, '0');
  const minute_var = String(date_var.getUTCMinutes()).padStart(2, '0');
  const second_var = String(date_var.getUTCSeconds()).padStart(2, '0');
  return `${year_var}${month_var}${day_var}-${hour_var}${minute_var}${second_var}`;
}

/**
 * IDE 방식과 동일한 workspace_id 생성.
 * IDE: sanitizeFileName(workspaceFolders[0].uri.toString())
 * 예: file:///Users/xxx/project → file____Users_xxx_project
 * source: extension_formatted_latest.js:111205
 */
function sanitizeFileName_func(input_var: string): string {
  return input_var.replace(/[~!@#$%^&*()_+={}[\]:;"<>,.?/\\|`'\s-]+/g, '_');
}

function createWorkspaceId_func(workspace_root_path_var: string): string {
  const uri_var = pathToFileURL(workspace_root_path_var).href;
  return sanitizeFileName_func(uri_var);
}

function readExtensionVersion_func(extension_root_path_var: string): string {
  const manifest_path_var = path.join(extension_root_path_var, 'package.json');
  if (!existsSync(manifest_path_var)) {
    return '0.2.0';
  }

  const manifest_var = JSON.parse(readFileSync(manifest_path_var, 'utf8')) as { version?: string };
  return manifest_var.version ?? '0.2.0';
}

export function loadEnvFile(env_file_path_var: string): HeadlessBackendEnv {
  if (!existsSync(env_file_path_var)) {
    return {};
  }

  // .env는 선택적. OAuth는 state.vscdb에서 온다.
  // Dropbox가 파일을 잠그면 (EPERM) 무시한다.
  let raw_text_var: string;
  try {
    raw_text_var = readFileSync(env_file_path_var, 'utf8');
  } catch {
    return {};
  }

  const env_var: HeadlessBackendEnv = {};
  const lines_var = raw_text_var.split(/\r?\n/u);

  for (const line_var of lines_var) {
    const trimmed_var = line_var.trim();
    if (!trimmed_var || trimmed_var.startsWith('#')) {
      continue;
    }

    const separator_index_var = trimmed_var.indexOf('=');
    if (separator_index_var === -1) {
      continue;
    }

    const key_var = trimmed_var.slice(0, separator_index_var).trim();
    const raw_value_var = trimmed_var.slice(separator_index_var + 1).trim();
    env_var[key_var] = stripQuotes_func(raw_value_var);
  }

  return env_var;
}

export function resolveHeadlessBackendConfig(
  options_var: ResolveHeadlessBackendConfigOptions = {},
): HeadlessBackendConfig {
  const repo_root_path_var = options_var.repoRootPath ?? getDefaultRepoRootPath_func();
  const home_dir_path_var = options_var.homeDirPath ?? os.homedir();
  const env_file_path_var = options_var.envFilePath ?? path.join(repo_root_path_var, '.env');
  const env_var = loadEnvFile(env_file_path_var);

  const app_path_var = APP_PATH;
  const extension_root_path_var = path.join(
    app_path_var,
    'Contents',
    'Resources',
    'app',
    'extensions',
    'antigravity',
  );
  const dist_path_var = path.join(extension_root_path_var, 'dist');
  const bin_path_var = path.join(extension_root_path_var, 'bin');
  // .env의 ANTIGRAVITY_WORKSPACE_ROOT_PATH는 무시한다.
  // workspace는 항상 실행 위치(process.cwd())이다.
  const workspace_root_path_var = process.cwd();
  const timestamp_var = formatTimestamp_func(options_var.now ?? new Date());
  const output_dir_path_var = options_var.outputDirPath
    ?? path.join(repo_root_path_var, 'tmp', 'headless-backend', timestamp_var);

  return {
    repoRootPath: repo_root_path_var,
    homeDirPath: home_dir_path_var,
    envFilePath: env_file_path_var,
    env: env_var,
    appPath: 'C:\\Users\\aa22s\\AppData\\Local\\Programs\\Antigravity\\resources\\app\\extensions\\antigravity',
    extensionRootPath: extension_root_path_var,
    distPath: 'C:\\Users\\aa22s\\AppData\\Local\\Programs\\Antigravity\\resources\\app\\extensions\\antigravity\\dist',
    binPath: bin_path_var,
    languageServerPath: path.join(bin_path_var, 'language_server_macos_arm'),
    certPath: 'C:\\Users\\aa22s\\AppData\\Local\\Programs\\Antigravity\\resources\\app\\extensions\\antigravity\\dist\\languageServer\\cert.pem',
    extensionVersion: readExtensionVersion_func(extension_root_path_var),
    ideVersion: IDE_VERSION,
    workspaceRootPath: workspace_root_path_var,
    workspaceRootUri: 'file:///wsl.localhost/Ubuntu/home/aa22s/haejoe',
    workspaceId: createWorkspaceId_func(workspace_root_path_var),
    profileDirPath: path.join(
      home_dir_path_var,
      'Library',
      'Application Support',
      'Antigravity',
      'User',
      'globalStorage',
    ),
    stateDbPath: path.join(
      home_dir_path_var,
      'Library',
      'Application Support',
      'Antigravity',
      'User',
      'globalStorage',
      'state.vscdb',
    ),
    daemonDirPath: path.join(home_dir_path_var, '.gemini', 'antigravity', 'daemon'),
    outputDirPath: output_dir_path_var,
  };
}
