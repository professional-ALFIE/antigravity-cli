import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  discoverAccounts_func,
  getAccount_func,
  getDefaultCliDir_func,
  getDefaultDataDir_func,
  getNextManagedAccountName_func,
  getStateDbPath_func,
  listAccounts_func,
  setCurrentAccountId_func,
  updateAccountFingerprintState_func,
  upsertAccount_func,
  type AccountDetail,
} from './accounts.js';
import {
  captureOriginalBaseline_func,
  createFingerprintRecord_func,
  generateDeviceProfile_func,
  resolveFingerprintEnvironmentPaths_func,
} from './fingerprint.js';
import {
  buildGoogleOAuthUrl_func,
  exchangeAuthorizationCode_func,
  fetchGoogleUserInfo_func,
  parseOAuthCallbackUrl_func,
} from './oauthClient.js';
import { StateDbReader } from './stateVscdb.js';

const DEFAULT_TIMEOUT_MS_var = 10 * 60 * 1000;

export type AuthLoginResult =
  | {
    status: 'success';
    accountName: string;
    email: string;
    name: string | null;
    importedCount: number;
    created: boolean;
  }
  | { status: 'timeout'; accountName: string; message: string }
  | { status: 'cancelled'; accountName: string }
  | { status: 'open_failed'; accountName: string; message: string }
  | { status: 'error'; accountName: string; message: string };

export interface OAuthCallbackReceiver {
  redirectUri: string;
  waitForCallbackUrl: () => Promise<string>;
  close: () => Promise<void>;
}

export interface ImportLocalResult {
  importedCount: number;
  importedAccounts: AccountDetail[];
}

interface ImportableStateDbAccount {
  email: string;
  name: string | null;
  token: {
    access_token: string;
    refresh_token: string | null;
    expires_in: number;
    expiry_timestamp: number;
    token_type: string;
    project_id: string | null;
  };
}

export interface AuthLoginOptions {
  cliDir?: string;
  defaultDataDir?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onAuthUrl?: (url: string) => void;
  createCallbackReceiver?: () => Promise<OAuthCallbackReceiver>;
  openUrl?: (url: string) => Promise<void>;
  exchangeAuthorizationCode?: typeof exchangeAuthorizationCode_func;
  fetchGoogleUserInfo?: typeof fetchGoogleUserInfo_func;
  importLocalAccounts?: (options: { cliDir: string; defaultDataDir: string }) => Promise<ImportLocalResult>;
  generateState?: () => string;
  manualCallbackUrlProvider?: () => Promise<string | null>;
}

async function openUrlInBrowser_func(url_var: string): Promise<void> {
  await new Promise<void>((resolve_var, reject_var) => {
    if (process.platform === 'darwin') {
      execFile('open', [url_var], (error_var) => error_var ? reject_var(error_var) : resolve_var());
      return;
    }

    if (process.platform === 'linux') {
      execFile('xdg-open', [url_var], (error_var) => error_var ? reject_var(error_var) : resolve_var());
      return;
    }

    if (process.platform === 'win32') {
      execFile('cmd', ['/c', 'start', '', url_var], (error_var) => error_var ? reject_var(error_var) : resolve_var());
      return;
    }

    reject_var(new Error(`Unsupported platform: ${process.platform}`));
  });
}

async function createLocalOAuthCallbackReceiver_func(): Promise<OAuthCallbackReceiver> {
  let resolveCallback_var: ((callbackUrl_var: string) => void) | null = null;
  const callbackPromise_var = new Promise<string>((resolve_var) => {
    resolveCallback_var = resolve_var;
  });

  const server_var = http.createServer((request_var, response_var) => {
    const host_var = request_var.headers.host ?? '127.0.0.1';
    const callbackUrl_var = `http://${host_var}${request_var.url ?? '/'}`;
    response_var.statusCode = 200;
    response_var.setHeader('content-type', 'text/plain; charset=utf-8');
    response_var.end('Authentication received. You can close this window.');
    resolveCallback_var?.(callbackUrl_var);
  });

  await new Promise<void>((resolve_var, reject_var) => {
    server_var.once('error', reject_var);
    server_var.listen(0, '127.0.0.1', () => {
      server_var.off('error', reject_var);
      resolve_var();
    });
  });

  const address_var = server_var.address();
  if (!address_var || typeof address_var === 'string') {
    await new Promise<void>((resolve_var, reject_var) => server_var.close((error_var) => error_var ? reject_var(error_var) : resolve_var()));
    throw new Error('Failed to bind local OAuth callback server');
  }

  return {
    redirectUri: `http://127.0.0.1:${address_var.port}/oauth-callback`,
    waitForCallbackUrl: async () => callbackPromise_var,
    close: async () => {
      await new Promise<void>((resolve_var, reject_var) => {
        server_var.close((error_var) => error_var ? reject_var(error_var) : resolve_var());
      });
    },
  };
}

