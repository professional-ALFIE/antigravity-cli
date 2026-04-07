import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import type { HeadlessBackendConfig } from '../utils/config.js';
import type { DiscoveryInfo } from './connectRpc.js';

const BUNDLE_BOOTSTRAP_SNIPPET_var = 'var r=o(o.s=27015),s=exports;';
const BUNDLE_BOOTSTRAP_REPLACEMENT_var = 'globalThis.__headlessBundle={modules:n,require:o};var r={},s=exports;';

const CREATE_MODULE_ID_var = 20217;
const CONNECT_MODULE_ID_var = 62573;
const TRANSPORT_MODULE_ID_var = 30495;
const LANGUAGE_SERVER_MODULE_ID_var = 29076;
const JETSKI_MODULE_ID_var = 17028;

type BundleRequire_func = (module_id_var: number) => any;

interface BundleSandbox {
  __headlessBundle?: {
    require: BundleRequire_func;
  };
  globalThis: BundleSandbox;
  exports: Record<string, unknown>;
  module: {
    exports: Record<string, unknown>;
  };
  require: NodeRequire;
  process: NodeJS.Process;
  console: Console;
  Buffer: typeof Buffer;
  URL: typeof URL;
  URLSearchParams: typeof URLSearchParams;
  Headers: typeof Headers;
  AbortController: typeof AbortController;
  AbortSignal: typeof AbortSignal;
  TextEncoder: typeof TextEncoder;
  TextDecoder: typeof TextDecoder;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
}

export interface BundleSchemaFieldInfo {
  no: number;
  name: string;
  localName: string;
  kind: string;
  scalar?: number;
  messageType?: string;
  listKind?: string;
  mapKind?: string;
}

export interface LoadedAntigravityBundle {
  createMessage_func: <T = unknown>(schema_var: unknown, value_var: unknown) => T;
  toBinary_func: (schema_var: unknown, value_var: unknown) => Uint8Array;
  fromBinary_func: <T = unknown>(schema_var: unknown, bytes_var: Uint8Array) => T;
  createClient_func: (service_var: unknown, transport_var: unknown) => any;
  createTransport_func: (options_var: unknown) => unknown;
  languageServerService: unknown;
  schemas: {
    cascadeTrajectorySummary: unknown;
    cascadeTrajectorySummaries: unknown;
    conversationAnnotations: unknown;
    streamAgentStateUpdatesRequest: unknown;
    streamAgentStateUpdatesResponse: unknown;
    slice: unknown;
  };
  schemaInfo: {
    streamAgentStateUpdatesRequestFields: BundleSchemaFieldInfo[];
    streamAgentStateUpdatesResponseFields: BundleSchemaFieldInfo[];
  };
}

const bundle_cache_var = new Map<string, LoadedAntigravityBundle>();

function requireBundleModule_func<T>(require_func_var: BundleRequire_func, module_id_var: number): T {
  return require_func_var(module_id_var) as T;
}

function listSchemaFields_func(schema_var: any): BundleSchemaFieldInfo[] {
  const fields_var = Array.isArray(schema_var?.fields) ? schema_var.fields : [];
  return fields_var.map((field_var: any) => ({
    no: Number(field_var.no),
    name: String(field_var.name),
    localName: String(field_var.localName),
    kind: String(field_var.fieldKind),
    scalar: typeof field_var.scalar === 'number' ? field_var.scalar : undefined,
    messageType: typeof field_var.message?.typeName === 'string' ? field_var.message.typeName : undefined,
    listKind: typeof field_var.listKind === 'string' ? field_var.listKind : undefined,
    mapKind: typeof field_var.mapKind === 'string' ? field_var.mapKind : undefined,
  }));
}

function compileBundleRequire_func(extension_bundle_path_var: string): BundleRequire_func {
  const bundle_code_var = readFileSync(extension_bundle_path_var, 'utf8');
  if (!bundle_code_var.includes(BUNDLE_BOOTSTRAP_SNIPPET_var)) {
    throw new Error(`Could not locate Antigravity bundle bootstrap in ${extension_bundle_path_var}.`);
  }

  const patched_bundle_code_var = bundle_code_var.replace(
    BUNDLE_BOOTSTRAP_SNIPPET_var,
    BUNDLE_BOOTSTRAP_REPLACEMENT_var,
  );

  const sandbox_var = {
    exports: {},
    module: { exports: {} },
    require,
    process,
    console,
    Buffer,
    URL,
    URLSearchParams,
    Headers,
    AbortController,
    AbortSignal,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  } satisfies Omit<BundleSandbox, 'globalThis'> as BundleSandbox;
  sandbox_var.globalThis = sandbox_var;

  vm.createContext(sandbox_var);
  vm.runInContext(patched_bundle_code_var, sandbox_var, {
    timeout: 5000,
    filename: extension_bundle_path_var,
  });

  const require_func_var = sandbox_var.__headlessBundle?.require;
  if (!require_func_var) {
    throw new Error(`Failed to expose bundle require() from ${extension_bundle_path_var}.`);
  }
  return require_func_var;
}

