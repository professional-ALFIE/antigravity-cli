/**
 * commands — Antigravity 내부 명령어 관리 (서브커맨드: list, exec).
 */

import type { Command } from 'commander';
import type { Helpers } from '../helpers.js';
import { printResult } from '../output.js';
import { c } from '../colors.js';

/**
 * 검증된 명령어 설명 매핑.
 * 출처: 웹 검색 + Antigravity/Windsurf 공식 문서 확인 결과.
 * 미확인 명령어는 매핑에 포함하지 않는다 (작업 규칙 §1 준수).
 */
const COMMAND_DESCRIPTIONS: Record<string, string> = {
  // ── Conversation / Agent Control ──
  'antigravity.startNewConversation': 'Start new AI conversation',
  'antigravity.openConversationPicker': 'Open conversation picker UI',
  'antigravity.setVisibleConversation': 'Switch to specific conversation',
  'antigravity.sendTextToChat': 'Send text to chat',
  'antigravity.sendPromptToAgentPanel': 'Send prompt to agent panel',
  'antigravity.openAgent': 'Open agent panel',
  'antigravity.toggleChatFocus': 'Toggle chat focus',
  'antigravity.initializeAgent': 'Initialize agent',

  // ── Step Control (Accept/Reject) ──
  'antigravity.agent.acceptAgentStep': 'Accept code edit suggestion',
  'antigravity.agent.rejectAgentStep': 'Reject code edit suggestion',
  'antigravity.command.accept': 'Accept non-terminal action',
  'antigravity.command.reject': 'Reject non-terminal action',
  'antigravity.terminalCommand.run': 'Run terminal command',
  'antigravity.terminalCommand.accept': 'Accept terminal command',
  'antigravity.terminalCommand.reject': 'Reject terminal command',
  'antigravity.prioritized.agentAcceptAllInFile': 'Accept all changes in file',
  'antigravity.prioritized.agentRejectAllInFile': 'Reject all changes in file',
  'antigravity.prioritized.agentFocusNextFile': 'Focus next changed file',
  'antigravity.prioritized.agentFocusPreviousFile': 'Focus previous changed file',
  'antigravity.prioritized.agentFocusNextHunk': 'Focus next change hunk',
  'antigravity.prioritized.agentFocusPreviousHunk': 'Focus previous change hunk',
  'antigravity.prioritized.agentAcceptFocusedHunk': 'Accept focused change hunk',
  'antigravity.prioritized.agentRejectFocusedHunk': 'Reject focused change hunk',

  // ── Workflow / Rules ──
  'antigravity.createWorkflow': 'Create workspace workflow',
  'antigravity.createGlobalWorkflow': 'Create global workflow',
  'antigravity.createRule': 'Create agent rule',

  // ── Git Integration ──
  'antigravity.generateCommitMessage': 'AI-generate commit message from staged changes',
  'antigravity.cancelGenerateCommitMessage': 'Cancel commit message generation',
  'antigravity.isFileGitIgnored': 'Check if file matches .gitignore',

  // ── Code Review / Editing ──
  'antigravity.openReviewChanges': 'Open review changes panel',
  'antigravity.openInteractiveEditor': 'Open inline AI editing UI',
  'antigravity.prioritized.explainProblem': 'AI-explain selected problem',
  'antigravity.explainAndFixProblem': 'Explain + auto-fix problem',
  'antigravity.acceptCompletion': 'Accept completion',
  'antigravity.prioritized.supercompleteAccept': 'Accept Supercomplete suggestion',
  'antigravity.prioritized.supercompleteEscape': 'Dismiss Supercomplete suggestion',
  'antigravity.snoozeAutocomplete': 'Snooze autocomplete',
  'antigravity.cancelSnoozeAutocomplete': 'Resume autocomplete',

  // ── Diff Zone (Code Change Preview) ──
  'antigravity.openDiffZones': 'Open code change preview',
  'antigravity.closeAllDiffZones': 'Close all code change previews',
  'antigravity.setDiffZonesState': 'Set code change preview state',
  'antigravity.handleDiffZoneEdit': 'Handle code change preview edit',
  'antigravity.sidecar.sendDiffZone': 'Send diff to sidecar',

  // ── IDE Control ──
  'antigravity.reloadWindow': 'Reload IDE window',
  'antigravity.restartLanguageServer': 'Restart language server',
  'antigravity.killLanguageServerAndReloadWindow': 'Force kill language server + reload',
  'antigravity.togglePersistentLanguageServer': 'Toggle persistent language server mode',
  'antigravity.switchBetweenWorkspaceAndAgent': 'Switch between workspace and agent view',
  'antigravity.restartUserStatusUpdater': 'Restart user status updater',
  'antigravity.setWorkingDirectories': 'Set working directories',

  // ── UI Panels ──
  'antigravity.agentSidePanel.open': 'Open agent side panel',
  'antigravity.agentSidePanel.focus': 'Focus agent side panel',
  'antigravity.agentPanel.open': 'Open agent panel',
  'antigravity.agentPanel.focus': 'Focus agent panel',
  'antigravity.agentSidePanel.toggleVisibility': 'Toggle side panel visibility',
  'antigravity.editorModeSettings': 'Editor mode settings',
  'antigravity.openQuickSettingsPanel': 'Open quick settings panel',
  'antigravity.sendTerminalToSidePanel': 'Move terminal to side panel',
  'antigravity.showManagedTerminal': 'Show managed terminal',
  'antigravity.prioritized.command.open': 'Open command input',
  'antigravity.prioritized.terminalCommand.open': 'Open terminal command input',

  // ── Settings / Customization ──
  'antigravity.openCustomizationsTab': 'Open customizations tab',
  'antigravity.openGlobalRules': 'Open global rules editor',
  'antigravity.openConfigurePluginsPage': 'Open plugin settings page',
  'antigravity.customizeAppIcon': 'Change app icon',
  'antigravity.showBrowserAllowlist': 'Show browser allowlist',
  'antigravity.openMcpConfigFile': 'Open MCP config file',

  // ── Docs / Help ──
  'antigravity.openDocs': 'Open official docs',
  'antigravity.openMcpDocsPage': 'Open MCP docs',
  'antigravity.openRulesEducationalLink': 'Open rules guide',
  'antigravity.openTroubleshooting': 'Open troubleshooting guide',
  'antigravity.openChangeLog': 'Open changelog',
  'antigravity.openIssueReporter': 'Open bug reporter',
  'antigravity.openGenericUrl': 'Open URL',

  // ── Diagnostics / Debugging ──
  'antigravity.getDiagnostics': 'Get diagnostics',
  'antigravity.downloadDiagnostics': 'Save diagnostics to file',
  'antigravity.updateDebugInfoWidget': 'Update debug info widget',
  'antigravity.toggleDebugInfoWidget': 'Toggle debug info widget',
  'antigravity.toggleManagerDevTools': 'Toggle manager dev tools',
  'antigravity.toggleSettingsDevTools': 'Toggle settings dev tools',
  'antigravity.enableTracing': 'Enable tracing',
  'antigravity.clearAndDisableTracing': 'Disable tracing + clear data',
  'antigravity.getWorkbenchTrace': 'Get workbench trace',
  'antigravity.getManagerTrace': 'Get manager trace',
  'antigravity.captureTraces': 'Capture traces',
  'antigravity.simulateSegFault': 'Simulate segfault (test)',

  // ── Terminal Events ──
  'antigravity.onShellCommandCompletion': 'Terminal command completion event',
  'antigravity.onManagerTerminalCommandStart': 'Managed terminal command start event',
  'antigravity.onManagerTerminalCommandData': 'Managed terminal command data event',
  'antigravity.onManagerTerminalCommandFinish': 'Managed terminal command finish event',
  'antigravity.updateTerminalLastCommand': 'Update last terminal command',

  // ── Auth ──
  'antigravity.cancelLogin': 'Cancel login',
  'antigravity.handleAuthRefresh': 'Refresh auth token',

  // ── Settings Import ──
  'antigravity.migrateWindsurfSettings': 'Migrate Windsurf settings',
  'antigravity.importVSCodeSettings': 'Import VS Code settings',
  'antigravity.importVSCodeExtensions': 'Import VS Code extensions',
  'antigravity.importVSCodeRecentWorkspaces': 'Import VS Code recent workspaces',
  'antigravity.importCursorSettings': 'Import Cursor settings',
  'antigravity.importCursorExtensions': 'Import Cursor extensions',
  'antigravity.importCiderSettings': 'Import Cider settings',
  'antigravity.importWindsurfSettings': 'Import Windsurf settings',
  'antigravity.importWindsurfExtensions': 'Import Windsurf extensions',

  // ── Onboarding ──
  'antigravity.onboarding.reset': 'Reset onboarding',
  'antigravity.manager.onboarding.reset': 'Reset manager onboarding',
  'antigravity.resetOnboardingBackend': 'Reset onboarding backend',

  // ── Browser / MCP ──
  'antigravity.openBrowser': 'Open browser agent',
  'antigravity.getBrowserOnboardingPort': 'Get browser onboarding port',
  'antigravity.pollMcpServerStates': 'Poll MCP server states',
  'antigravity.getChromeDevtoolsMcpUrl': 'Get Chrome DevTools MCP URL',

  // ── Misc ──
  'antigravity.openInCiderAction.topBar': 'Open app from top bar',
  'antigravity.toggleNewConvoStreamFormat': 'Toggle new conversation stream format',
  'antigravity.playAudio': 'Play audio',
  'antigravity.playNote': 'Play notification sound',
  'antigravity.sendAnalyticsAction': 'Send analytics event',
  'antigravity.uploadErrorAction': 'Upload error log',
  'antigravity.logObservabilityDataAction': 'Log observability data',
  'antigravity.artifacts.startComment': 'Start artifact comment',
  'antigravity.trackBackgroundConversationCreated': 'Track background conversation creation',
  'antigravity.sendChatActionMessage': 'Send chat action message',
  'antigravity.tabReporting': 'Tab reporting',
  'antigravity.executeCascadeAction': 'Execute agent action',
  'antigravity.prioritized.chat.openNewConversation': 'Open new conversation chat',
  'antigravity.getCascadePluginTemplate': 'Get plugin template',
  'antigravity.updatePluginInstallationCount': 'Update plugin install count',
  'antigravity.openConversationWorkspaceQuickPick': 'Conversation workspace picker',
  'antigravity.killRemoteExtensionHost': 'Kill remote extension host',
  'antigravity.startDemoMode': 'Start demo mode',
  'antigravity.endDemoMode': 'End demo mode',
  'antigravity.toggleRerenderFrequencyAlerts': 'Toggle rerender frequency alerts',

  // ── View Layout (Panel Position Reset) ──
  'antigravity.agentViewContainerId.resetViewContainerLocation': 'Reset agent view container location',
  'antigravity.agentSidePanel.expandView': 'Expand side panel',
  'antigravity.agentSidePanel.resetViewLocation': 'Reset side panel location',
  'antigravity.agentPanel.expandView': 'Expand agent panel',
  'antigravity.agentPanel.resetViewLocation': 'Reset agent panel location',
  'antigravity.agentViewContainerId': 'Agent view container',
  'antigravity.agentSidePanel.removeView': 'Remove side panel view',

  // ── Error Screens ──
  'antigravity.showSshDisconnectionFullScreenView': 'Show SSH disconnection screen',
  'antigravity.showLanguageServerInitFailureFullScreenView': 'Show language server init failure screen',
  'antigravity.showAuthFailureFullScreenView': 'Show auth failure screen',
  'antigravity.showLanguageServerCrashFullScreenView': 'Show language server crash screen',
  'antigravity.hideFullScreenView': 'Hide fullscreen error view',
};

