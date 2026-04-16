import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { AccountStatus } from './accounts.js';
import { refreshGoogleAccessToken_func } from './oauthClient.js';

const CLOUD_CODE_DAILY_BASE_URL_var = 'https://daily-cloudcode-pa.googleapis.com';
const LOAD_CODE_ASSIST_PATH_var = 'v1internal:loadCodeAssist';
const FETCH_AVAILABLE_MODELS_PATH_var = 'v1internal:fetchAvailableModels';
const CACHE_TTL_MS_var = 60_000;
const REFRESH_SKEW_SECONDS_var = 300;
const DEFAULT_CONCURRENCY_var = 4;
const DEFAULT_IDE_VERSION_var = '1.20.6';

type FetchLike = typeof fetch;

export interface QuotaFetchAccountInput {
  id: string;
  email: string;
  accountStatus: AccountStatus;
  token: {
    access_token: string;
    refresh_token: string | null;
    expires_in: number;
    expiry_timestamp: number;
    token_type: string;
    project_id: string | null;
  };
  cacheDir: string;
}

export interface QuotaModelSnapshot {
  model_id: string;
  remaining_fraction: number | null;
  reset_time: string | null;
}

export interface QuotaFamilySnapshot {
  remaining_pct: number | null;
  reset_time: string | null;
  models: QuotaModelSnapshot[];
}

export interface QuotaFetchError {
  code: number | null;
  message: string;
}

export interface QuotaCacheValue {
  subscriptionTier: string | null;
  projectId: string | null;
  credits: Array<Record<string, unknown>>;
  families: Record<string, QuotaFamilySnapshot>;
  fetchError: QuotaFetchError | null;
  accountStatus: AccountStatus;
  refreshedToken?: QuotaFetchAccountInput['token'];
  cachedAtMs: number;
}

export interface QuotaCacheReadResult {
  value: QuotaCacheValue;
  isFresh: boolean;
}

export interface QuotaFetchSingleResult {
  source: 'network' | 'cache' | 'stale-cache';
  data: QuotaCacheValue;
}

function resolveQuotaCachePath_func(cacheDir_var: string, accountId_var: string): string {
  return path.join(cacheDir_var, `${accountId_var}.json`);
}

function ensureDir_func(dirPath_var: string): void {
  mkdirSync(dirPath_var, { recursive: true });
}

