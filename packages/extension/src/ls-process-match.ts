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

/**
 * Extract meaningful path segments from a workspace path for fuzzy matching.
 * Used as fallback when exact workspace_id matching fails due to encoding
 * differences between the extension and the Language Server.
 *
 * The LS encodes workspace_id using URI-component encoding (e.g., : → _3A_)
 * while createWorkspaceId_func uses simple regex replacement. This mismatch
 * causes exact matching to fail on paths with special characters.
 */
function extractPathSegments_func(workspace_path_var: string): string[] {
  return workspace_path_var.split(/[/\\]/).filter((s) => s.length > 0);
}

export function findMatchingLanguageServerLine_func(
  lines_var: string[],
  workspace_id_var: string,
): string | undefined {
  const normalized_workspace_id_var = workspace_id_var.trim();
  if (!normalized_workspace_id_var) {
    return undefined;
  }

  // Phase 1: Try exact match (works when encoding is consistent)
  const exact_match = lines_var.find((line_var) => {
    const extracted_workspace_id_var = extractWorkspaceId_func(line_var);
    return extracted_workspace_id_var === normalized_workspace_id_var;
  });
  if (exact_match) {
    return exact_match;
  }

  // Phase 2: Fuzzy match using path segments
  // The LS workspace_id may use different encoding (URI-encoded vs simple replace)
  // so we match on the meaningful path segments (last 2-3 segments)
  const segments = extractPathSegments_func(
    normalized_workspace_id_var.replace(/^file_*/, ''),
  );
  if (segments.length === 0) {
    return undefined;
  }

  // Use last 2 segments for matching (most specific, avoids /Users/username collisions)
  const match_segments = segments.slice(-2);

  return lines_var.find((line_var) => {
    const extracted_id = extractWorkspaceId_func(line_var);
    if (!extracted_id) return false;
    const lower_id = extracted_id.toLowerCase();
    return match_segments.every((seg) => lower_id.includes(seg.toLowerCase()));
  });
}
