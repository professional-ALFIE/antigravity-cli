# Fingerprint + Offline-Gateway 코드 현황 조사

## 목적
v0.3.0 plan에 추가할 2개 feature의 코드 현황을 조사한다:
1. **fingerprint 자동화**: auth login 때 생성 + switch 때 적용
2. **Offline-Gateway 최소 동작경로**: offline-only에서도 live LS 상태 + state.vscdb fast-path 사용

## 조사 대상

### 1. Fingerprint 관련
- `src/services/` 아래에 fingerprint, deviceFingerprint, machineId, serviceMachineId 관련 코드가 있는지
- `ref/prettier-formatted/ANNOTATED_INDEX.md`에 fingerprint 관련 조사 내용이 있는지
- `ref/antigravity-app/` 아래에 cockpit/ClientGateway의 fingerprint 로직이 있는지
- 기존 authLogin.ts나 accounts.ts에 이미 fingerprint 생성/저장 로직이 있는지
- main.ts에 switch 시 fingerprint/serviceMachineId를 맞추는 로직이 있는지
- `handoff-plan-spec/` 아래에 fingerprint 조사 문서가 있는지

### 2. Offline-Gateway 관련
- 기존 offline-only 방식(`runOfflineSession_func`)의 현재 구조
- `src/services/fakeExtensionServer.ts`가 offline에서 어떤 역할을 하는지
- `src/services/liveAttach.ts`의 live LS fast-path 구조 (이걸 offline에서도 쓸 수 있는지)
- `state.vscdb`에서 quota를 읽는 로직이 이미 있는지 (`stateVscdb.ts`의 `extractUserStatusSummary_func`)
- `ref/prettier-formatted/ANNOTATED_INDEX.md`에 ClientGateway 관련 조사 내용이 있는지
- cockpit 관련 조사 문서: `handoff-plan-spec/cockpit조사-*.md` 파일들
- 기존 `runOfflineSession_func`에서 surfaced/trajectorySummaries hydration이 어떻게 이루어지는지

### 3. 출력 형식
각 feature에 대해:
- 이미 존재하는 코드 (파일:라인)
- 새로 작성해야 할 코드
- 참고할 cockpit/ClientGateway 패턴 (파일 경로)
- 의존성 (기존 plan의 어느 Task에 의존하는지)

결과를 `.sisyphus/outputs/`에 파일로 저장하라.
