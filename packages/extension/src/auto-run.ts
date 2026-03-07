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

  // Find useEffect — most frequently used short-named function in the scope
  const use_effect_fn = findUseEffect(context_var, [confirm_fn]);
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
 * Find the useEffect function name by frequency analysis.
 */
function findUseEffect(context_var: string, exclude_var: string[]): string | null {
  const candidates_var: Record<string, number> = {};
  const regex_var = /(\w{1,3})\(\(\)=>\{/g;
  let m_var;

  while ((m_var = regex_var.exec(context_var)) !== null) {
    const fn_var = m_var[1];
    if (fn_var.length <= 3 && !exclude_var.includes(fn_var)) {
      candidates_var[fn_var] = (candidates_var[fn_var] || 0) + 1;
    }
  }

  let best_var = '';
  let max_count = 0;
  for (const [fn_var, count_var] of Object.entries(candidates_var)) {
    if (count_var > max_count) {
      best_var = fn_var;
      max_count = count_var;
    }
  }

  return best_var || null;
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
  status: 'patched' | 'already-patched' | 'pattern-not-found' | 'reverted' | 'no-backup' | 'error';
  bytesAdded?: number;
  error?: string;
}

/**
 * Apply the auto-run patch to a single file.
 */
export async function patchFile(file_path: string, label_var: string): Promise<PatchResult> {
  try {
    let content_var = await fsp.readFile(file_path, 'utf8');

    if (content_var.includes(PATCH_MARKER)) {
      return { success: true, label: label_var, status: 'already-patched' };
    }

    const analysis_var = analyzeFile(content_var);
    if (!analysis_var) {
      return { success: false, label: label_var, status: 'pattern-not-found' };
    }

    const { enumName, confirmFn, policyVar, secureVar, useEffectFn, insertAt } = analysis_var;

    // Build the patch
    const patch_var = `${PATCH_MARKER}${useEffectFn}(()=>{${policyVar}===${enumName}.EAGER&&!${secureVar}&&${confirmFn}(!0)},[])`;

    // Create backup (only if one doesn't exist)
    const backup_var = file_path + '.ba-backup';
    try { await fsp.access(backup_var); } catch {
      await fsp.copyFile(file_path, backup_var);
    }

    // Insert
    content_var = content_var.substring(0, insertAt) + patch_var + content_var.substring(insertAt);
    await fsp.writeFile(file_path, content_var, 'utf8');

    return { success: true, label: label_var, status: 'patched', bytesAdded: patch_var.length };
  } catch (err: any) {
    return { success: false, label: label_var, status: 'error', error: err.message };
  }
}

/**
 * Revert the auto-run patch on a single file.
 */
export function revertFile(file_path: string, label_var: string): PatchResult {
  const backup_var = file_path + '.ba-backup';
  if (!fs.existsSync(backup_var)) {
    return { success: false, label: label_var, status: 'no-backup' };
  }

  try {
    fs.copyFileSync(backup_var, file_path);
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
  return Promise.all(files_var.map(f => patchFile(f.path, f.label)));
}

/**
 * Revert all target files from backups.
 */
export function revertAll(): PatchResult[] {
  const root_var = getAppRoot();
  if (!root_var) return [];

  const files_var = discoverTargetFiles(root_var);
  return files_var.map(f => revertFile(f.path, f.label));
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
