import { mkdirSync, readFileSync, realpathSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ApprovalPolicy, JobRecord } from './types.js';

const CONFIG_DIR_VAR = join(homedir(), '.antigravity-cli');
const JOBS_DIR_VAR = join(CONFIG_DIR_VAR, 'jobs');
const IGNORED_DIRS_VAR = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
]);

function normalizePath_func(path_var: string): string {
  try {
    return realpathSync(path_var);
  } catch {
    return path_var;
  }
}

function ensureJobsDir_func(): string {
  mkdirSync(JOBS_DIR_VAR, { recursive: true });
  return JOBS_DIR_VAR;
}

function getJobPath_func(job_id_var: string): string {
  return join(ensureJobsDir_func(), `${job_id_var}.json`);
}

export function createJobRecord_func(params_var: {
  cascadeId: string;
  workspace: string;
  prompt: string;
  approvalPolicy: ApprovalPolicy;
}): JobRecord {
  const now_iso_var = new Date().toISOString();

  return {
    jobId: randomUUID(),
    cascadeId: params_var.cascadeId,
    workspace: normalizePath_func(params_var.workspace),
    prompt: params_var.prompt,
    createdAt: now_iso_var,
    updatedAt: now_iso_var,
    status: 'running',
    approvalPolicy: params_var.approvalPolicy,
    lastStepCount: 0,
    lastModifiedTime: now_iso_var,
    result: null,
  };
}

export function writeJobRecord_func(job_var: JobRecord): void {
  const next_job_var: JobRecord = {
    ...job_var,
    updatedAt: new Date().toISOString(),
  };

  writeFileSync(
    getJobPath_func(next_job_var.jobId),
    JSON.stringify(next_job_var, null, 2),
    'utf-8',
  );
}

export function readJobRecord_func(job_id_var: string): JobRecord {
  const raw_var = readFileSync(getJobPath_func(job_id_var), 'utf-8');
  return JSON.parse(raw_var) as JobRecord;
}

export function jobExists_func(job_id_var: string): boolean {
  return existsSync(getJobPath_func(job_id_var));
}

export function listJobRecords_func(): JobRecord[] {
  const jobs_dir_var = ensureJobsDir_func();
  const entries_var = readdirSync(jobs_dir_var)
    .filter((entry_var) => entry_var.endsWith('.json'));

  const jobs_var = entries_var.map((entry_var) => {
    const raw_var = readFileSync(join(jobs_dir_var, entry_var), 'utf-8');
    return JSON.parse(raw_var) as JobRecord;
  });

  jobs_var.sort((left_var, right_var) => (
    Date.parse(right_var.updatedAt) - Date.parse(left_var.updatedAt)
  ));

  return jobs_var;
}

function walkWorkspace_func(
  root_dir_var: string,
  current_dir_var: string,
  changed_files_var: string[],
  since_ms_var: number,
): void {
  const entries_var = readdirSync(current_dir_var, { withFileTypes: true });

  for (const entry_var of entries_var) {
    if (entry_var.isDirectory() && IGNORED_DIRS_VAR.has(entry_var.name)) {
      continue;
    }

    const full_path_var = join(current_dir_var, entry_var.name);

    if (entry_var.isDirectory()) {
      walkWorkspace_func(root_dir_var, full_path_var, changed_files_var, since_ms_var);
      continue;
    }

    if (!entry_var.isFile()) {
      continue;
    }

    const stat_var = statSync(full_path_var);
    if (stat_var.mtimeMs >= since_ms_var) {
      changed_files_var.push(relative(root_dir_var, full_path_var));
    }
  }
}

export function listChangedFilesSince_func(workspace_var: string, since_iso_var: string): string[] {
  const normalized_workspace_var = normalizePath_func(workspace_var);
  const since_ms_var = Date.parse(since_iso_var);
  if (!Number.isFinite(since_ms_var) || !existsSync(normalized_workspace_var)) {
    return [];
  }

  const changed_files_var: string[] = [];
  walkWorkspace_func(normalized_workspace_var, normalized_workspace_var, changed_files_var, since_ms_var);
  changed_files_var.sort((left_var, right_var) => left_var.localeCompare(right_var));
  return changed_files_var;
}
