/**
 * Auto-Run Fix — Patches the "Always Proceed" terminal policy to actually auto-execute.
 *
 * Uses structural regex matching to find the onChange handler in minified code
 * and injects a missing useEffect that auto-confirms commands when policy is EAGER.
 *
 * Works across AG versions because it matches code STRUCTURE, not variable NAMES.
 *
 * Based on: Kanezal/better-antigravity (AGPL-3.0)
 *
 * @module auto-run
 */

import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

/** Marker comment to identify our patches */
const PATCH_MARKER = '/*BA:autorun*/';

function escapeRegex_func(value_var: string): string {
  return value_var.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PATCH_MARKER_REGEX = new RegExp(escapeRegex_func(PATCH_MARKER), 'g');
const PATCH_STRUCTURE_REGEX = new RegExp(
  `;${escapeRegex_func(PATCH_MARKER)}\\w+\\(\\(\\)=>\\{[^{}]+\\},\\[\\]\\);`,
  'g',
);
const AUTO_RUN_LOCK_FILENAME = '.ba-autorun.lock';
const AUTO_RUN_LOCK_WAIT_MS = 10000;
const AUTO_RUN_LOCK_STALE_MS = 30000;
const AUTO_RUN_LOCK_POLL_MS = 150;

export type PatchState = 'unpatched' | 'patched' | 'patch-corrupted';

interface ProductSnapshot {
  productPath: string;
  productBackupPath: string;
  productRaw: string;
}

interface RestoreProductResult {
  productRaw: string;
  allRestored: boolean;
}

interface AutoRunLockHandle {
  lockPath: string;
  fileHandle: fs.promises.FileHandle;
  released: boolean;
}

let syntax_check_override_var: ((file_path: string) => void) | null = null;
let app_root_override_var: string | null | undefined = undefined;

/**
 * Resolve the Antigravity app root directory (cross-platform).
 * 이 경로 아래에 out/ 디렉토리가 있다.
 */
export function getAppRoot(): string | null {
  if (app_root_override_var !== undefined) {
    return app_root_override_var;
  }

  const platform_var = process.platform;
  let root_var: string;

  if (platform_var === 'darwin') {
    root_var = '/Applications/Antigravity.app/Contents/Resources/app';
  } else if (platform_var === 'win32') {
    const app_data_var = process.env.LOCALAPPDATA || '';
    root_var = path.join(app_data_var, 'Programs', 'Antigravity', 'resources', 'app');
  } else {
    root_var = '/usr/share/antigravity/resources/app';
  }

  return fs.existsSync(root_var) ? root_var : null;
}

/**
 * Discover target files across platform-specific paths.
 *
 * macOS와 Windows에서 파일 위치가 다름:
 * - macOS workbench: out/vs/workbench/workbench.desktop.main.js
 * - macOS jetski:    out/jetskiAgent/main.js
 * - Windows 양쪽:    out/vs/code/electron-browser/workbench/ 하위
 */
export function discoverTargetFiles(app_root: string): Array<{ path: string; label: string }> {
  const candidates_var = [
    { path: path.join(app_root, 'out', 'vs', 'workbench', 'workbench.desktop.main.js'), label: 'workbench' },
    { path: path.join(app_root, 'out', 'jetskiAgent', 'main.js'), label: 'jetskiAgent' },
    { path: path.join(app_root, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.desktop.main.js'), label: 'workbench' },
    { path: path.join(app_root, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'jetskiAgent.js'), label: 'jetskiAgent' },
  ];

  const seen_var = new Set<string>();
  return candidates_var.filter((file_var) => {
    if (seen_var.has(file_var.label)) return false;
    if (!fs.existsSync(file_var.path)) return false;
    seen_var.add(file_var.label);
    return true;
  });
}

/**
 * product.json의 체크섬 키 매핑.
 * 파일 경로(app root 기준 out/ 제외)를 product.json checksums 키로 변환.
 */
const CHECKSUM_KEY_MAP: Record<string, string> = {
  workbench: 'vs/workbench/workbench.desktop.main.js',
  jetskiAgent: 'jetskiAgent/main.js',
};

/**
 * content 기준 패치 상태 판정.
 * marker만 있다고 patched로 보지 않고 구조까지 함께 검증한다.
 */
export function detectPatchStateFromContent(content_var: string): PatchState {
  const marker_count_var = content_var.match(PATCH_MARKER_REGEX)?.length ?? 0;
  if (marker_count_var === 0) {
    return 'unpatched';
  }

  const structure_count_var = content_var.match(PATCH_STRUCTURE_REGEX)?.length ?? 0;
  if (marker_count_var === 1 && structure_count_var === 1) {
    return 'patched';
  }

  return 'patch-corrupted';
}

export async function getPatchState(file_path: string): Promise<PatchState> {
  try {
    const content_var = await fsp.readFile(file_path, 'utf8');
    return detectPatchStateFromContent(content_var);
  } catch {
    return 'unpatched';
  }
}

/**
 * Check if a file already has the auto-run patch applied.
 */
export async function isPatched(file_path: string): Promise<boolean> {
  return (await getPatchState(file_path)) === 'patched';
}

/**
 * Analyze a file to find the onChange handler and extract variable names.
 * Returns null if pattern not found (file may already be fixed by AG update).
 *
 * 두 가지 패턴을 시도한다:
 * 1) Windows: callback=useCallback((arg)=>{setFn(arg),arg===ENUM.EAGER&&confirm(!0)},[])
 * 2) macOS:   y=Mt(_=>{r?.setTerminalAutoExecutionPolicy?.(_),_===Dhe.EAGER&&b(!0)},[r,b])
 */
function analyzeFile(content_var: string): AnalysisResult | null {
  const on_change_regex = /(\w+)=(\w+)\((\w+)=>\{[^}]*?(\w+)\.EAGER&&(\w+)\(!0\)\},\[/g;
  const match_var = on_change_regex.exec(content_var);

  if (!match_var) return null;

  const [full_match_var, , , , enum_name_var, confirm_fn_var] = match_var;
  const insert_pos_var = match_var.index + full_match_var.length;

  const context_start_var = Math.max(0, match_var.index - 3000);
  const context_end_var = Math.min(content_var.length, match_var.index + 3000);
  const context_var = content_var.substring(context_start_var, context_end_var);

  const policy_match_var = /(\w+)=\w+\?\.terminalAutoExecutionPolicy\?\?(\w+)\.OFF/.exec(context_var);
  const secure_match_var = /(\w+)=\w+\?\.secureModeEnabled\?\?!1/.exec(context_var);

  if (!policy_match_var || !secure_match_var) return null;

  const use_effect_fn_var = findUseEffect(content_var);
  if (!use_effect_fn_var) return null;

  const after_on_change_var = content_var.indexOf('])', insert_pos_var);
  if (after_on_change_var === -1) return null;

  const insert_at_var = content_var.indexOf(';', after_on_change_var);
  if (insert_at_var === -1) return null;

  return {
    enumName: enum_name_var,
    confirmFn: confirm_fn_var,
    policyVar: policy_match_var[1],
    secureVar: secure_match_var[1],
    useEffectFn: use_effect_fn_var,
    insertAt: insert_at_var + 1,
  };
}

/**
 * React 번들의 dispatcher alias 테이블에서 `useEffect:(\w+)` 패턴을 직접 추출한다.
 */
function findUseEffect(content_var: string): string | null {
  const match_var = /useEffect:(\w+)/.exec(content_var);
  return match_var ? match_var[1] : null;
}

interface AnalysisResult {
  enumName: string;
  confirmFn: string;
  policyVar: string;
  secureVar: string;
  useEffectFn: string;
  insertAt: number;
}

export interface PatchResult {
  success: boolean;
  label: string;
  status: 'patched' | 'already-patched' | 'patch-corrupted' | 'pattern-not-found' | 'syntax-check-failed' | 'reverted' | 'no-backup' | 'error';
  bytesAdded?: number;
  error?: string;
}

function computeChecksum_func(content_var: Buffer): string {
  const hash_var = crypto.createHash('sha256').update(content_var).digest('base64');
  return hash_var.replace(/=+$/, '');
}

async function cleanupTempFile_func(file_path: string): Promise<void> {
  try {
    const stat_var = await fsp.lstat(file_path);
    if (stat_var.isFile() || stat_var.isSymbolicLink()) {
      await fsp.unlink(file_path);
    }
  } catch {
    // ignore
  }
}

function sleep_func(ms_var: number): Promise<void> {
  return new Promise((resolve_var) => {
    setTimeout(resolve_var, ms_var);
  });
}

async function cleanupLockFile_func(lock_path: string): Promise<void> {
  try {
    await fsp.unlink(lock_path);
  } catch (error_var: any) {
    if (error_var?.code !== 'ENOENT') {
      throw error_var;
    }
  }
}

async function tryRemoveStaleLock_func(lock_path: string): Promise<void> {
  try {
    const stat_var = await fsp.stat(lock_path);
    if ((Date.now() - stat_var.mtimeMs) < AUTO_RUN_LOCK_STALE_MS) {
      return;
    }

    await cleanupLockFile_func(lock_path);
  } catch (error_var: any) {
    if (error_var?.code !== 'ENOENT') {
      throw error_var;
    }
  }
}

async function acquireAutoRunLock_func(app_root: string): Promise<AutoRunLockHandle> {
  const lock_path_var = path.join(app_root, AUTO_RUN_LOCK_FILENAME);
  const deadline_var = Date.now() + AUTO_RUN_LOCK_WAIT_MS;

  while (true) {
    try {
      const file_handle_var = await fsp.open(lock_path_var, 'wx');

      try {
        await file_handle_var.writeFile(JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
        }), 'utf8');
      } catch (error_var) {
        try {
          await file_handle_var.close();
        } catch {
          // ignore
        }
        await cleanupLockFile_func(lock_path_var);
        throw error_var;
      }

      return {
        lockPath: lock_path_var,
        fileHandle: file_handle_var,
        released: false,
      };
    } catch (error_var: any) {
      if (error_var?.code !== 'EEXIST') {
        throw error_var;
      }

      await tryRemoveStaleLock_func(lock_path_var);

      if (Date.now() >= deadline_var) {
        throw new Error(`auto-run lock timeout: ${lock_path_var}`);
      }

      await sleep_func(AUTO_RUN_LOCK_POLL_MS);
    }
  }
}

async function releaseAutoRunLock_func(lock_var: AutoRunLockHandle): Promise<void> {
  if (lock_var.released) {
    return;
  }
  lock_var.released = true;

  try {
    await lock_var.fileHandle.close();
  } catch {
    // ignore
  }

  await cleanupLockFile_func(lock_var.lockPath);
}

async function writeFileAtomically_func(file_path: string, content_var: string | Buffer): Promise<void> {
  const tmp_path_var = file_path + '.ba-tmp';

  try {
    await cleanupTempFile_func(tmp_path_var);
    await fsp.writeFile(tmp_path_var, content_var);
    await fsp.rename(tmp_path_var, file_path);
  } catch (error_var) {
    await cleanupTempFile_func(tmp_path_var);
    throw error_var;
  }
}

function getPatchTempPath_func(file_path: string): string {
  return file_path + '.ba-tmp.js';
}

async function preparePatchTempFile_func(file_path: string, content_var: string): Promise<string> {
  const tmp_path_var = getPatchTempPath_func(file_path);
  await cleanupTempFile_func(tmp_path_var);
  await fsp.writeFile(tmp_path_var, content_var, 'utf8');
  return tmp_path_var;
}

async function ensureBackupFile_func(file_path: string): Promise<string> {
  const backup_path_var = file_path + '.ba-backup';
  try {
    await fsp.access(backup_path_var);
  } catch {
    await fsp.copyFile(file_path, backup_path_var);
  }
  return backup_path_var;
}

function getProductPaths_func(app_root: string): { productPath: string; productBackupPath: string } {
  const product_path_var = path.join(app_root, 'product.json');
  return {
    productPath: product_path_var,
    productBackupPath: product_path_var + '.ba-backup',
  };
}

async function readProductSnapshot_func(app_root: string): Promise<ProductSnapshot> {
  const paths_var = getProductPaths_func(app_root);
  return {
    productPath: paths_var.productPath,
    productBackupPath: paths_var.productBackupPath,
    productRaw: await fsp.readFile(paths_var.productPath, 'utf8'),
  };
}

function setChecksumInProductRaw_func(product_raw_var: string, label_var: string, checksum_var: string): string {
  const checksum_key_var = CHECKSUM_KEY_MAP[label_var];
  if (!checksum_key_var) {
    throw new Error(`unknown checksum label: ${label_var}`);
  }

  const product_var = JSON.parse(product_raw_var);
  if (!product_var.checksums || typeof product_var.checksums !== 'object') {
    throw new Error('product.json checksums block missing');
  }

  product_var.checksums[checksum_key_var] = checksum_var;
  return JSON.stringify(product_var, null, '\t');
}

function buildRestoredProductRaw_func(current_raw_var: string, backup_raw_var: string, label_var: string): RestoreProductResult {
  const checksum_key_var = CHECKSUM_KEY_MAP[label_var];
  if (!checksum_key_var) {
    throw new Error(`unknown checksum label: ${label_var}`);
  }

  const current_product_var = JSON.parse(current_raw_var);
  const backup_product_var = JSON.parse(backup_raw_var);

  if (!current_product_var.checksums || typeof current_product_var.checksums !== 'object') {
    throw new Error('current product.json checksums block missing');
  }
  if (!backup_product_var.checksums || typeof backup_product_var.checksums !== 'object') {
    throw new Error('product.json backup checksums block missing');
  }
  if (!(checksum_key_var in backup_product_var.checksums)) {
    throw new Error(`product.json backup missing checksum key: ${checksum_key_var}`);
  }

  current_product_var.checksums[checksum_key_var] = backup_product_var.checksums[checksum_key_var];
  const product_raw_result_var = JSON.stringify(current_product_var, null, '\t');

  const all_restored_var = Object.values(CHECKSUM_KEY_MAP).every((key_var) => (
    current_product_var.checksums?.[key_var] === backup_product_var.checksums?.[key_var]
  ));

  return {
    productRaw: product_raw_result_var,
    allRestored: all_restored_var,
  };
}

function runSyntaxCheck_func(file_path: string): void {
  if (syntax_check_override_var) {
    syntax_check_override_var(file_path);
    return;
  }

  execSync(`node --check "${file_path}"`, { timeout: 10000, stdio: 'pipe' });
}

/**
 * Test-only hook to force syntax-check outcomes without mutating production behavior.
 */
export function setSyntaxCheckOverrideForTesting(run_func: ((file_path: string) => void) | null): void {
  syntax_check_override_var = run_func;
}

/**
 * Test-only hook to override app root resolution.
 */
export function setAppRootOverrideForTesting(root_var: string | null | undefined): void {
  app_root_override_var = root_var;
}

/**
 * Apply the auto-run patch to a single file.
 *
 * Task:
 * 1) 패치 상태 통합 판정
 * 2) syntax check 통과 후에만 backup + JS commit
 * 3) product.json은 atomic write로 checksum 갱신
 * 4) product.json 갱신 실패 시 JS를 원본 스냅샷으로 롤백
 */
export async function patchFile(file_path: string, label_var: string, app_root?: string): Promise<PatchResult> {
  let tmp_path_var = '';

  try {
    const original_file_buffer_var = await fsp.readFile(file_path);
    const original_content_var = original_file_buffer_var.toString('utf8');
    const patch_state_var = detectPatchStateFromContent(original_content_var);

    if (patch_state_var === 'patched') {
      return { success: true, label: label_var, status: 'already-patched' };
    }
    if (patch_state_var === 'patch-corrupted') {
      return {
        success: false,
        label: label_var,
        status: 'patch-corrupted',
        error: 'patch marker found but structure is invalid — run revert first',
      };
    }

    const analysis_var = analyzeFile(original_content_var);
    if (!analysis_var) {
      return { success: false, label: label_var, status: 'pattern-not-found' };
    }

    const product_snapshot_var = app_root ? await readProductSnapshot_func(app_root) : null;
    const {
      enumName,
      confirmFn,
      policyVar,
      secureVar,
      useEffectFn,
      insertAt,
    } = analysis_var;

    const patch_var = `;${PATCH_MARKER}${useEffectFn}(()=>{${policyVar}===${enumName}.EAGER&&!${secureVar}&&${confirmFn}(!0)},[]);`;
    const patched_content_var = original_content_var.substring(0, insertAt) + patch_var + original_content_var.substring(insertAt);
    const patched_buffer_var = Buffer.from(patched_content_var, 'utf8');

    tmp_path_var = await preparePatchTempFile_func(file_path, patched_content_var);

    try {
      runSyntaxCheck_func(tmp_path_var);
    } catch {
      await cleanupTempFile_func(tmp_path_var);
      return {
        success: false,
        label: label_var,
        status: 'syntax-check-failed',
        error: 'node --check failed on patched content',
      };
    }

    await ensureBackupFile_func(file_path);
    await fsp.rename(tmp_path_var, file_path);
    tmp_path_var = '';

    if (product_snapshot_var) {
      try {
        await ensureBackupFile_func(product_snapshot_var.productPath);

        const checksum_var = computeChecksum_func(patched_buffer_var);
        const updated_product_raw_var = setChecksumInProductRaw_func(product_snapshot_var.productRaw, label_var, checksum_var);
        await writeFileAtomically_func(product_snapshot_var.productPath, updated_product_raw_var);
      } catch (error_var) {
        const error_message_var = error_var instanceof Error ? error_var.message : String(error_var);
        try {
          await writeFileAtomically_func(file_path, original_file_buffer_var);
        } catch (rollback_error_var) {
          const rollback_message_var = rollback_error_var instanceof Error ? rollback_error_var.message : String(rollback_error_var);
          return {
            success: false,
            label: label_var,
            status: 'error',
            error: `checksum update failed during product.json commit: ${error_message_var}; JS rollback also failed: ${rollback_message_var}`,
          };
        }

        return {
          success: false,
          label: label_var,
          status: 'error',
          error: `checksum update failed during product.json commit: ${error_message_var}; JS rolled back to original snapshot`,
        };
      }
    }

    return { success: true, label: label_var, status: 'patched', bytesAdded: patch_var.length };
  } catch (error_var) {
    await cleanupTempFile_func(tmp_path_var || getPatchTempPath_func(file_path));
    return {
      success: false,
      label: label_var,
      status: 'error',
      error: error_var instanceof Error ? error_var.message : String(error_var),
    };
  }
}

/**
 * Revert the auto-run patch on a single file.
 *
 * Task:
 * 1) JS 원본 복원도 atomic write로 처리
 * 2) checksum restore 실패 시 JS를 패치 직전 스냅샷으로 롤백
 * 3) JS/product 모두 원하는 상태가 된 뒤에만 backup 삭제
 */
export async function revertFile(file_path: string, label_var: string, app_root?: string): Promise<PatchResult> {
  const backup_path_var = file_path + '.ba-backup';
  if (!fs.existsSync(backup_path_var)) {
    return { success: false, label: label_var, status: 'no-backup' };
  }

  try {
    const current_file_buffer_var = await fsp.readFile(file_path);
    const backup_file_buffer_var = await fsp.readFile(backup_path_var);
    const product_snapshot_var = app_root ? await readProductSnapshot_func(app_root) : null;
    const product_backup_raw_var = product_snapshot_var
      ? await fsp.readFile(product_snapshot_var.productBackupPath, 'utf8')
      : null;

    await writeFileAtomically_func(file_path, backup_file_buffer_var);

    if (product_snapshot_var && product_backup_raw_var !== null) {
      try {
        const restore_product_var = buildRestoredProductRaw_func(
          product_snapshot_var.productRaw,
          product_backup_raw_var,
          label_var,
        );
        await writeFileAtomically_func(product_snapshot_var.productPath, restore_product_var.productRaw);

        if (restore_product_var.allRestored) {
          try {
            await fsp.unlink(product_snapshot_var.productBackupPath);
          } catch {
            // ignore cleanup failure
          }
        }
      } catch (error_var) {
        const error_message_var = error_var instanceof Error ? error_var.message : String(error_var);
        try {
          await writeFileAtomically_func(file_path, current_file_buffer_var);
        } catch (rollback_error_var) {
          const rollback_message_var = rollback_error_var instanceof Error ? rollback_error_var.message : String(rollback_error_var);
          return {
            success: false,
            label: label_var,
            status: 'error',
            error: `checksum restore failed during product.json commit: ${error_message_var}; JS rollback to patched snapshot also failed: ${rollback_message_var}`,
          };
        }

        return {
          success: false,
          label: label_var,
          status: 'error',
          error: `checksum restore failed during product.json commit: ${error_message_var}; JS rolled back to patched snapshot`,
        };
      }
    }

    try {
      await fsp.unlink(backup_path_var);
    } catch {
      // ignore backup cleanup failure
    }

    return { success: true, label: label_var, status: 'reverted' };
  } catch (error_var) {
    return {
      success: false,
      label: label_var,
      status: 'error',
      error: error_var instanceof Error ? error_var.message : String(error_var),
    };
  }
}

/**
 * Auto-apply the fix to all target files.
 *
 * product.json은 두 파일이 공유하므로 순차 처리한다.
 */
export async function autoApply(): Promise<PatchResult[]> {
  const root_var = getAppRoot();
  if (!root_var) return [];

  try {
    const lock_var = await acquireAutoRunLock_func(root_var);

    try {
      const files_var = discoverTargetFiles(root_var);
      const results_var: PatchResult[] = [];

      for (const file_var of files_var) {
        results_var.push(await patchFile(file_var.path, file_var.label, root_var));
      }

      return results_var;
    } finally {
      await releaseAutoRunLock_func(lock_var);
    }
  } catch (error_var) {
    const files_var = discoverTargetFiles(root_var);
    const error_message_var = error_var instanceof Error ? error_var.message : String(error_var);

    return Promise.all(files_var.map(async (file_var) => {
      const state_var = await getPatchState(file_var.path);
      if (state_var === 'patched') {
        return { success: true, label: file_var.label, status: 'already-patched' as const };
      }
      if (state_var === 'patch-corrupted') {
        return { success: false, label: file_var.label, status: 'patch-corrupted' as const, error: error_message_var };
      }
      return { success: false, label: file_var.label, status: 'error' as const, error: error_message_var };
    }));
  }
}

/**
 * Revert all target files from backups.
 *
 * product.json은 두 파일이 공유하므로 순차 처리한다.
 */
export async function revertAll(): Promise<PatchResult[]> {
  const root_var = getAppRoot();
  if (!root_var) return [];

  try {
    const lock_var = await acquireAutoRunLock_func(root_var);

    try {
      const files_var = discoverTargetFiles(root_var);
      const results_var: PatchResult[] = [];

      for (const file_var of files_var) {
        results_var.push(await revertFile(file_var.path, file_var.label, root_var));
      }

      return results_var;
    } finally {
      await releaseAutoRunLock_func(lock_var);
    }
  } catch (error_var) {
    const files_var = discoverTargetFiles(root_var);
    const error_message_var = error_var instanceof Error ? error_var.message : String(error_var);
    return files_var.map((file_var) => ({
      success: false,
      label: file_var.label,
      status: 'error' as const,
      error: error_message_var,
    }));
  }
}

/**
 * Get patch status of all target files.
 */
export async function getStatus(): Promise<{
  dir: string | null;
  files: Array<{ label: string; state: PatchState; patched: boolean }>;
}> {
  const root_var = getAppRoot();
  if (!root_var) return { dir: null, files: [] };

  const files_var = discoverTargetFiles(root_var);
  const statuses_var = await Promise.all(
    files_var.map(async (file_var) => {
      const state_var = await getPatchState(file_var.path);
      return {
        label: file_var.label,
        state: state_var,
        patched: state_var === 'patched',
      };
    }),
  );

  return { dir: root_var, files: statuses_var };
}
