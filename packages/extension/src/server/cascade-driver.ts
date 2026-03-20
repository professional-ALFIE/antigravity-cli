import type { AntigravitySDK } from 'antigravity-sdk';

export interface CascadeCapabilities {
  editAcceptCommand: string | null;
  editRejectCommand: string | null;
  commandAcceptCommand: string | null;
  commandRejectCommand: string | null;
  terminalRunCommand: string | null;
  terminalAcceptCommand: string | null;
  terminalRejectCommand: string | null;
}

export interface DriveProgressResult {
  performed: boolean;
  action: 'accept-edit' | 'accept-command' | 'run-terminal' | null;
  via: 'sdk' | 'command' | null;
  command: string | null;
}

const COMMAND_CANDIDATES_VAR = {
  editAcceptCommand: [
    'antigravity.agent.acceptAgentStep',
    'antigravity.prioritized.agentAcceptAllInFile',
    'antigravity.prioritized.agentAcceptFocusedHunk',
  ],
  editRejectCommand: [
    'antigravity.agent.rejectAgentStep',
    'antigravity.prioritized.agentRejectAllInFile',
    'antigravity.prioritized.agentRejectFocusedHunk',
  ],
  commandAcceptCommand: [
    'antigravity.command.accept',
  ],
  commandRejectCommand: [
    'antigravity.command.reject',
  ],
  terminalRunCommand: [
    'antigravity.terminalCommand.run',
    'antigravity.terminalCommand.accept',
  ],
  terminalAcceptCommand: [
    'antigravity.terminalCommand.accept',
    'antigravity.terminalCommand.run',
  ],
  terminalRejectCommand: [
    'antigravity.terminalCommand.reject',
  ],
} satisfies Record<keyof CascadeCapabilities, string[]>;

let cached_capabilities_var: CascadeCapabilities | null = null;
let inflight_capabilities_var: Promise<CascadeCapabilities> | null = null;

function createEmptyCapabilities_func(): CascadeCapabilities {
  return {
    editAcceptCommand: null,
    editRejectCommand: null,
    commandAcceptCommand: null,
    commandRejectCommand: null,
    terminalRunCommand: null,
    terminalAcceptCommand: null,
    terminalRejectCommand: null,
  };
}

function resolveCommand_func(
  available_commands_var: Set<string>,
  candidates_var: string[],
): string | null {
  for (const candidate_var of candidates_var) {
    if (available_commands_var.has(candidate_var)) {
      return candidate_var;
    }
  }

  return null;
}

async function loadCapabilities_func(sdk_var: AntigravitySDK): Promise<CascadeCapabilities> {
  const commands_var = await sdk_var.commands.getAntigravityCommands();
  const available_commands_var = new Set(commands_var);
  const result_var = createEmptyCapabilities_func();

  for (const [key_var, candidates_var] of Object.entries(COMMAND_CANDIDATES_VAR) as Array<
    [keyof CascadeCapabilities, string[]]
  >) {
    result_var[key_var] = resolveCommand_func(available_commands_var, candidates_var);
  }

  return result_var;
}

export async function getCascadeCapabilities_func(sdk_var: AntigravitySDK): Promise<CascadeCapabilities> {
  if (cached_capabilities_var) {
    return cached_capabilities_var;
  }

  if (!inflight_capabilities_var) {
    inflight_capabilities_var = loadCapabilities_func(sdk_var)
      .then((capabilities_var) => {
        cached_capabilities_var = capabilities_var;
        inflight_capabilities_var = null;
        return capabilities_var;
      })
      .catch(() => {
        const empty_capabilities_var = createEmptyCapabilities_func();
        cached_capabilities_var = empty_capabilities_var;
        inflight_capabilities_var = null;
        return empty_capabilities_var;
      });
  }

  return inflight_capabilities_var;
}

async function executeCommandIfAvailable_func(
  sdk_var: AntigravitySDK,
  command_var: string | null,
): Promise<string | null> {
  if (!command_var) {
    return null;
  }

  await sdk_var.commands.execute(command_var);
  return command_var;
}

