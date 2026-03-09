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

/**
 * Resolve the Antigravity app root directory (cross-platform).
 * 이 경로 아래에 out/ 디렉토리가 있다.
 */
export function getAppRoot(): string | null {
  const platform_var = process.platform;
  let root_var: string;

  if (platform_var === 'darwin') {
    root_var = '/Applications/Antigravity.app/Contents/Resources/app';
  } else if (platform_var === 'win32') {
    const app_data = process.env.LOCALAPPDATA || '';
    root_var = path.join(app_data, 'Programs', 'Antigravity', 'resources', 'app');
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
    // macOS paths
    { path: path.join(app_root, 'out', 'vs', 'workbench', 'workbench.desktop.main.js'), label: 'workbench' },
    { path: path.join(app_root, 'out', 'jetskiAgent', 'main.js'), label: 'jetskiAgent' },
    // Windows paths (original better-antigravity)
    { path: path.join(app_root, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.desktop.main.js'), label: 'workbench' },
    { path: path.join(app_root, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'jetskiAgent.js'), label: 'jetskiAgent' },
  ];

  // 존재하는 파일만 반환, 같은 label이면 먼저 매칭된 것 우선
  const seen_var = new Set<string>();
  return candidates_var.filter(f => {
    if (seen_var.has(f.label)) return false;
    if (!fs.existsSync(f.path)) return false;
    seen_var.add(f.label);
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
 * Check if a file already has the auto-run patch applied.
 */
export async function isPatched(file_path: string): Promise<boolean> {
  try {
    const content_var = await fsp.readFile(file_path, 'utf8');
    return content_var.includes(PATCH_MARKER);
  } catch {
    return false;
  }
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
  // 범용 패턴: EAGER&&<confirmFn>(!0)를 포함하는 useCallback/Mt 호출을 찾는다
  // macOS: optional chaining `?.` 사용, dep array가 빈 배열이 아닐 수 있음
  // Windows: 일반 호출, dep array 빈 배열
  const on_change_regex = /(\w+)=(\w+)\((\w+)=>\{[^}]*?(\w+)\.EAGER&&(\w+)\(!0\)\},\[/g;
  const match_var = on_change_regex.exec(content_var);

  if (!match_var) return null;

  const [full_match, , , , enum_name, confirm_fn] = match_var;
  const insert_pos = match_var.index + full_match.length;

  // Extract context variables from surrounding code
  const context_start = Math.max(0, match_var.index - 3000);
  const context_end = Math.min(content_var.length, match_var.index + 3000);
  const context_var = content_var.substring(context_start, context_end);

  // policyVar: <var>=<something>?.terminalAutoExecutionPolicy??<ENUM>.OFF
  const policy_match = /(\w+)=\w+\?\.terminalAutoExecutionPolicy\?\?(\w+)\.OFF/.exec(context_var);
  // secureVar: <var>=<something>?.secureModeEnabled??!1
  const secure_match = /(\w+)=\w+\?\.secureModeEnabled\?\?!1/.exec(context_var);

  if (!policy_match || !secure_match) return null;

  const policy_var = policy_match[1];
  const secure_var = secure_match[1];

  // Task 4: Find useEffect via dispatcher alias (not frequency analysis)
  const use_effect_fn = findUseEffect(content_var);
  if (!use_effect_fn) return null;

  // Find insertion point: after the useCallback closing '])'
  const after_on_change = content_var.indexOf('])', insert_pos);
  if (after_on_change === -1) return null;

  const insert_at = content_var.indexOf(';', after_on_change);
  if (insert_at === -1) return null;

  return {
    enumName: enum_name,
    confirmFn: confirm_fn,
    policyVar: policy_var,
    secureVar: secure_var,
    useEffectFn: use_effect_fn,
    insertAt: insert_at + 1,
  };
}

/**
 * Task 4: Find the useEffect alias from React's dispatcher object.
 *
 * React 번들의 dispatcher alias 테이블에서 `useEffect:(\w+)` 패턴을 직접 추출한다.
 * 기존 빈도 분석 방식은 useMemo를 오탐지하는 문제가 있었다.
 *
 * 검증 결과:
 *   workbench → fn (pos 26140)
 *   jetski   → At (pos 26026)
 */
function findUseEffect(content_var: string): string | null {
  const match = /useEffect:(\w+)/.exec(content_var);
  return match ? match[1] : null;
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

// ──────────────────────────────────────────────
// Task 2: product.json 체크섬 관련 함수
// ──────────────────────────────────────────────

/**
 * SHA-256 → base64 체크섬 계산 (trailing '=' 제거, product.json 형식).
 */
function computeChecksum(content: Buffer): string {
  const hash = crypto.createHash('sha256').update(content).digest('base64');
  return hash.replace(/=+$/, '');
}

/**
 * 패치된 파일에 대해 product.json의 체크섬을 갱신한다.
 * product.json이 처음 수정될 때 .ba-backup 백업을 만든다.
 */
async function updateChecksum(appRoot: string, label: string, filePath: string): Promise<void> {
  const checksumKey = CHECKSUM_KEY_MAP[label];
  if (!checksumKey) return;

  const productPath = path.join(appRoot, 'product.json');
  const productBackup = productPath + '.ba-backup';

  // product.json 백업 (첫 번째만)
  try { await fsp.access(productBackup); } catch {
    await fsp.copyFile(productPath, productBackup);
  }

  const fileContent = await fsp.readFile(filePath);
  const newChecksum = computeChecksum(fileContent);

  const productRaw = await fsp.readFile(productPath, 'utf8');
  const product = JSON.parse(productRaw);

  if (product.checksums && typeof product.checksums === 'object') {
    product.checksums[checksumKey] = newChecksum;
    await fsp.writeFile(productPath, JSON.stringify(product, null, '\t'), 'utf8');
  }
}

/**
 * revert 시 product.json의 해당 키 체크섬만 원본으로 복원한다.
 * 전체를 복원하지 않고, 해당 키만 원복하여 partial revert를 안전하게 지원한다.
 */
async function restoreChecksum(appRoot: string, label: string): Promise<void> {
  const checksumKey = CHECKSUM_KEY_MAP[label];
  if (!checksumKey) return;

  const productPath = path.join(appRoot, 'product.json');
  const productBackup = productPath + '.ba-backup';

  if (!fs.existsSync(productBackup)) return;

  const backupRaw = await fsp.readFile(productBackup, 'utf8');
  const backupProduct = JSON.parse(backupRaw);

  const currentRaw = await fsp.readFile(productPath, 'utf8');
  const currentProduct = JSON.parse(currentRaw);

  if (
    backupProduct.checksums && typeof backupProduct.checksums === 'object' &&
    currentProduct.checksums && typeof currentProduct.checksums === 'object' &&
    backupProduct.checksums[checksumKey]
  ) {
    currentProduct.checksums[checksumKey] = backupProduct.checksums[checksumKey];
    await fsp.writeFile(productPath, JSON.stringify(currentProduct, null, '\t'), 'utf8');
  }

  // 모든 체크섬이 원본과 같아졌으면 product.json backup 삭제
  const updatedRaw = await fsp.readFile(productPath, 'utf8');
  const updatedProduct = JSON.parse(updatedRaw);
  const allRestored = Object.keys(CHECKSUM_KEY_MAP).every(key => {
    const k = CHECKSUM_KEY_MAP[key];
    return updatedProduct.checksums?.[k] === backupProduct.checksums?.[k];
  });
  if (allRestored) {
    try { await fsp.unlink(productBackup); } catch { /* ignore */ }
  }
}

// ──────────────────────────────────────────────
// Core patch / revert / auto-apply
// ──────────────────────────────────────────────

/**
 * Apply the auto-run patch to a single file.
 *
 * Task 1: 패치 문자열 앞뒤 `;` 추가
 * Task 2: 체크섬 갱신 (실패 시 JS를 backup으로 롤백)
 * Task 3: `node --check` 구문 검증 (임시 파일 → rename)
 */
export async function patchFile(file_path: string, label_var: string, app_root?: string): Promise<PatchResult> {
  try {
    let content_var = await fsp.readFile(file_path, 'utf8');

    if (content_var.includes(PATCH_MARKER)) {
      // 마커가 있으면 패치 구조도 검증 — 깨진 패치를 정상으로 오인하지 않도록
      const structureOk = /;\/*BA:autorun\*\/\w+\(\(\)=>\{.+\},\[\]\);/.test(content_var);
      if (structureOk) {
        return { success: true, label: label_var, status: 'already-patched' };
      }
      // 마커는 있지만 구조가 깨짐 — 자동 복구 불가, 수동 revert 필요
      return { success: false, label: label_var, status: 'patch-corrupted', error: 'patch marker found but structure is invalid — run revert first' };
    }

    const analysis_var = analyzeFile(content_var);
    if (!analysis_var) {
      return { success: false, label: label_var, status: 'pattern-not-found' };
    }

    const { enumName, confirmFn, policyVar, secureVar, useEffectFn, insertAt } = analysis_var;

    // Task 1: Build the patch — 앞뒤 `;` 추가로 독립 문장 보장
    const patch_var = `;${PATCH_MARKER}${useEffectFn}(()=>{${policyVar}===${enumName}.EAGER&&!${secureVar}&&${confirmFn}(!0)},[]);`;

    // Create backup (only if one doesn't exist)
    const backup_var = file_path + '.ba-backup';
    try { await fsp.access(backup_var); } catch {
      await fsp.copyFile(file_path, backup_var);
    }

    // Insert patch into content
    content_var = content_var.substring(0, insertAt) + patch_var + content_var.substring(insertAt);

    // Task 3: 임시 파일에 쓰고 node --check 구문 검증
    const tmp_path = file_path + '.ba-tmp';
    await fsp.writeFile(tmp_path, content_var, 'utf8');

    try {
      execSync(`node --check "${tmp_path}"`, { timeout: 30000, stdio: 'pipe' });
    } catch {
      // 구문 검증 실패 — 임시 파일 정리, 원본 미수정
      try { await fsp.unlink(tmp_path); } catch { /* ignore */ }
      return { success: false, label: label_var, status: 'syntax-check-failed', error: 'node --check failed on patched content' };
    }

    // 구문 검증 통과 — 임시 파일을 실제 파일로 교체 (atomic rename)
    await fsp.rename(tmp_path, file_path);

    // Task 2: 체크섬 갱신
    if (app_root) {
      try {
        await updateChecksum(app_root, label_var, file_path);
      } catch (checksumErr: any) {
        // 체크섬 갱신 실패 시 JS 파일을 backup으로 롤백 + product.json도 원본으로 복원
        try { await fsp.copyFile(backup_var, file_path); } catch { /* ignore */ }
        try { await restoreChecksum(app_root, label_var); } catch { /* ignore */ }
        return { success: false, label: label_var, status: 'error', error: `checksum update failed: ${checksumErr.message}` };
      }
    }

    return { success: true, label: label_var, status: 'patched', bytesAdded: patch_var.length };
  } catch (err: any) {
    // 임시 파일이 남아있으면 정리
    try { await fsp.unlink(file_path + '.ba-tmp'); } catch { /* ignore */ }
    return { success: false, label: label_var, status: 'error', error: err.message };
  }
}

/**
 * Revert the auto-run patch on a single file.
 * Task 2: 체크섬도 함께 복원.
 */
export async function revertFile(file_path: string, label_var: string, app_root?: string): Promise<PatchResult> {
  const backup_var = file_path + '.ba-backup';
  if (!fs.existsSync(backup_var)) {
    return { success: false, label: label_var, status: 'no-backup' };
  }

  try {
    // 1. 원본 복원 (backup은 아직 삭제하지 않음)
    fs.copyFileSync(backup_var, file_path);

    // 2. 체크섬 복원 — 실패 시 backup을 보존하고 에러 반환
    if (app_root) {
      try {
        await restoreChecksum(app_root, label_var);
      } catch (checksumErr: any) {
        // 체크섬 복원 실패 — JS는 이미 원본이지만 product.json이 어긋남
        // backup은 유지하여 재시도 가능하도록 함
        return { success: false, label: label_var, status: 'error', error: `revert succeeded but checksum restore failed: ${checksumErr.message}` };
      }
    }

    // 3. JS + 체크섬 모두 원복 완료 후에만 backup 삭제
    fs.unlinkSync(backup_var);

    return { success: true, label: label_var, status: 'reverted' };
  } catch (err: any) {
    return { success: false, label: label_var, status: 'error', error: err.message };
  }
}

/**
 * Auto-apply the fix to all target files.
 */
export async function autoApply(): Promise<PatchResult[]> {
  const root_var = getAppRoot();
  if (!root_var) return [];

  const files_var = discoverTargetFiles(root_var);
  return Promise.all(files_var.map(f => patchFile(f.path, f.label, root_var)));
}

/**
 * Revert all target files from backups.
 */
export async function revertAll(): Promise<PatchResult[]> {
  const root_var = getAppRoot();
  if (!root_var) return [];

  const files_var = discoverTargetFiles(root_var);
  return Promise.all(files_var.map(f => revertFile(f.path, f.label, root_var)));
}

/**
 * Get patch status of all target files.
 */
export async function getStatus(): Promise<{ dir: string | null; files: Array<{ label: string; patched: boolean }> }> {
  const root_var = getAppRoot();
  if (!root_var) return { dir: null, files: [] };

  const files_var = discoverTargetFiles(root_var);
  const statuses_var = await Promise.all(
    files_var.map(async (f) => ({
      label: f.label,
      patched: await isPatched(f.path),
    })),
  );

  return { dir: root_var, files: statuses_var };
}
