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
  // ── 대화/에이전트 제어 ──
  'antigravity.startNewConversation': '새 AI 대화 시작',
  'antigravity.openConversationPicker': '대화 선택 UI 열기',
  'antigravity.setVisibleConversation': '특정 대화로 전환',
  'antigravity.sendTextToChat': '채팅에 텍스트 전송',
  'antigravity.sendPromptToAgentPanel': '에이전트 패널에 프롬프트 전송',
  'antigravity.openAgent': '에이전트 패널 열기',
  'antigravity.toggleChatFocus': '채팅 포커스 토글',
  'antigravity.initializeAgent': '에이전트 초기화',

  // ── 스텝 제어 (Accept/Reject) ──
  'antigravity.agent.acceptAgentStep': '코드 편집 제안 수락',
  'antigravity.agent.rejectAgentStep': '코드 편집 제안 거부',
  'antigravity.command.accept': '비-터미널 액션 수락',
  'antigravity.command.reject': '비-터미널 액션 거부',
  'antigravity.terminalCommand.run': '터미널 명령 실행',
  'antigravity.terminalCommand.accept': '터미널 명령 수락',
  'antigravity.terminalCommand.reject': '터미널 명령 거부',
  'antigravity.prioritized.agentAcceptAllInFile': '파일 내 전체 변경사항 수락',
  'antigravity.prioritized.agentRejectAllInFile': '파일 내 전체 변경사항 거부',
  'antigravity.prioritized.agentFocusNextFile': '다음 변경 파일로 포커스 이동',
  'antigravity.prioritized.agentFocusPreviousFile': '이전 변경 파일로 포커스 이동',
  'antigravity.prioritized.agentFocusNextHunk': '다음 변경 블록으로 이동',
  'antigravity.prioritized.agentFocusPreviousHunk': '이전 변경 블록으로 이동',
  'antigravity.prioritized.agentAcceptFocusedHunk': '현재 변경 블록 수락',
  'antigravity.prioritized.agentRejectFocusedHunk': '현재 변경 블록 거부',

  // ── 워크플로우/규칙 ──
  'antigravity.createWorkflow': '워크스페이스 워크플로우 생성',
  'antigravity.createGlobalWorkflow': '글로벌 워크플로우 생성',
  'antigravity.createRule': '에이전트 규칙 생성',

  // ── Git 연동 ──
  'antigravity.generateCommitMessage': 'staged 변경 기반 커밋 메시지 AI 생성',
  'antigravity.cancelGenerateCommitMessage': '커밋 메시지 생성 취소',
  'antigravity.isFileGitIgnored': '파일이 .gitignore에 해당하는지 확인',

  // ── 코드 리뷰/편집 ──
  'antigravity.openReviewChanges': '변경사항 리뷰 패널 열기',
  'antigravity.openInteractiveEditor': '인라인 AI 편집 UI 열기',
  'antigravity.prioritized.explainProblem': '선택한 문제 AI 설명',
  'antigravity.explainAndFixProblem': '문제 설명 + 자동 수정',
  'antigravity.acceptCompletion': '자동완성 수락',
  'antigravity.prioritized.supercompleteAccept': 'Supercomplete 제안 수락',
  'antigravity.prioritized.supercompleteEscape': 'Supercomplete 제안 닫기',
  'antigravity.snoozeAutocomplete': '자동완성 일시 중지',
  'antigravity.cancelSnoozeAutocomplete': '자동완성 재개',

  // ── Diff Zone (코드 변경 미리보기) ──
  'antigravity.openDiffZones': '코드 변경 미리보기 열기',
  'antigravity.closeAllDiffZones': '모든 코드 변경 미리보기 닫기',
  'antigravity.setDiffZonesState': '코드 변경 미리보기 상태 설정',
  'antigravity.handleDiffZoneEdit': '코드 변경 미리보기 편집 처리',
  'antigravity.sidecar.sendDiffZone': '사이드카에 diff 전송',

  // ── IDE 제어 ──
  'antigravity.reloadWindow': 'IDE 창 리로드',
  'antigravity.restartLanguageServer': '언어 서버 재시작',
  'antigravity.killLanguageServerAndReloadWindow': '언어 서버 강제 종료 + 리로드',
  'antigravity.togglePersistentLanguageServer': '언어 서버 지속 모드 토글',
  'antigravity.switchBetweenWorkspaceAndAgent': '작업공간 ↔ 에이전트 화면 전환',
  'antigravity.restartUserStatusUpdater': '유저 상태 업데이터 재시작',
  'antigravity.setWorkingDirectories': '작업 디렉토리 설정',

  // ── UI 패널 ──
  'antigravity.agentSidePanel.open': '에이전트 사이드 패널 열기',
  'antigravity.agentSidePanel.focus': '에이전트 사이드 패널 포커스',
  'antigravity.agentPanel.open': '에이전트 패널 열기',
  'antigravity.agentPanel.focus': '에이전트 패널 포커스',
  'antigravity.agentSidePanel.toggleVisibility': '사이드 패널 표시 토글',
  'antigravity.editorModeSettings': '에디터 모드 설정',
  'antigravity.openQuickSettingsPanel': '빠른 설정 패널 열기',
  'antigravity.sendTerminalToSidePanel': '터미널을 사이드 패널로 이동',
  'antigravity.showManagedTerminal': '관리 터미널 표시',
  'antigravity.prioritized.command.open': '명령 입력 열기',
  'antigravity.prioritized.terminalCommand.open': '터미널 명령 입력 열기',

  // ── 설정/커스터마이징 ──
  'antigravity.openCustomizationsTab': '커스터마이징 탭 열기',
  'antigravity.openGlobalRules': '글로벌 규칙 편집기 열기',
  'antigravity.openConfigurePluginsPage': '플러그인 설정 페이지 열기',
  'antigravity.customizeAppIcon': '앱 아이콘 변경',
  'antigravity.showBrowserAllowlist': '브라우저 허용 목록 표시',
  'antigravity.openMcpConfigFile': 'MCP 설정 파일 열기',

  // ── 문서/도움말 ──
  'antigravity.openDocs': '공식 문서 열기',
  'antigravity.openMcpDocsPage': 'MCP 문서 열기',
  'antigravity.openRulesEducationalLink': '규칙 가이드 열기',
  'antigravity.openTroubleshooting': '문제 해결 가이드 열기',
  'antigravity.openChangeLog': '변경 로그 열기',
  'antigravity.openIssueReporter': '버그 리포트 열기',
  'antigravity.openGenericUrl': 'URL 열기',

  // ── 진단/디버깅 ──
  'antigravity.getDiagnostics': '진단 정보 조회',
  'antigravity.downloadDiagnostics': '진단 정보 파일로 저장',
  'antigravity.updateDebugInfoWidget': '디버그 정보 위젯 갱신',
  'antigravity.toggleDebugInfoWidget': '디버그 정보 위젯 토글',
  'antigravity.toggleManagerDevTools': '매니저 개발자 도구 토글',
  'antigravity.toggleSettingsDevTools': '설정 개발자 도구 토글',
  'antigravity.enableTracing': '트레이싱 활성화',
  'antigravity.clearAndDisableTracing': '트레이싱 비활성화 + 데이터 삭제',
  'antigravity.getWorkbenchTrace': 'Workbench 트레이스 조회',
  'antigravity.getManagerTrace': '매니저 트레이스 조회',
  'antigravity.captureTraces': '트레이스 캡처',
  'antigravity.simulateSegFault': '세그폴트 시뮬레이션 (테스트용)',

  // ── 터미널 이벤트 ──
  'antigravity.onShellCommandCompletion': '터미널 명령 완료 이벤트',
  'antigravity.onManagerTerminalCommandStart': '관리 터미널 명령 시작 이벤트',
  'antigravity.onManagerTerminalCommandData': '관리 터미널 명령 데이터 이벤트',
  'antigravity.onManagerTerminalCommandFinish': '관리 터미널 명령 종료 이벤트',
  'antigravity.updateTerminalLastCommand': '마지막 터미널 명령 갱신',

  // ── 인증 ──
  'antigravity.cancelLogin': '로그인 취소',
  'antigravity.handleAuthRefresh': '인증 토큰 갱신',

  // ── 설정 가져오기 ──
  'antigravity.migrateWindsurfSettings': 'Windsurf 설정 마이그레이션',
  'antigravity.importVSCodeSettings': 'VS Code 설정 가져오기',
  'antigravity.importVSCodeExtensions': 'VS Code 확장 가져오기',
  'antigravity.importVSCodeRecentWorkspaces': 'VS Code 최근 워크스페이스 가져오기',
  'antigravity.importCursorSettings': 'Cursor 설정 가져오기',
  'antigravity.importCursorExtensions': 'Cursor 확장 가져오기',
  'antigravity.importCiderSettings': 'Cider 설정 가져오기',
  'antigravity.importWindsurfSettings': 'Windsurf 설정 가져오기',
  'antigravity.importWindsurfExtensions': 'Windsurf 확장 가져오기',

  // ── 온보딩 ──
  'antigravity.onboarding.reset': '온보딩 초기화',
  'antigravity.manager.onboarding.reset': '매니저 온보딩 초기화',
  'antigravity.resetOnboardingBackend': '온보딩 백엔드 초기화',

  // ── 브라우저/MCP ──
  'antigravity.openBrowser': '브라우저 에이전트 열기',
  'antigravity.getBrowserOnboardingPort': '브라우저 온보딩 포트 조회',
  'antigravity.pollMcpServerStates': 'MCP 서버 상태 폴링',
  'antigravity.getChromeDevtoolsMcpUrl': 'Chrome DevTools MCP URL 조회',

  // ── 기타 ──
  'antigravity.openInCiderAction.topBar': '상단 바에서 앱 열기',
  'antigravity.toggleNewConvoStreamFormat': '새 대화 스트림 형식 토글',
  'antigravity.playAudio': '오디오 재생',
  'antigravity.playNote': '알림음 재생',
  'antigravity.sendAnalyticsAction': '분석 이벤트 전송',
  'antigravity.uploadErrorAction': '에러 로그 업로드',
  'antigravity.logObservabilityDataAction': '관측성 데이터 기록',
  'antigravity.artifacts.startComment': '아티팩트 코멘트 시작',
  'antigravity.trackBackgroundConversationCreated': '백그라운드 대화 생성 추적',
  'antigravity.sendChatActionMessage': '채팅 액션 메시지 전송',
  'antigravity.tabReporting': '탭 리포팅',
  'antigravity.executeCascadeAction': '에이전트 액션 실행',
  'antigravity.prioritized.chat.openNewConversation': '새 대화 채팅 열기',
  'antigravity.getCascadePluginTemplate': '플러그인 템플릿 조회',
  'antigravity.updatePluginInstallationCount': '플러그인 설치 카운트 갱신',
  'antigravity.openConversationWorkspaceQuickPick': '대화 워크스페이스 선택',
  'antigravity.killRemoteExtensionHost': '원격 확장 호스트 종료',
  'antigravity.startDemoMode': '데모 모드 시작',
  'antigravity.endDemoMode': '데모 모드 종료',
  'antigravity.toggleRerenderFrequencyAlerts': '리렌더링 빈도 알림 토글',

  // ── 뷰 레이아웃 (패널 위치 리셋) ──
  'antigravity.agentViewContainerId.resetViewContainerLocation': '에이전트 뷰 컨테이너 위치 리셋',
  'antigravity.agentSidePanel.expandView': '사이드 패널 확장',
  'antigravity.agentSidePanel.resetViewLocation': '사이드 패널 위치 리셋',
  'antigravity.agentPanel.expandView': '에이전트 패널 확장',
  'antigravity.agentPanel.resetViewLocation': '에이전트 패널 위치 리셋',
  'antigravity.agentViewContainerId': '에이전트 뷰 컨테이너',
  'antigravity.agentSidePanel.removeView': '사이드 패널 뷰 제거',

  // ── 에러 화면 ──
  'antigravity.showSshDisconnectionFullScreenView': 'SSH 연결 끊김 화면 표시',
  'antigravity.showLanguageServerInitFailureFullScreenView': '언어 서버 초기화 실패 화면',
  'antigravity.showAuthFailureFullScreenView': '인증 실패 화면 표시',
  'antigravity.showLanguageServerCrashFullScreenView': '언어 서버 크래시 화면 표시',
  'antigravity.hideFullScreenView': '전체 화면 오류 닫기',
};

export function register(program: Command, h: Helpers): void {
  const commandsCmd_var = program
    .command('commands')
    .description('Antigravity 내부 명령어 조회/직접 실행');

  commandsCmd_var
    .command('list')
    .description('등록된 명령 목록')
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

        console.log(`\n  ${c.dim(`총 ${cmds_var.length}개 명령어`)}`);
      });
    });

  commandsCmd_var
    .command('exec <cmd> [args...]')
    .description('내부 명령 직접 실행')
    .action(async (cmd: string, args: string[]) => {
      await h.run(async () => {
        const client_var = await h.getClient();
        const result_var = await client_var.post('commands/exec', { command: cmd, args });
        if (!result_var.success) throw new Error(result_var.error ?? 'exec failed');
        printResult(result_var.data, h.isJsonMode());
      });
    });
}
