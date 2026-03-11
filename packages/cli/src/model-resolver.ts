interface DocumentedModelEntry {
  cliName: string;
  internalId: string;
  label: string;
  aliases: string[];
}

export const documented_models_var: DocumentedModelEntry[] = [
  {
    cliName: 'claude-opus-4.6',
    internalId: 'MODEL_PLACEHOLDER_M26',
    label: 'Claude Opus 4.6 (Thinking)',
    aliases: ['opus'],
  },
  {
    cliName: 'claude-sonnet-4.6',
    internalId: 'MODEL_PLACEHOLDER_M35',
    label: 'Claude Sonnet 4.6 (Thinking)',
    aliases: ['sonnet'],
  },
  {
    cliName: 'gemini-3.1-pro-high',
    internalId: 'MODEL_PLACEHOLDER_M37',
    label: 'Gemini 3.1 Pro (High)',
    aliases: ['pro-high'],
  },
  {
    cliName: 'gemini-3.1-pro',
    internalId: 'MODEL_PLACEHOLDER_M36',
    label: 'Gemini 3.1 Pro (Low)',
    aliases: ['pro'],
  },
  {
    cliName: 'gemini-3-flash',
    internalId: 'MODEL_PLACEHOLDER_M18',
    label: 'Gemini 3 Flash',
    aliases: ['flash'],
  },
];

export const default_model_name_var = documented_models_var[0].cliName;

const internal_model_ids_var = new Set(
  documented_models_var.map((model_var) => model_var.internalId),
);

const model_alias_map_var = new Map<string, string>();
for (const model_var of documented_models_var) {
  model_alias_map_var.set(model_var.cliName.toLowerCase(), model_var.internalId);
  for (const alias_var of model_var.aliases) {
    model_alias_map_var.set(alias_var.toLowerCase(), model_var.internalId);
  }
}

export function resolveModelId_func(name_var?: string): string {
  const candidate_var = (name_var ?? default_model_name_var).trim();
  if (!candidate_var) {
    return documented_models_var[0].internalId;
  }

  if (internal_model_ids_var.has(candidate_var)) {
    return candidate_var;
  }

  const resolved_var = model_alias_map_var.get(candidate_var.toLowerCase());
  if (resolved_var) {
    return resolved_var;
  }

  const available_models_var = documented_models_var
    .map((model_var) => model_var.cliName)
    .join(', ');

  throw new Error(`Unknown model: "${candidate_var}". Available: ${available_models_var}`);
}

export function formatDocumentedModels_func(): string {
  const width_var = documented_models_var.reduce(
    (max_var, model_var) => Math.max(max_var, model_var.cliName.length),
    0,
  );

  return documented_models_var
    .map((model_var, index_var) => {
      const suffix_var = index_var === 0 ? ' (default)' : '';
      return `  ${model_var.cliName.padEnd(width_var)}  ${model_var.label}${suffix_var}`;
    })
    .join('\n');
}
