import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnvFile } from '../utils/config.js';

const GOOGLE_AUTH_URL_var = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL_var = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL_var = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_OAUTH_SCOPES_var = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
] as const;

type FetchLike = typeof fetch;

export interface GoogleOAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

export interface ResolveGoogleOAuthClientCredentialsOptions {
  env_var?: Record<string, string | undefined>;
  repoRootPath_var?: string;
  localEnvFilePath_var?: string;
  envFilePath_var?: string;
}

function getDefaultRepoRootPath_func(): string {
  const current_file_var = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(current_file_var), '..', '..');
}

export function resolveGoogleOAuthClientCredentials_func(
  options_var: ResolveGoogleOAuthClientCredentialsOptions = {},
): GoogleOAuthClientCredentials {
  const env_var = options_var.env_var ?? process.env;
  const repo_root_path_var = options_var.repoRootPath_var ?? getDefaultRepoRootPath_func();
  const local_env_var = loadEnvFile(
    options_var.localEnvFilePath_var ?? path.join(repo_root_path_var, '.env.local'),
  );
  const shared_env_var = loadEnvFile(
    options_var.envFilePath_var ?? path.join(repo_root_path_var, '.env'),
  );

  const client_id_var = env_var.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_ID
    ?? local_env_var.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_ID
    ?? shared_env_var.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_ID;
  const client_secret_var = env_var.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_SECRET
    ?? local_env_var.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_SECRET
    ?? shared_env_var.ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_SECRET;

  const missing_keys_var: string[] = [];
  if (!client_id_var) {
    missing_keys_var.push('ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_ID');
  }
  if (!client_secret_var) {
    missing_keys_var.push('ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_SECRET');
  }

  if (missing_keys_var.length > 0) {
    throw new Error(
      `Missing Google OAuth client config (${missing_keys_var.join(', ')}). Run install.sh or define them in .env.local.`,
    );
  }

  return {
    clientId: client_id_var,
    clientSecret: client_secret_var,
  };
}

export interface GoogleOAuthTokenResponse {
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
  token_type: string;
}

export interface GoogleUserInfo {
  id: string | null;
  email: string;
  name: string | null;
  given_name: string | null;
  family_name: string | null;
  picture?: string | null;
}

export function buildGoogleOAuthUrl_func(options_var: {
  redirectUri: string;
  state: string;
}): string {
  const oauth_client_var = resolveGoogleOAuthClientCredentials_func();
  const url_var = new URL(GOOGLE_AUTH_URL_var);
  url_var.searchParams.set('client_id', oauth_client_var.clientId);
  url_var.searchParams.set('redirect_uri', options_var.redirectUri);
  url_var.searchParams.set('response_type', 'code');
  url_var.searchParams.set('scope', GOOGLE_OAUTH_SCOPES_var.join(' '));
  url_var.searchParams.set('access_type', 'offline');
  url_var.searchParams.set('prompt', 'consent');
  url_var.searchParams.set('state', options_var.state);
  return url_var.toString();
}

export function parseOAuthCallbackUrl_func(callbackUrl_var: string): {
  state: string | null;
  code: string | null;
  error: string | null;
  errorDescription: string | null;
} {
  const url_var = new URL(callbackUrl_var);
  return {
    state: url_var.searchParams.get('state'),
    code: url_var.searchParams.get('code'),
    error: url_var.searchParams.get('error'),
    errorDescription: url_var.searchParams.get('error_description'),
  };
}

async function parseJsonOrThrow_func<T>(response_var: Response, operation_var: string): Promise<T> {
  if (!response_var.ok) {
    const body_var = await response_var.text();
    throw new Error(`${operation_var} failed (${response_var.status}): ${body_var}`);
  }

  return await response_var.json() as T;
}

export async function exchangeAuthorizationCode_func(options_var: {
  code: string;
  redirectUri: string;
  fetchImpl?: FetchLike;
}): Promise<GoogleOAuthTokenResponse> {
  const oauth_client_var = resolveGoogleOAuthClientCredentials_func();
  const fetchImpl_var = options_var.fetchImpl ?? fetch;
  const body_var = new URLSearchParams({
    client_id: oauth_client_var.clientId,
    client_secret: oauth_client_var.clientSecret,
    code: options_var.code,
    redirect_uri: options_var.redirectUri,
    grant_type: 'authorization_code',
  });

  const response_var = await fetchImpl_var(GOOGLE_TOKEN_URL_var, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body_var,
  });

  const parsed_var = await parseJsonOrThrow_func<Partial<GoogleOAuthTokenResponse>>(response_var, 'OAuth token exchange');
  return {
    access_token: String(parsed_var.access_token ?? ''),
    refresh_token: typeof parsed_var.refresh_token === 'string' ? parsed_var.refresh_token : null,
    expires_in: Number(parsed_var.expires_in ?? 0),
    token_type: String(parsed_var.token_type ?? 'Bearer'),
  };
}

export async function refreshGoogleAccessToken_func(options_var: {
  refreshToken: string;
  fetchImpl?: FetchLike;
}): Promise<GoogleOAuthTokenResponse> {
  const oauth_client_var = resolveGoogleOAuthClientCredentials_func();
  const fetchImpl_var = options_var.fetchImpl ?? fetch;
  const body_var = new URLSearchParams({
    client_id: oauth_client_var.clientId,
    client_secret: oauth_client_var.clientSecret,
    refresh_token: options_var.refreshToken,
    grant_type: 'refresh_token',
  });

  const response_var = await fetchImpl_var(GOOGLE_TOKEN_URL_var, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body_var,
  });

  const parsed_var = await parseJsonOrThrow_func<Partial<GoogleOAuthTokenResponse>>(response_var, 'OAuth token refresh');
  return {
    access_token: String(parsed_var.access_token ?? ''),
    refresh_token: typeof parsed_var.refresh_token === 'string' ? parsed_var.refresh_token : null,
    expires_in: Number(parsed_var.expires_in ?? 0),
    token_type: String(parsed_var.token_type ?? 'Bearer'),
  };
}

export async function fetchGoogleUserInfo_func(options_var: {
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<GoogleUserInfo> {
  const fetchImpl_var = options_var.fetchImpl ?? fetch;
  const response_var = await fetchImpl_var(GOOGLE_USERINFO_URL_var, {
    headers: {
      Authorization: `Bearer ${options_var.accessToken}`,
    },
  });

  const parsed_var = await parseJsonOrThrow_func<Partial<GoogleUserInfo>>(response_var, 'Google userinfo');
  return {
    id: typeof parsed_var.id === 'string' ? parsed_var.id : null,
    email: String(parsed_var.email ?? ''),
    name: typeof parsed_var.name === 'string' ? parsed_var.name : null,
    given_name: typeof parsed_var.given_name === 'string' ? parsed_var.given_name : null,
    family_name: typeof parsed_var.family_name === 'string' ? parsed_var.family_name : null,
    picture: typeof parsed_var.picture === 'string' ? parsed_var.picture : null,
  };
}
