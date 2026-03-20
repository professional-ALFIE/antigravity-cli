export type ApprovalPolicy = 'auto' | 'manual';

export type JobStatus = 'queued' | 'running' | 'completed' | 'timed_out' | 'failed';

export interface JobResultRecord {
  conversation: unknown | null;
  responseText: string;
  changedFiles: string[];
}

export interface JobRecord {
  jobId: string;
  cascadeId: string;
  workspace: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  approvalPolicy: ApprovalPolicy;
  lastStepCount: number;
  lastModifiedTime: string;
  result: JobResultRecord | null;
}

export const timeout_exit_code_var = 124;
