import { pathToFileURL } from 'node:url';

interface WorkspaceInfo {
  workspaceFolderAbsoluteUri?: string;
  gitRootAbsoluteUri?: string;
}

interface CascadeInfo {
  summary?: string;
  lastModifiedTime?: string;
  createdTime?: string;
  workspaces?: WorkspaceInfo[];
}

export type CascadeMap = Record<string, CascadeInfo>;

function getTimestamp_func(value_var?: string): number {
  if (!value_var) {
    return 0;
  }

  const timestamp_var = Date.parse(value_var);
  return Number.isNaN(timestamp_var) ? 0 : timestamp_var;
}

function matchesWorkspace_func(cascade_var: CascadeInfo, workspace_uri_var: string): boolean {
  const workspaces_var = cascade_var.workspaces;
  if (!Array.isArray(workspaces_var) || workspaces_var.length === 0) {
    return false;
  }

  return workspaces_var.some((workspace_var) => {
    if (workspace_var.workspaceFolderAbsoluteUri) {
      return workspace_var.workspaceFolderAbsoluteUri === workspace_uri_var;
    }

    if (workspace_var.gitRootAbsoluteUri) {
      return workspace_var.gitRootAbsoluteUri === workspace_uri_var;
    }

    return false;
  });
}

export function filterResumeList_func(
  cascades_var: unknown,
  workspace_dir_var: string,
): CascadeMap {
  if (!cascades_var || typeof cascades_var !== 'object' || Array.isArray(cascades_var)) {
    return {};
  }

  const workspace_uri_var = pathToFileURL(workspace_dir_var).href;
  const result_var: CascadeMap = {};

  for (const [cascade_id_var, cascade_var] of Object.entries(cascades_var as Record<string, CascadeInfo>)) {
    if (matchesWorkspace_func(cascade_var, workspace_uri_var)) {
      result_var[cascade_id_var] = cascade_var;
    }
  }

  return result_var;
}

export function formatResumeList_func(cascades_var: CascadeMap): string[] {
  return Object.entries(cascades_var)
    .sort((left_var, right_var) => {
      const left_last_modified_var = getTimestamp_func(left_var[1].lastModifiedTime);
      const right_last_modified_var = getTimestamp_func(right_var[1].lastModifiedTime);
      if (left_last_modified_var !== right_last_modified_var) {
        return right_last_modified_var - left_last_modified_var;
      }

      const left_created_var = getTimestamp_func(left_var[1].createdTime);
      const right_created_var = getTimestamp_func(right_var[1].createdTime);
      return right_created_var - left_created_var;
    })
    .map(([cascade_id_var, cascade_var]) => {
      const summary_var = cascade_var.summary?.trim() || '(session)';
      return `${cascade_id_var}  ${summary_var}`;
    });
}
