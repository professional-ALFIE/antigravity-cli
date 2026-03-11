function extractWorkspaceId_func(line_var: string): string | null {
  const equals_match_var = line_var.match(/--workspace_id=([^\s"]+)/);
  if (equals_match_var) {
    return equals_match_var[1];
  }

  const spaced_match_var = line_var.match(/--workspace_id\s+([^\s"]+)/);
  if (spaced_match_var) {
    return spaced_match_var[1];
  }

  return null;
}

export function createWorkspaceId_func(workspace_path_var: string): string {
  return 'file' + workspace_path_var.replace(/[^a-zA-Z0-9]/g, '_');
}

export function findMatchingLanguageServerLine_func(
  lines_var: string[],
  workspace_id_var: string,
): string | undefined {
  const normalized_workspace_id_var = workspace_id_var.trim();
  if (!normalized_workspace_id_var) {
    return undefined;
  }

  return lines_var.find((line_var) => {
    const extracted_workspace_id_var = extractWorkspaceId_func(line_var);
    return extracted_workspace_id_var === normalized_workspace_id_var;
  });
}