export function register(program: Command, h: Helpers): void {
  const commandsCmd_var = program
    .command('commands')
    .description('List / execute internal Antigravity commands');

  commandsCmd_var
    .command('list')
    .description('List registered commands')
    .action(async () => {
      await h.run(async () => {
        const client_var = await h.getClient();
        const result_var = await client_var.get('commands/list');
        if (!result_var.success) throw new Error(result_var.error ?? 'list failed');

        if (h.isJsonMode()) {
          printResult(result_var.data, true);
          return;
        }

        const cmds_var = result_var.data as string[];
        if (!cmds_var.length) {
          console.log('(no commands)');
          return;
        }

        // 가장 긴 명령어 이름 길이 계산 (정렬용)
        const maxLen_var = Math.max(...cmds_var.map((cmd_var) => cmd_var.length));

        for (const cmd_var of cmds_var) {
          const desc_var = COMMAND_DESCRIPTIONS[cmd_var];
          if (desc_var) {
            const padding_var = ' '.repeat(maxLen_var - cmd_var.length + 4);
            console.log(`  ${c.cyan(cmd_var)}${padding_var}${c.dim(desc_var)}`);
          } else {
            console.log(`  ${cmd_var}`);
          }
        }

        console.log(`\n  ${c.dim(`${cmds_var.length} commands total`)}`);
      });
    });

  commandsCmd_var
    .command('exec <cmd> [args...]')
    .description('Execute internal command directly')
    .action(async (cmd: string, args: string[]) => {
      await h.run(async () => {
        const client_var = await h.getClient();
        const result_var = await client_var.post('commands/exec', { command: cmd, args });
        if (!result_var.success) throw new Error(result_var.error ?? 'exec failed');
        printResult(result_var.data, h.isJsonMode());
      });
    });
}
