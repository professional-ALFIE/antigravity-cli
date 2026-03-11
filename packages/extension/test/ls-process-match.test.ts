import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkspaceId_func,
  findMatchingLanguageServerLine_func,
} from '../src/ls-process-match.ts';

test('findMatchingLanguageServerLine_func 는 부모 작업영역 접두사와 자식 작업영역을 혼동하지 않는다', () => {
  const parent_workspace_id_var = createWorkspaceId_func('/Users/noseung-gyeong/Dropbox/meta-agent');
  const child_workspace_id_var = createWorkspaceId_func('/Users/noseung-gyeong/Dropbox/meta-agent/issue-24-antigravity-sdk');

  const child_line_var = [
    '14911',
    '/Applications/Antigravity.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm',
    '--enable_lsp',
    '--csrf_token',
    'CHILD_TOKEN',
    '--extension_server_port',
    '59661',
    '--random_port',
    `--workspace_id ${child_workspace_id_var}`,
  ].join(' ');

  const parent_line_var = [
    '83078',
    '/Applications/Antigravity.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm',
    '--enable_lsp',
    '--csrf_token',
    'PARENT_TOKEN',
    '--extension_server_port',
    '56049',
    '--random_port',
    `--workspace_id ${parent_workspace_id_var}`,
  ].join(' ');

  const matched_line_var = findMatchingLanguageServerLine_func(
    [child_line_var, parent_line_var],
    parent_workspace_id_var,
  );

  assert.equal(matched_line_var, parent_line_var);
  assert.equal(child_line_var.includes(parent_workspace_id_var), true);
});

test('findMatchingLanguageServerLine_func 는 --workspace_id=value 형식도 정확히 매칭한다', () => {
  const workspace_id_var = createWorkspaceId_func('/Users/noseung-gyeong/Dropbox/meta-agent');
  const matched_line_var = [
    '83078',
    '/Applications/Antigravity.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm',
    '--enable_lsp',
    '--workspace_id=' + workspace_id_var,
  ].join(' ');

  assert.equal(
    findMatchingLanguageServerLine_func([matched_line_var], workspace_id_var),
    matched_line_var,
  );
});