function findLegacyStateDbPaths_func(options_var: { cliDir: string; defaultDataDir: string }): string[] {
  const candidatePaths_var = [
    getStateDbPath_func({ userDataDirPath: options_var.defaultDataDir }),
  ];
  const userDataDir_var = path.join(options_var.cliDir, 'user-data');
  if (existsSync(userDataDir_var)) {
    for (const entry_var of readdirSync(userDataDir_var)) {
      if (!entry_var.startsWith('user-')) {
        continue;
      }
      candidatePaths_var.push(getStateDbPath_func({ userDataDirPath: path.join(userDataDir_var, entry_var) }));
    }
  }

  return [...new Set(candidatePaths_var.filter((candidate_var) => existsSync(candidate_var)))];
}

function looksLikeBase64_func(value_var: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value_var) && value_var.length % 4 === 0;
}

function readVarintAt_func(buffer_var: Buffer, offset_var: number): { value: number; nextOffset: number } | null {
  let result_var = 0;
  let shift_var = 0;
  let cursor_var = offset_var;

  while (cursor_var < buffer_var.length) {
    const byte_var = buffer_var[cursor_var];
    result_var |= (byte_var & 0x7f) << shift_var;
    cursor_var += 1;
    if ((byte_var & 0x80) === 0) {
      return { value: result_var, nextOffset: cursor_var };
    }
    shift_var += 7;
  }

  return null;
}

function extractRefreshTokenFromOauthBytes_func(bytes_var: Buffer, depth_var = 0): string | null {
  if (depth_var > 4 || bytes_var.length === 0) {
    return null;
  }

  let offset_var = 0;
  while (offset_var < bytes_var.length) {
    const tag_var = readVarintAt_func(bytes_var, offset_var);
    if (!tag_var) {
      return null;
    }

    const fieldNumber_var = tag_var.value >> 3;
    const wireType_var = tag_var.value & 0x7;
    offset_var = tag_var.nextOffset;

    if (wireType_var === 2) {
      const length_var = readVarintAt_func(bytes_var, offset_var);
      if (!length_var) {
        return null;
      }
      const contentStart_var = length_var.nextOffset;
      const contentEnd_var = contentStart_var + length_var.value;
      if (contentEnd_var > bytes_var.length) {
        return null;
      }

      const contentBytes_var = bytes_var.subarray(contentStart_var, contentEnd_var);
      const contentString_var = contentBytes_var.toString('utf8');

      if (fieldNumber_var === 3 && contentString_var.length > 0 && contentString_var !== 'Bearer') {
        return contentString_var;
      }

      if (looksLikeBase64_func(contentString_var)) {
        try {
          const decoded_var = Buffer.from(contentString_var, 'base64');
          const nestedRefresh_var = extractRefreshTokenFromOauthBytes_func(decoded_var, depth_var + 1);
          if (nestedRefresh_var) {
            return nestedRefresh_var;
          }
        } catch {
          // ignore malformed base64 candidate
        }
      }

      const nestedRefresh_var = extractRefreshTokenFromOauthBytes_func(contentBytes_var, depth_var + 1);
      if (nestedRefresh_var) {
        return nestedRefresh_var;
      }

      offset_var = contentEnd_var;
      continue;
    }

    if (wireType_var === 0) {
      const value_var = readVarintAt_func(bytes_var, offset_var);
      if (!value_var) {
        return null;
      }
      offset_var = value_var.nextOffset;
      continue;
    }

    return null;
  }

  return null;
}

async function readImportableStateDbAccount_func(stateDbPath_var: string): Promise<ImportableStateDbAccount | null> {
  const reader_var = new StateDbReader(stateDbPath_var);
  try {
    const accessToken_var = await reader_var.extractOAuthAccessToken();
    const userSummary_var = await reader_var.extractUserStatusSummary_func();
    if (!accessToken_var || !userSummary_var?.email) {
      return null;
    }

    const oauthBytes_var = await reader_var.getTopicBytes('uss-oauth');
    const refreshToken_var = extractRefreshTokenFromOauthBytes_func(oauthBytes_var);
    const nowTimestamp_var = Math.floor(Date.now() / 1000);

    return {
      email: userSummary_var.email,
      name: userSummary_var.email.split('@')[0] ?? null,
      token: {
        access_token: accessToken_var,
        refresh_token: refreshToken_var,
        expires_in: 3600,
        expiry_timestamp: nowTimestamp_var + 3600,
        token_type: 'Bearer',
        project_id: null,
      },
    };
  } finally {
    await reader_var.close();
  }
}