function writeJson0600_func(filePath_var: string, value_var: unknown): void {
  ensureDir_func(path.dirname(filePath_var));
  const tempPath_var = `${filePath_var}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath_var, `${JSON.stringify(value_var, null, 2)}\n`, 'utf8');
  chmodSync(tempPath_var, 0o600);
  renameSync(tempPath_var, filePath_var);
  chmodSync(filePath_var, 0o600);
}

function resolveFamilyName_func(modelId_var: string): string | null {
  const lowerModelId_var = modelId_var.toLowerCase();
  if (lowerModelId_var.includes('gemini')) {
    return 'GEMINI';
  }
  if (lowerModelId_var.includes('claude')) {
    return 'CLAUDE';
  }
  return null;
}

function buildCloudCodeMetadata_func(projectId_var: string | null): Record<string, unknown> {
  const metadata_var: Record<string, unknown> = {
    ideName: 'antigravity',
    ideType: 'ANTIGRAVITY',
    ideVersion: DEFAULT_IDE_VERSION_var,
    pluginVersion: '0.2.1',
    platform: process.arch === 'arm64' ? 'DARWIN_ARM64' : 'DARWIN_AMD64',
    updateChannel: 'stable',
    pluginType: 'GEMINI',
  };

  if (projectId_var) {
    metadata_var.duetProject = projectId_var;
  }

  return metadata_var;
}

function buildLoadCodeAssistPayload_func(projectId_var: string | null): Record<string, unknown> {
  const payload_var: Record<string, unknown> = {
    metadata: buildCloudCodeMetadata_func(projectId_var),
    mode: 'FULL_ELIGIBILITY_CHECK',
  };

  if (projectId_var) {
    payload_var.cloudaicompanionProject = projectId_var;
  }

  return payload_var;
}

function buildFetchAvailableModelsPayload_func(projectId_var: string | null): Record<string, unknown> {
  return projectId_var ? { project: projectId_var } : {};
}

function extractProjectId_func(value_var: unknown): string | null {
  if (!value_var || typeof value_var !== 'object') {
    return null;
  }
  const record_var = value_var as Record<string, unknown>;
  if (typeof record_var.id === 'string' && record_var.id.length > 0) {
    return record_var.id;
  }
  return null;
}

function parseFamiliesFromModels_func(models_var: Record<string, unknown>): Record<string, QuotaFamilySnapshot> {
  const familyBuckets_var = new Map<string, QuotaModelSnapshot[]>();

  for (const [modelId_var, modelValue_var] of Object.entries(models_var)) {
    const familyName_var = resolveFamilyName_func(modelId_var);
    if (!familyName_var || !modelValue_var || typeof modelValue_var !== 'object') {
      continue;
    }

    const quotaInfo_var = (modelValue_var as Record<string, unknown>).quotaInfo as Record<string, unknown> | undefined;
    const snapshot_var: QuotaModelSnapshot = {
      model_id: modelId_var,
      remaining_fraction: typeof quotaInfo_var?.remainingFraction === 'number' ? quotaInfo_var.remainingFraction : null,
      reset_time: typeof quotaInfo_var?.resetTime === 'string' ? quotaInfo_var.resetTime : null,
    };
    const existing_var = familyBuckets_var.get(familyName_var) ?? [];
    existing_var.push(snapshot_var);
    familyBuckets_var.set(familyName_var, existing_var);
  }

  const result_var: Record<string, QuotaFamilySnapshot> = {};
  for (const [familyName_var, snapshots_var] of familyBuckets_var.entries()) {
    const numericFractions_var = snapshots_var
      .map((snapshot_var) => snapshot_var.remaining_fraction)
      .filter((fraction_var): fraction_var is number => fraction_var !== null);
    const remainingFraction_var = numericFractions_var.length > 0 ? Math.min(...numericFractions_var) : null;
    const resetTimes_var = snapshots_var
      .map((snapshot_var) => snapshot_var.reset_time)
      .filter((resetTime_var): resetTime_var is string => resetTime_var !== null)
      .sort();

    result_var[familyName_var] = {
      remaining_pct: remainingFraction_var === null ? null : Math.round(remainingFraction_var * 100),
      reset_time: resetTimes_var[0] ?? null,
      models: snapshots_var,
    };
  }

  return result_var;
}

function resolveCacheDirDefault_func(): string {
  return path.join(os.homedir(), '.antigravity-cli', 'cache', 'quota');
}

export async function writeQuotaCache_func(options_var: {
  cacheDir: string;
  accountId: string;
  value: QuotaCacheValue;
}): Promise<void> {
  writeJson0600_func(resolveQuotaCachePath_func(options_var.cacheDir, options_var.accountId), options_var.value);
}

export async function readQuotaCache_func(options_var: {
  cacheDir: string;
  accountId: string;
  nowMs?: number;
}): Promise<QuotaCacheReadResult | null> {
  const cachePath_var = resolveQuotaCachePath_func(options_var.cacheDir, options_var.accountId);
  if (!existsSync(cachePath_var)) {
    return null;
  }

  try {
    const parsed_var = JSON.parse(readFileSync(cachePath_var, 'utf8')) as QuotaCacheValue;
    const nowMs_var = options_var.nowMs ?? Date.now();
    return {
      value: parsed_var,
      isFresh: nowMs_var - parsed_var.cachedAtMs < CACHE_TTL_MS_var,
    };
  } catch {
    return null;
  }
}

async function postJsonWithAuth_func(options_var: {
  url: string;
  accessToken: string;
  body: Record<string, unknown>;
  userAgent: string;
  extraHeaders?: Record<string, string>;
  fetchImpl?: FetchLike;
}): Promise<Response> {
  const fetchImpl_var = options_var.fetchImpl ?? fetch;
  return await fetchImpl_var(options_var.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options_var.accessToken}`,
      'content-type': 'application/json',
      'user-agent': options_var.userAgent,
      'accept-encoding': 'gzip',
      ...(options_var.extraHeaders ?? {}),
    },
    body: JSON.stringify(options_var.body),
  });
}

