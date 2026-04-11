import { describe, expect, test } from 'bun:test';

import {
  createWorkspaceIdForPsMatch_func,
  extractLiveDiscoveryInfo_func,
  isSuccessfulGetUserStatusProbeResponse_func,
} from './liveAttach.js';

describe('createWorkspaceIdForPsMatch_func', () => {
  test('creates workspace_id matching v0.1.x formula', () => {
    const workspace_id_var = createWorkspaceIdForPsMatch_func(
      '/Users/noseung-gyeong/Dropbox/issue-36-antigravity-headless',
    );

    expect(workspace_id_var).toBe(
      'file_Users_noseung_gyeong_Dropbox_issue_36_antigravity_headless',
    );
  });

  test('prefixes with "file" and replaces all non-alphanumeric chars', () => {
    const workspace_id_var = createWorkspaceIdForPsMatch_func(
      '/tmp/my-project',
    );

    expect(workspace_id_var).toBe('file_tmp_my_project');
  });
});

describe('extractLiveDiscoveryInfo_func', () => {
  test('extracts PID, csrfToken, extension_server_port, workspace_id from ps line', () => {
    const ps_line_var = [
      '  12345',
      '/Applications/Antigravity.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm',
      '--enable_lsp',
      '--csrf_token=abc-123-def',
      '--extension_server_port=54321',
      '--extension_server_csrf_token=xyz-789',
      '--persistent_mode',
      '--workspace_id=file____Users_test_project',
      '--app_data_dir antigravity',
      '--random_port',
    ].join(' ');

    const info_var = extractLiveDiscoveryInfo_func(ps_line_var);

    expect(info_var).toEqual({
      pid: 12345,
      csrfToken: 'abc-123-def',
      extensionServerPort: 54321,
      lspPort: 0,
      workspaceId: 'file____Users_test_project',
    });
  });

  test('extracts workspace_id in --workspace_id=value format (equals)', () => {
    const ps_line_var = '99999 /path/to/language_server --csrf_token=tok --workspace_id=file_Users_dev_repo';

    const info_var = extractLiveDiscoveryInfo_func(ps_line_var);

    expect(info_var).not.toBeNull();
    expect(info_var!.workspaceId).toBe('file_Users_dev_repo');
  });

  test('returns null when csrf_token is missing', () => {
    const ps_line_var = '12345 /path/to/language_server --workspace_id=file_test';

    expect(extractLiveDiscoveryInfo_func(ps_line_var)).toBeNull();
  });

  test('returns null when workspace_id is missing', () => {
    const ps_line_var = '12345 /path/to/language_server --csrf_token=tok';

    expect(extractLiveDiscoveryInfo_func(ps_line_var)).toBeNull();
  });

  test('returns null when PID is absent', () => {
    const ps_line_var = '/path/to/language_server --csrf_token=tok --workspace_id=file_test';

    expect(extractLiveDiscoveryInfo_func(ps_line_var)).toBeNull();
  });

  test('handles lsp_port extraction', () => {
    const ps_line_var = '12345 /path/to/ls --csrf_token=tok --workspace_id=file_test --lsp_port=8888';

    const info_var = extractLiveDiscoveryInfo_func(ps_line_var);

    expect(info_var).not.toBeNull();
    expect(info_var!.lspPort).toBe(8888);
  });
});

describe('isSuccessfulGetUserStatusProbeResponse_func', () => {
  test('accepts a 200 JSON response with the expected GetUserStatus shape', () => {
    const success_var = isSuccessfulGetUserStatusProbeResponse_func({
      statusCode: 200,
      responseHeaders: {
        'content-type': 'application/json; charset=utf-8',
      },
      rawResponseBody: JSON.stringify({
        server: { uptime: 123 },
        user: {
          userStatus: {
            name: 'Test User',
          },
        },
      }),
    });

    expect(success_var).toBe(true);
  });

  test('rejects non-200 responses even when the body looks valid', () => {
    for (const status_code_var of [403, 404, 415]) {
      const success_var = isSuccessfulGetUserStatusProbeResponse_func({
        statusCode: status_code_var,
        responseHeaders: {
          'content-type': 'application/json',
        },
        rawResponseBody: JSON.stringify({
          server: { uptime: 1 },
        }),
      });

      expect(success_var).toBe(false);
    }
  });

  test('rejects malformed or unrelated JSON payloads', () => {
    expect(
      isSuccessfulGetUserStatusProbeResponse_func({
        statusCode: 200,
        responseHeaders: {
          'content-type': 'application/json',
        },
        rawResponseBody: '{',
      }),
    ).toBe(false);

    expect(
      isSuccessfulGetUserStatusProbeResponse_func({
        statusCode: 200,
        responseHeaders: {
          'content-type': 'application/json',
        },
        rawResponseBody: JSON.stringify({ ok: true }),
      }),
    ).toBe(false);
  });
});