async function trySdkThenCommand_func(
  sdk_call_var: () => Promise<void>,
  sdk_var: AntigravitySDK,
  command_var: string | null,
): Promise<{ via: 'sdk' | 'command'; command: string | null } | null> {
  try {
    await sdk_call_var();
    return { via: 'sdk', command: null };
  } catch {
    try {
      const executed_command_var = await executeCommandIfAvailable_func(sdk_var, command_var);
      if (executed_command_var) {
        return { via: 'command', command: executed_command_var };
      }
    } catch {
      // no-op
    }
  }

  return null;
}

export async function acceptStepCompat_func(sdk_var: AntigravitySDK): Promise<DriveProgressResult> {
  const capabilities_var = await getCascadeCapabilities_func(sdk_var);
  const edit_result_var = await trySdkThenCommand_func(
    async () => {
      await sdk_var.cascade.acceptStep();
    },
    sdk_var,
    capabilities_var.editAcceptCommand,
  );
  if (edit_result_var) {
    return {
      performed: true,
      action: 'accept-edit',
      via: edit_result_var.via,
      command: edit_result_var.command,
    };
  }

  return {
    performed: false,
    action: null,
    via: null,
    command: null,
  };
}

export async function acceptCommandCompat_func(sdk_var: AntigravitySDK): Promise<DriveProgressResult> {
  const capabilities_var = await getCascadeCapabilities_func(sdk_var);

  const command_result_var = await trySdkThenCommand_func(
    async () => {
      await sdk_var.cascade.acceptCommand();
    },
    sdk_var,
    capabilities_var.commandAcceptCommand,
  );
  if (command_result_var) {
    return {
      performed: true,
      action: 'accept-command',
      via: command_result_var.via,
      command: command_result_var.command,
    };
  }

  return {
    performed: false,
    action: null,
    via: null,
    command: null,
  };
}

export async function runTerminalCompat_func(sdk_var: AntigravitySDK): Promise<DriveProgressResult> {
  const capabilities_var = await getCascadeCapabilities_func(sdk_var);

  const terminal_result_var = await trySdkThenCommand_func(
    async () => {
      await sdk_var.cascade.runTerminalCommand();
    },
    sdk_var,
    capabilities_var.terminalRunCommand ?? capabilities_var.terminalAcceptCommand,
  );
  if (terminal_result_var) {
    return {
      performed: true,
      action: 'run-terminal',
      via: terminal_result_var.via,
      command: terminal_result_var.command,
    };
  }

  return {
    performed: false,
    action: null,
    via: null,
    command: null,
  };
}

export async function rejectStepCompat_func(sdk_var: AntigravitySDK): Promise<void> {
  const capabilities_var = await getCascadeCapabilities_func(sdk_var);
  const result_var = await trySdkThenCommand_func(
    async () => {
      await sdk_var.cascade.rejectStep();
    },
    sdk_var,
    capabilities_var.editRejectCommand,
  );

  if (!result_var) {
    throw new Error('No compatible reject-step action was available.');
  }
}

export async function driveCascadeProgress_func(sdk_var: AntigravitySDK): Promise<DriveProgressResult> {
  const edit_result_var = await acceptStepCompat_func(sdk_var);
  if (edit_result_var.performed) {
    return edit_result_var;
  }

  const command_result_var = await acceptCommandCompat_func(sdk_var);
  if (command_result_var.performed) {
    return command_result_var;
  }

  const terminal_result_var = await runTerminalCompat_func(sdk_var);
  if (terminal_result_var.performed) {
    return terminal_result_var;
  }

  return {
    performed: false,
    action: null,
    via: null,
    command: null,
  };
}

export async function warmCascadeCapabilities_func(sdk_var: AntigravitySDK): Promise<void> {
  await getCascadeCapabilities_func(sdk_var);
}

export function resetCascadeCapabilitiesForTesting_func(): void {
  cached_capabilities_var = null;
  inflight_capabilities_var = null;
}