export async function importLocalFromStateDb_func(options_var: {
  cliDir: string;
  defaultDataDir: string;
  stateDbPaths?: string[];
  readStateDbAccount?: (stateDbPath: string) => Promise<ImportableStateDbAccount | null>;
}): Promise<ImportLocalResult> {
  const readStateDbAccount_var = options_var.readStateDbAccount ?? readImportableStateDbAccount_func;
  const stateDbPaths_var = options_var.stateDbPaths ?? findLegacyStateDbPaths_func(options_var);
  const importedAccounts_var: AccountDetail[] = [];

  for (const stateDbPath_var of stateDbPaths_var) {
    const importableAccount_var = await readStateDbAccount_var(stateDbPath_var);
    if (!importableAccount_var) {
      continue;
    }

    const upsertResult_var = await upsertAccount_func({
      cliDir: options_var.cliDir,
      email: importableAccount_var.email,
      name: importableAccount_var.name ?? importableAccount_var.email,
      token: importableAccount_var.token,
    });
    captureOriginalBaseline_func({
      cliDir: options_var.cliDir,
      paths: resolveFingerprintEnvironmentPaths_func(options_var.defaultDataDir),
    });
    const deviceProfile_var = generateDeviceProfile_func();
    const fingerprint_var = createFingerprintRecord_func({
      cliDir: options_var.cliDir,
      name: `${upsertResult_var.account.email} Device Profile`,
      profile: deviceProfile_var,
    });
    const updatedAccount_var = await updateAccountFingerprintState_func({
      cliDir: options_var.cliDir,
      accountId: upsertResult_var.account.id,
      fingerprintId: fingerprint_var.id,
      deviceProfile: deviceProfile_var,
    });
    importedAccounts_var.push(updatedAccount_var ?? upsertResult_var.account);
  }

  return {
    importedCount: importedAccounts_var.length,
    importedAccounts: importedAccounts_var,
  };
}