function chooseTransportPort_func(
  discovery_var: DiscoveryInfo,
  protocol_var: 'http' | 'https',
): number {
  const port_var = protocol_var === 'https'
    ? discovery_var.httpsPort
    : discovery_var.httpPort;

  if (!port_var) {
    throw new Error(`Discovery is missing ${protocol_var.toUpperCase()} port.`);
  }
  return port_var;
}

export function loadAntigravityBundle_func(options_var: {
  extensionBundlePath: string;
}): LoadedAntigravityBundle {
  const cached_bundle_var = bundle_cache_var.get(options_var.extensionBundlePath);
  if (cached_bundle_var) {
    return cached_bundle_var;
  }

  const require_func_var = compileBundleRequire_func(options_var.extensionBundlePath);
  const create_module_var = requireBundleModule_func<{ create: LoadedAntigravityBundle['createMessage_func'] }>(
    require_func_var,
    CREATE_MODULE_ID_var,
  ) as {
    create: LoadedAntigravityBundle['createMessage_func'];
    toBinary: LoadedAntigravityBundle['toBinary_func'];
    fromBinary: LoadedAntigravityBundle['fromBinary_func'];
  };
  const connect_module_var = requireBundleModule_func<{ createClient: LoadedAntigravityBundle['createClient_func'] }>(
    require_func_var,
    CONNECT_MODULE_ID_var,
  );
  const transport_module_var = requireBundleModule_func<{ createConnectTransport: LoadedAntigravityBundle['createTransport_func'] }>(
    require_func_var,
    TRANSPORT_MODULE_ID_var,
  );
  const language_server_module_var = requireBundleModule_func<{ LanguageServerService: unknown }>(
    require_func_var,
    LANGUAGE_SERVER_MODULE_ID_var,
  );
  const jetski_module_var = requireBundleModule_func<{
    CascadeTrajectorySummarySchema: unknown;
    CascadeTrajectorySummariesSchema: unknown;
    ConversationAnnotationsSchema: unknown;
    StreamAgentStateUpdatesRequestSchema: unknown;
    StreamAgentStateUpdatesResponseSchema: unknown;
    SliceSchema: unknown;
  }>(
    require_func_var,
    JETSKI_MODULE_ID_var,
  );

  const loaded_bundle_var: LoadedAntigravityBundle = {
    createMessage_func: create_module_var.create,
    toBinary_func: create_module_var.toBinary,
    fromBinary_func: create_module_var.fromBinary,
    createClient_func: connect_module_var.createClient,
    createTransport_func: transport_module_var.createConnectTransport,
    languageServerService: language_server_module_var.LanguageServerService,
    schemas: {
      cascadeTrajectorySummary: jetski_module_var.CascadeTrajectorySummarySchema,
      cascadeTrajectorySummaries: jetski_module_var.CascadeTrajectorySummariesSchema,
      conversationAnnotations: jetski_module_var.ConversationAnnotationsSchema,
      streamAgentStateUpdatesRequest: jetski_module_var.StreamAgentStateUpdatesRequestSchema,
      streamAgentStateUpdatesResponse: jetski_module_var.StreamAgentStateUpdatesResponseSchema,
      slice: jetski_module_var.SliceSchema,
    },
    schemaInfo: {
      streamAgentStateUpdatesRequestFields: listSchemaFields_func(
        jetski_module_var.StreamAgentStateUpdatesRequestSchema,
      ),
      streamAgentStateUpdatesResponseFields: listSchemaFields_func(
        jetski_module_var.StreamAgentStateUpdatesResponseSchema,
      ),
    },
  };

  bundle_cache_var.set(options_var.extensionBundlePath, loaded_bundle_var);
  return loaded_bundle_var;
}

export function createLanguageServerClient_func(options_var: {
  bundle_var: LoadedAntigravityBundle;
  config_var: Pick<HeadlessBackendConfig, 'certPath'>;
  discovery_var: DiscoveryInfo;
  protocol_var?: 'http' | 'https';
}): any {
  const protocol_var = options_var.protocol_var ?? 'https';
  const port_var = chooseTransportPort_func(options_var.discovery_var, protocol_var);
  const cert_pem_var = protocol_var === 'https'
    ? readFileSync(options_var.config_var.certPath)
    : undefined;

  const transport_var = options_var.bundle_var.createTransport_func({
    baseUrl: `${protocol_var}://127.0.0.1:${port_var}`,
    useBinaryFormat: true,
    httpVersion: '2',
    interceptors: [
      (next_var: (req_var: any) => Promise<unknown>) => async (req_var: any) => {
        if (options_var.discovery_var.csrfToken) {
          req_var.header.set('x-codeium-csrf-token', options_var.discovery_var.csrfToken);
        }
        return next_var(req_var);
      },
    ],
    nodeOptions: cert_pem_var ? { ca: cert_pem_var } : undefined,
  });

  return options_var.bundle_var.createClient_func(
    options_var.bundle_var.languageServerService,
    transport_var,
  );
}