async function maybeRefreshToken_func(options_var: {
  account: QuotaFetchAccountInput;
  refreshAccessToken?: typeof refreshGoogleAccessToken_func;
}): Promise<QuotaFetchAccountInput['token']> {
  const nowSeconds_var = Math.floor(Date.now() / 1000);
  if (
    options_var.account.token.expiry_timestamp > nowSeconds_var + REFRESH_SKEW_SECONDS_var
    || !options_var.account.token.refresh_token
  ) {
    return options_var.account.token;
  }

  const refreshAccessToken_var = options_var.refreshAccessToken ?? refreshGoogleAccessToken_func;
  const refreshed_var = await refreshAccessToken_var({
    refreshToken: options_var.account.token.refresh_token,
  });
  return {
    access_token: refreshed_var.access_token,
    refresh_token: refreshed_var.refresh_token ?? options_var.account.token.refresh_token,
    expires_in: refreshed_var.expires_in,
    expiry_timestamp: nowSeconds_var + refreshed_var.expires_in,
    token_type: refreshed_var.token_type,
    project_id: options_var.account.token.project_id,
  };
}

export async function fetchQuotaForAccount_func(options_var: {
  account: QuotaFetchAccountInput;
  nowMs?: number;
  fetchImpl?: FetchLike;
  refreshAccessToken?: typeof refreshGoogleAccessToken_func;
  baseUrl?: string;
}): Promise<QuotaFetchSingleResult> {
  const nowMs_var = options_var.nowMs ?? Date.now();
  const baseUrl_var = options_var.baseUrl ?? CLOUD_CODE_DAILY_BASE_URL_var;
  const cache_var = await readQuotaCache_func({
    cacheDir: options_var.account.cacheDir,
    accountId: options_var.account.id,
    nowMs: nowMs_var,
  });
  if (cache_var?.isFresh) {
    return {
      source: 'cache',
      data: cache_var.value,
    };
  }

  try {
    const token_var = await maybeRefreshToken_func({
      account: options_var.account,
      refreshAccessToken: options_var.refreshAccessToken,
    });

    const loadCodeAssistResponse_var = await postJsonWithAuth_func({
      url: `${baseUrl_var}/${LOAD_CODE_ASSIST_PATH_var}`,
      accessToken: token_var.access_token,
      body: buildLoadCodeAssistPayload_func(token_var.project_id),
      userAgent: `antigravity/${DEFAULT_IDE_VERSION_var} darwin/${process.arch === 'arm64' ? 'arm64' : 'amd64'} google-api-nodejs-client/10.3.0`,
      extraHeaders: {
        'x-goog-api-client': 'gl-node/22.21.1',
        accept: '*/*',
      },
      fetchImpl: options_var.fetchImpl,
    });

    if (loadCodeAssistResponse_var.status === 403) {
      const forbiddenResult_var: QuotaCacheValue = {
        subscriptionTier: null,
        projectId: null,
        credits: [],
        families: {},
        fetchError: {
          code: 403,
          message: await loadCodeAssistResponse_var.text(),
        },
        accountStatus: 'forbidden',
        refreshedToken: token_var,
        cachedAtMs: nowMs_var,
      };
      await writeQuotaCache_func({
        cacheDir: options_var.account.cacheDir,
        accountId: options_var.account.id,
        value: forbiddenResult_var,
      });
      return {
        source: 'network',
        data: forbiddenResult_var,
      };
    }

    if (!loadCodeAssistResponse_var.ok) {
      throw new Error(`loadCodeAssist failed (${loadCodeAssistResponse_var.status}): ${await loadCodeAssistResponse_var.text()}`);
    }

    const loadCodeAssistJson_var = await loadCodeAssistResponse_var.json() as Record<string, unknown>;
    const subscriptionTier_var = typeof (loadCodeAssistJson_var.paidTier as Record<string, unknown> | undefined)?.id === 'string'
      ? (loadCodeAssistJson_var.paidTier as Record<string, string>).id
      : typeof (loadCodeAssistJson_var.currentTier as Record<string, unknown> | undefined)?.id === 'string'
        ? (loadCodeAssistJson_var.currentTier as Record<string, string>).id
        : null;
    const projectId_var = extractProjectId_func(loadCodeAssistJson_var.project) ?? token_var.project_id;
    const credits_var = Array.isArray((loadCodeAssistJson_var.paidTier as Record<string, unknown> | undefined)?.availableCredits)
      ? ((loadCodeAssistJson_var.paidTier as Record<string, unknown>).availableCredits as Array<Record<string, unknown>>)
      : [];

    const availableModelsResponse_var = await postJsonWithAuth_func({
      url: `${baseUrl_var}/${FETCH_AVAILABLE_MODELS_PATH_var}`,
      accessToken: token_var.access_token,
      body: buildFetchAvailableModelsPayload_func(projectId_var),
      userAgent: `antigravity/${DEFAULT_IDE_VERSION_var} darwin/${process.arch === 'arm64' ? 'arm64' : 'amd64'}`,
      fetchImpl: options_var.fetchImpl,
    });

    if (availableModelsResponse_var.status === 403) {
      const forbiddenResult_var: QuotaCacheValue = {
        subscriptionTier: subscriptionTier_var,
        projectId: projectId_var,
        credits: credits_var,
        families: {},
        fetchError: {
          code: 403,
          message: await availableModelsResponse_var.text(),
        },
        accountStatus: 'forbidden',
        refreshedToken: token_var,
        cachedAtMs: nowMs_var,
      };
      await writeQuotaCache_func({
        cacheDir: options_var.account.cacheDir,
        accountId: options_var.account.id,
        value: forbiddenResult_var,
      });
      return {
        source: 'network',
        data: forbiddenResult_var,
      };
    }

    if (!availableModelsResponse_var.ok) {
      throw new Error(`fetchAvailableModels failed (${availableModelsResponse_var.status}): ${await availableModelsResponse_var.text()}`);
    }

    const availableModelsJson_var = await availableModelsResponse_var.json() as Record<string, unknown>;
    const models_var = availableModelsJson_var.models as Record<string, unknown> | undefined;
    const result_var: QuotaCacheValue = {
      subscriptionTier: subscriptionTier_var,
      projectId: projectId_var,
      credits: credits_var,
      families: models_var ? parseFamiliesFromModels_func(models_var) : {},
      fetchError: null,
      accountStatus: options_var.account.accountStatus,
      refreshedToken: token_var,
      cachedAtMs: nowMs_var,
    };
    await writeQuotaCache_func({
      cacheDir: options_var.account.cacheDir,
      accountId: options_var.account.id,
      value: result_var,
    });
    return {
      source: 'network',
      data: result_var,
    };
  } catch (error_var) {
    if (cache_var) {
      return {
        source: 'stale-cache',
        data: {
          ...cache_var.value,
          fetchError: {
            code: null,
            message: error_var instanceof Error ? error_var.message : String(error_var),
          },
        },
      };
    }

    return {
      source: 'network',
      data: {
        subscriptionTier: null,
        projectId: null,
        credits: [],
        families: {},
        fetchError: {
          code: null,
          message: error_var instanceof Error ? error_var.message : String(error_var),
        },
        accountStatus: options_var.account.accountStatus,
        cachedAtMs: nowMs_var,
      },
    };
  }
}