async function waitForCompletionWithTimeout_func<T>(options_var: {
  promise: Promise<T>;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<T> {
  return await new Promise<T>((resolve_var, reject_var) => {
    const timeoutId_var = setTimeout(() => reject_var(new Error('timeout')), options_var.timeoutMs);

    const cleanup_func = (): void => {
      clearTimeout(timeoutId_var);
      options_var.signal?.removeEventListener('abort', onAbort_func);
    };

    const onAbort_func = (): void => {
      cleanup_func();
      reject_var(new Error('cancelled'));
    };

    options_var.signal?.addEventListener('abort', onAbort_func, { once: true });

    options_var.promise.then((value_var) => {
      cleanup_func();
      resolve_var(value_var);
    }).catch((error_var) => {
      cleanup_func();
      reject_var(error_var);
    });
  });
}

export async function authLogin_func(options_var: AuthLoginOptions = {}): Promise<AuthLoginResult> {
  const cliDir_var = options_var.cliDir ?? getDefaultCliDir_func();
  const defaultDataDir_var = options_var.defaultDataDir ?? getDefaultDataDir_func();
  const timeoutMs_var = options_var.timeoutMs ?? DEFAULT_TIMEOUT_MS_var;
  const accountName_var = getNextManagedAccountName_func(
    await discoverAccounts_func({ cliDir: cliDir_var, defaultDataDir: defaultDataDir_var }),
  );

  const importLocalAccounts_var = options_var.importLocalAccounts ?? importLocalFromStateDb_func;
  const createCallbackReceiver_var = options_var.createCallbackReceiver ?? createLocalOAuthCallbackReceiver_func;
  const openUrl_var = options_var.openUrl ?? openUrlInBrowser_func;
  const exchangeAuthorizationCode_var = options_var.exchangeAuthorizationCode ?? exchangeAuthorizationCode_func;
  const fetchGoogleUserInfo_var = options_var.fetchGoogleUserInfo ?? fetchGoogleUserInfo_func;
  const generateState_var = options_var.generateState ?? randomUUID;

  let importedCount_var = 0;
  try {
    const importResult_var = await importLocalAccounts_var({ cliDir: cliDir_var, defaultDataDir: defaultDataDir_var });
    importedCount_var = importResult_var.importedCount;
  } catch {
    importedCount_var = 0;
  }

  let callbackReceiver_var: OAuthCallbackReceiver | null = null;
  try {
    callbackReceiver_var = await createCallbackReceiver_var();
  } catch (error_var) {
    return {
      status: 'error',
      accountName: accountName_var,
      message: error_var instanceof Error ? error_var.message : String(error_var),
    };
  }

  try {
    const state_var = generateState_var();
    const authUrl_var = buildGoogleOAuthUrl_func({
      redirectUri: callbackReceiver_var.redirectUri,
      state: state_var,
    });
    options_var.onAuthUrl?.(authUrl_var);

    try {
      await openUrl_var(authUrl_var);
    } catch (error_var) {
      return {
        status: 'open_failed',
        accountName: accountName_var,
        message: error_var instanceof Error ? error_var.message : String(error_var),
      };
    }

    let callbackUrl_var: string | null = null;
    try {
      callbackUrl_var = await waitForCompletionWithTimeout_func({
        promise: callbackReceiver_var.waitForCallbackUrl(),
        timeoutMs: timeoutMs_var,
        signal: options_var.signal,
      });
    } catch (error_var) {
      if (error_var instanceof Error && error_var.message === 'cancelled') {
        return { status: 'cancelled', accountName: accountName_var };
      }

      if (options_var.manualCallbackUrlProvider) {
        callbackUrl_var = await options_var.manualCallbackUrlProvider();
      }

      if (!callbackUrl_var) {
        return {
          status: 'timeout',
          accountName: accountName_var,
          message: 'Login timed out',
        };
      }
    }

    const parsedCallback_var = parseOAuthCallbackUrl_func(callbackUrl_var);
    if (parsedCallback_var.error) {
      return {
        status: 'error',
        accountName: accountName_var,
        message: parsedCallback_var.errorDescription ?? parsedCallback_var.error,
      };
    }

    if (parsedCallback_var.state !== state_var) {
      return {
        status: 'error',
        accountName: accountName_var,
        message: 'Invalid state parameter',
      };
    }

    if (!parsedCallback_var.code) {
      return {
        status: 'error',
        accountName: accountName_var,
        message: 'Authorization code missing from callback',
      };
    }

    const tokenResponse_var = await exchangeAuthorizationCode_var({
      code: parsedCallback_var.code,
      redirectUri: callbackReceiver_var.redirectUri,
    });
    const userInfo_var = await fetchGoogleUserInfo_var({
      accessToken: tokenResponse_var.access_token,
    });

    const nowTimestamp_var = Math.floor(Date.now() / 1000);
    const upsertResult_var = await upsertAccount_func({
      cliDir: cliDir_var,
      email: userInfo_var.email,
      name: userInfo_var.name ?? userInfo_var.email,
      token: {
        access_token: tokenResponse_var.access_token,
        refresh_token: tokenResponse_var.refresh_token,
        expires_in: tokenResponse_var.expires_in,
        expiry_timestamp: nowTimestamp_var + tokenResponse_var.expires_in,
        token_type: tokenResponse_var.token_type,
        project_id: null,
      },
    });
    captureOriginalBaseline_func({
      cliDir: cliDir_var,
      paths: resolveFingerprintEnvironmentPaths_func(defaultDataDir_var),
    });
    const deviceProfile_var = generateDeviceProfile_func();
    const fingerprint_var = createFingerprintRecord_func({
      cliDir: cliDir_var,
      name: `${upsertResult_var.account.email} Device Profile`,
      profile: deviceProfile_var,
    });
    const updatedAccount_var = await updateAccountFingerprintState_func({
      cliDir: cliDir_var,
      accountId: upsertResult_var.account.id,
      fingerprintId: fingerprint_var.id,
      deviceProfile: deviceProfile_var,
    });
    await setCurrentAccountId_func({ cliDir: cliDir_var, accountId: upsertResult_var.account.id });

    return {
      status: 'success',
      accountName: upsertResult_var.account.id,
      email: updatedAccount_var?.email ?? upsertResult_var.account.email,
      name: updatedAccount_var?.name ?? upsertResult_var.account.name,
      importedCount: importedCount_var,
      created: upsertResult_var.created,
    };
  } catch (error_var) {
    if (error_var instanceof Error && error_var.message === 'cancelled') {
      return { status: 'cancelled', accountName: accountName_var };
    }

    return {
      status: 'error',
      accountName: accountName_var,
      message: error_var instanceof Error ? error_var.message : String(error_var),
    };
  } finally {
    if (callbackReceiver_var) {
      await callbackReceiver_var.close().catch(() => undefined);
    }
  }
}
