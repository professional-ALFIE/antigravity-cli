• 1. 한 줄 결론

  주인님 기준 결론은, 공통 CLI entry는 지금 main() 초반 검증부에 두고, create와 resume-send만 live attach
  선시도 -> 첫 mutating RPC 전 실패면 offline headless fallback으로 감싸며, resume-list는 1차 범위에서 분
  리하는 것이 가장 현실적입니다.

  2. 추천 CLI 분기 구조

  근거로 본 범위는 src/main.ts:1208, src/services/connectRpc.ts:503, src/services/stateVscdb.ts:855, /
  Users/noseung-gyeong/Dropbox/issue-34-antigravity-cli/packages/sdk/src/transport/ls-bridge.ts:404, /
  Users/noseung-gyeong/Dropbox/issue-34-antigravity-cli/packages/extension/src/extension.ts:23입니다.

  - 공통 entry: 현재처럼 argv/help/unsupported/prompt 검증, workspaceRootPath, workspaceId, model 결정까지
  만 먼저 수행합니다. 이 구간은 그대로 재사용하면 됩니다. 지금도 write 핸들러는 이미 DiscoveryInfo만 주어
  지면 동작하도록 분리돼 있습니다. src/main.ts:1208, src/main.ts:1460, src/main.ts:1661
  - 분기 기준: 기준은 “IDE가 켜져 있는가”가 아니라 “현재 workspace와 매칭되는 live LS에 안전하게 attach 가
  능한가”입니다. 즉 workspace_id 매칭, CSRF 추출, ConnectRPC 포트 확인, 비파괴 probe 1회까지 통과해야 live
  path로 간주합니다. discovery만 됐다고 성공으로 치면 안 됩니다.
  - live path: 최소 단계는 4개면 충분합니다. 1) 현재 cwd로 workspaceId를 같은 방식으로 계산합니다. src/
  utils/config.ts:93 2) ps에서 language_server와 csrf_token이 있는 프로세스를 찾고, --workspace_id 정확 일
  치로 좁힙니다. /Users/noseung-gyeong/Dropbox/issue-34-antigravity-cli/packages/extension/src/
  extension.ts:25, /Users/noseung-gyeong/Dropbox/issue-34-antigravity-cli/packages/sdk/src/transport/ls-
  bridge.ts:441 3) PID 기준 listening port를 모아 extension_server_port와 lsp_port를 제외하고 HTTPS 우선
  probe로 ConnectRPC 포트를 고릅니다. /Users/noseung-gyeong/Dropbox/issue-34-antigravity-cli/packages/
  extension/src/extension.ts:65, /Users/noseung-gyeong/Dropbox/issue-34-antigravity-cli/packages/sdk/src/
  transport/ls-bridge.ts:501 4) 그렇게 만든 DiscoveryInfo로 현재 callConnectRpc / callConnectProtoRpc를 그
  대로 재사용해 attach probe 후 실제 write를 수행합니다. src/services/connectRpc.ts:564, src/services/
  connectRpc.ts:738
  - offline path: live attach가 안 되면 지금의 headless boot 순서를 거의 그대로 탑니다. OAuth 추출 -> fake
  extension server -> LS spawn -> discovery wait -> topic wait -> chat stream 준비 -> create/resume-send
  실행 -> trajectorySummaries + sidebarWorkspaces atomic persist 순서입니다. 이 경로는 이미 later-open
  surfaced를 위한 핵심 로직이 분리돼 있습니다. src/main.ts:1275, src/main.ts:1333, src/main.ts:1367, src/
  main.ts:725, src/services/stateVscdb.ts:968
  - create와 resume-send: 같은 분기 구조에 태우는 것이 맞습니다. 둘 다 결국 “mutating write 1회 이상 수행
  하는 작업”이라 공통 wrapper로 묶을 수 있습니다. 반대로 resume-list는 read-only라서 이 하이브리드 write
  경로에 억지로 넣지 않는 편이 merge risk가 낮습니다.

  3. 단계별 구현 계획

  - 1단계: 현재 offline boot를 runOfflineSession() 같은 함수로 먼저 뽑고 동작을 100% 유지합니다. 이 단계는
  동작 변경 없이 main()의 Step 5~14만 이동하는 수준이어야 합니다.
  - 2단계: live discovery 전용 helper를 추가합니다. 범위는 workspace_id 계산, 프로세스 매칭, CSRF/port 추
  출, 비파괴 probe까지만입니다. 이 helper는 “attach 가능/불가”만 반환하고, 실제 write는 하지 않게 두는 편
  이 안전합니다.
  - 3단계: create만 하이브리드 wrapper에 연결합니다. 흐름은 tryLiveAttach -> live create 실행 -> 실패 시
  offline create입니다. 이때 정상 검증은 “live attach 성공 시 UI 즉시 반영”, 실패 검증은 “live miss 시
  offline persist 성공” 두 가지만 먼저 봅니다.
  - 4단계: 같은 wrapper를 resume-send에 확장합니다. 추가 검증은 하나만 더 있으면 됩니다. invalid cascadeId
  같은 live semantic error는 fallback하지 않고 즉시 실패해야 합니다. 여기서 fallback하면 메시지 중복이나
  잘못된 새 대화 생성 위험이 생깁니다.
  - 5단계: 출력 정리를 마지막에 합니다. --json stdout 계약은 유지하고, 모드/폴백/경고는 전부 stderr로 보냅
  니다. 추천 문구는 세 줄이면 충분합니다. live attach matched, live attach unavailable, falling back to
  offline, offline persist completed; will surface on next app launch.

  4. 실패/폴백 규칙

  - fallback 허용: live LS 미발견, workspace_id 불일치, CSRF 추출 실패, ConnectRPC 포트 탐지 실패, attach
  probe의 ECONNREFUSED/ECONNRESET/timeout, 첫 mutating RPC를 보내기 전의 401/403/404는 offline으로 내려가
  도 됩니다. 공통점은 “아직 write가 실제로 들어가지 않았다”입니다.
  - 즉시 실패: CLI 입력 오류, resume-send의 잘못된 cascadeId, live attach 후 StartCascade가 이미 cascadeId
  를 반환했거나 SendUserCascadeMessage가 2xx를 반환한 뒤의 모든 오류는 fallback 금지입니다. 여기서 offline
  으로 다시 보내면 대화나 메시지가 중복됩니다.
  - offline 내부 오류: offline으로 내려간 뒤에는 현재 계약을 유지하는 편이 안전합니다. 즉 spawn/auth/
  discovery 자체 실패는 즉시 실패, surfaced hydrate 실패는 1차에서는 경고로 남기되 이유를 분명히 출력하는
  정도가 최소 변경입니다. atomic write 자체는 이미 한 트랜잭션 경계로 묶여 있습니다. src/services/
  stateVscdb.ts:968
  - 성공 판정 위치: 이 판정은 handleNewConversation_func나 handleResumeSend_func 내부가 아니라, 그 바깥의
  공통 hybrid wrapper에 둬야 합니다. 핸들러 안에서 fallback을 결정하면 mutating RPC 이후 경계를 놓치기 쉽
  습니다.

  5. 남는 리스크 한 줄

  남는 핵심 리스크는, live LS attach 시 기존 IDE의 chat-client stream만으로 항상 충분한지, 아니면 특정 상
  태에서 CLI가 별도 StartChatClientRequestStream을 열어야 하는지가 아직 런타임 검증이 더 필요하다는 점입니
  다.
