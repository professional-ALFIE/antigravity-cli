import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildGoogleOAuthUrl_func,
  exchangeAuthorizationCode_func,
  fetchGoogleUserInfo_func,
  parseOAuthCallbackUrl_func,
  refreshGoogleAccessToken_func,
  resolveGoogleOAuthClientCredentials_func,
} from './oauthClient.js';

let original_client_id_var: string | undefined;
let original_client_secret_var: string | undefined;

beforeEach(() => {
  original_client_id_var = process.env.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_ID;
  original_client_secret_var = process.env.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_SECRET;
  process.env.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
  process.env.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret';
});

afterEach(() => {
  if (original_client_id_var == null) {
    delete process.env.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_ID;
  } else {
    process.env.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_ID = original_client_id_var;
  }

  if (original_client_secret_var == null) {
    delete process.env.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_SECRET;
  } else {
    process.env.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_SECRET = original_client_secret_var;
  }
});

describe('oauthClient', () => {
  test('buildGoogleOAuthUrl_func includes required OAuth params', () => {
    const url_var = new URL(buildGoogleOAuthUrl_func({
      redirectUri: 'http://localhost:43123/oauth-callback',
      state: 'state-123',
    }));

    expect(url_var.origin + url_var.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url_var.searchParams.get('client_id')).toBe('test-client-id.apps.googleusercontent.com');
    expect(url_var.searchParams.get('redirect_uri')).toBe('http://localhost:43123/oauth-callback');
    expect(url_var.searchParams.get('response_type')).toBe('code');
    expect(url_var.searchParams.get('access_type')).toBe('offline');
    expect(url_var.searchParams.get('prompt')).toBe('consent');
    expect(url_var.searchParams.get('state')).toBe('state-123');

    const scope_var = url_var.searchParams.get('scope') ?? '';
    expect(scope_var).toContain('https://www.googleapis.com/auth/cloud-platform');
    expect(scope_var).toContain('https://www.googleapis.com/auth/userinfo.email');
    expect(scope_var).toContain('https://www.googleapis.com/auth/userinfo.profile');
    expect(scope_var).toContain('https://www.googleapis.com/auth/cclog');
    expect(scope_var).toContain('https://www.googleapis.com/auth/experimentsandconfigs');
  });

  test('parseOAuthCallbackUrl_func returns code and state from callback URL', () => {
    const parsed_var = parseOAuthCallbackUrl_func(
      'http://localhost:43123/oauth-callback?state=state-123&code=auth-code-xyz',
    );

    expect(parsed_var).toEqual({
      state: 'state-123',
      code: 'auth-code-xyz',
      error: null,
      errorDescription: null,
    });
  });

  test('parseOAuthCallbackUrl_func captures OAuth error params', () => {
    const parsed_var = parseOAuthCallbackUrl_func(
      'http://localhost:43123/oauth-callback?error=access_denied&error_description=user%20cancelled',
    );

    expect(parsed_var).toEqual({
      state: null,
      code: null,
      error: 'access_denied',
      errorDescription: 'user cancelled',
    });
  });

  test('resolveGoogleOAuthClientCredentials_func falls back to .env.local when process env is missing', () => {
    const root_var = mkdtempSync(path.join(tmpdir(), 'ag-oauth-client-'));
    try {
      delete process.env.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_ID;
      delete process.env.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_SECRET;
      writeFileSync(
        path.join(root_var, '.env.local'),
        [
          'ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_ID=file-client-id.apps.googleusercontent.com',
          'ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_SECRET=file-client-secret',
        ].join('\n'),
        'utf8',
      );

      expect(resolveGoogleOAuthClientCredentials_func({
        repoRootPath_var: root_var,
      })).toEqual({
        clientId: 'file-client-id.apps.googleusercontent.com',
        clientSecret: 'file-client-secret',
      });
    } finally {
      rmSync(root_var, { recursive: true, force: true });
    }
  });

  test('resolveGoogleOAuthClientCredentials_func prefers process env over local file', () => {
    const root_var = mkdtempSync(path.join(tmpdir(), 'ag-oauth-client-'));
    try {
      writeFileSync(
        path.join(root_var, '.env.local'),
        [
          'ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_ID=file-client-id.apps.googleusercontent.com',
          'ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_SECRET=file-client-secret',
        ].join('\n'),
        'utf8',
      );

      expect(resolveGoogleOAuthClientCredentials_func({
        repoRootPath_var: root_var,
      })).toEqual({
        clientId: 'test-client-id.apps.googleusercontent.com',
        clientSecret: 'test-client-secret',
      });
    } finally {
      rmSync(root_var, { recursive: true, force: true });
    }
  });

  test('resolveGoogleOAuthClientCredentials_func throws a setup error when config is missing', () => {
    const root_var = mkdtempSync(path.join(tmpdir(), 'ag-oauth-client-'));
    try {
      delete process.env.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_ID;
      delete process.env.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_SECRET;

      expect(() => resolveGoogleOAuthClientCredentials_func({
        repoRootPath_var: root_var,
      })).toThrow('Run install.sh or define them in .env.local.');
    } finally {
      rmSync(root_var, { recursive: true, force: true });
    }
  });

  test('exchangeAuthorizationCode_func posts token exchange form and parses response', async () => {
    const fetchCalls_var: Array<{ url: string; init?: RequestInit }> = [];

    const token_var = await exchangeAuthorizationCode_func({
      code: 'auth-code-xyz',
      redirectUri: 'http://localhost:43123/oauth-callback',
      fetchImpl: async (url_var, init_var) => {
        fetchCalls_var.push({ url: String(url_var), init: init_var });
        return new Response(JSON.stringify({
          access_token: 'access-123',
          refresh_token: 'refresh-123',
          expires_in: 3600,
          token_type: 'Bearer',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    expect(fetchCalls_var).toHaveLength(1);
    expect(fetchCalls_var[0].url).toBe('https://oauth2.googleapis.com/token');
    expect(fetchCalls_var[0].init?.method).toBe('POST');
    expect(String(fetchCalls_var[0].init?.body)).toContain('grant_type=authorization_code');
    expect(String(fetchCalls_var[0].init?.body)).toContain('code=auth-code-xyz');
    expect(String(fetchCalls_var[0].init?.body)).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A43123%2Foauth-callback');
    expect(token_var.access_token).toBe('access-123');
    expect(token_var.refresh_token).toBe('refresh-123');
    expect(token_var.expires_in).toBe(3600);
  });

  test('refreshGoogleAccessToken_func posts refresh_token grant and keeps nullable refresh_token', async () => {
    const token_var = await refreshGoogleAccessToken_func({
      refreshToken: 'refresh-123',
      fetchImpl: async (_url_var, init_var) => {
        expect(String(init_var?.body)).toContain('grant_type=refresh_token');
        expect(String(init_var?.body)).toContain('refresh_token=refresh-123');
        return new Response(JSON.stringify({
          access_token: 'access-456',
          expires_in: 1800,
          token_type: 'Bearer',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    expect(token_var.access_token).toBe('access-456');
    expect(token_var.refresh_token).toBeNull();
    expect(token_var.expires_in).toBe(1800);
  });

  test('fetchGoogleUserInfo_func sends bearer auth and returns parsed user info', async () => {
    const userInfo_var = await fetchGoogleUserInfo_func({
      accessToken: 'access-123',
      fetchImpl: async (_url_var, init_var) => {
        expect(init_var?.headers).toEqual({ Authorization: 'Bearer access-123' });
        return new Response(JSON.stringify({
          id: 'google-user-1',
          email: 'user@example.com',
          name: 'User Example',
          given_name: 'User',
          family_name: 'Example',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    expect(userInfo_var.email).toBe('user@example.com');
    expect(userInfo_var.name).toBe('User Example');
  });
});