export async function fetchQuotaForAccounts_func(options_var: {
  accounts: QuotaFetchAccountInput[];
  fetchImpl?: FetchLike;
  refreshAccessToken?: typeof refreshGoogleAccessToken_func;
  concurrency?: number;
  cacheDir?: string;
  baseUrl?: string;
}): Promise<Array<{ account: QuotaFetchAccountInput; result: QuotaFetchSingleResult }>> {
  const results_var: Array<{ account: QuotaFetchAccountInput; result: QuotaFetchSingleResult }> = [];
  const concurrency_var = options_var.concurrency ?? DEFAULT_CONCURRENCY_var;
  const accounts_var = options_var.accounts.map((account_var) => ({
    ...account_var,
    cacheDir: options_var.cacheDir ?? account_var.cacheDir ?? resolveCacheDirDefault_func(),
  }));

  for (let index_var = 0; index_var < accounts_var.length; index_var += concurrency_var) {
    const batch_var = accounts_var.slice(index_var, index_var + concurrency_var);
    const batchResults_var = await Promise.all(batch_var.map(async (account_var) => ({
      account: account_var,
      result: await fetchQuotaForAccount_func({
        account: account_var,
        fetchImpl: options_var.fetchImpl,
        refreshAccessToken: options_var.refreshAccessToken,
        baseUrl: options_var.baseUrl,
      }),
    })));
    results_var.push(...batchResults_var);
  }

  return results_var;
}
