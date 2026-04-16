# v0.2.1 Auth Overhaul — 통합 Spec

> **버전**: v0.2.1 (이 문서 완료 시 v0.2.1 릴리스)
> **성격**: auth-only 리팩토링. 인증만 바꾸는 리팩토링이 핵심 주제.
> **베이스**: `handoff-plan-spec/v0.2.1-02-spec-gpt.md` (기능 스코프) + `handoff-plan-spec/v0.2.1-02-spec-opus.md` (상세 설계) 병합
> **조사 근거**: `cockpit조사-01-auth.md`, `cockpit조사-03-quota.md`, Seamless Switch 조사 (2026-04-15)

---

## 목차

1. [핵심 요약](#1-핵심-요약)
2. [원칙과 비원칙](#2-원칙과-비원칙)
3. [현재 구현과 목표 차이](#3-현재-구현과-목표-차이)
4. [Feature 1: auth login (OAuth + Local Import)](#4-feature-1-auth-login)
5. [Feature 2: auth list (Cloud Code Quota + Auth Inject)](#5-feature-2-auth-list)
6. [Feature 3: Auto-Rotate (Sticky-Threshold Rotation)](#6-feature-3-auto-rotate)
7. [Feature 4: Wake-up](#7-feature-4-wake-up)
8. [Feature 5: Seamless Switch (Experimental)](#8-feature-5-seamless-switch)
9. [Account Store 스키마](#9-account-store-스키마)
10. [성공 조건 (주장 + 증명)](#10-성공-조건)
11. [NOT NOW](#11-not-now)
12. [구현 순서](#12-구현-순서)
13. [참조 맵](#13-참조-맵)

---

## 1. 핵심 요약

이번 단계의 목표는 **auth를 아래 구조로 재정렬**하는 것이다.

- **auth login**: 앱 실행형 로그인 대신 브라우저 OAuth로 계정을 획득. 앱 의존 완전 제거.
- **auth list**: Cloud Code API에서 직접 quota 조회 + 계정 선택 시 auth inject.
- **계정 전환**: 기본 프로필 하나만 유지. auth 관련 키만 교체 (Account Overlay).
- **자동 회전**: 메시지 전송 경로에서만 quota를 보고 회전 여부를 판정. 작업 종료 후 적용.
- **wake-up**: 잠든 계정(quota=null)을 1턴 실행으로 활성화.
- **seamless switch (experimental)**: LS 재시작 없이 계정 전환. 조사 후 기본 경로 승격 가능.

한 줄로 줄이면:

> 프로필 복제형 auth에서 → 계정 저장소 + auth overlay + direct quota + auto-rotate 기반 운영형 auth로 바꾼다.

---

## 2. 원칙과 비원칙

### 2-1. 핵심 원칙

| 원칙 | 설명 |
|------|------|
| `Account Overlay` | base profile 하나만 유지하고 auth 관련 키만 바꾼다. 세션/대화/캐시는 전환으로 소실되지 않는다. |
| `No Side Effect on Read` | help/list/resume-list 등 읽기 전용 명령에서는 inject/rotate를 일으키지 않는다. |
| `Cloud Code Direct` | quota 조회는 LS가 아니라 REST API 직접 호출을 기본으로 한다. |
| `Deferred Inject` | rotate는 작업 전에 판정하고, 실제 inject는 작업 종료 후 한다. |
| `Durable Intent` | rotate 판정 결과는 `pending-switch.json`에 영속화. CLI가 중간에 죽어도 다음 실행에서 이어받음. |
| `Non-Blocking Fetch` | quota 네트워크 조회가 현재 명령을 block하지 않는다. 캐시 우선, timeout fallback. |
| `Full Switch Default` | Seamless Switch 미검증 → Full Switch가 기본. Seamless는 실험 항목. |

### 2-2. 이번 단계에서 하지 않는 것

- 계정별 전체 프로필 복제
- `auth login`에서 Antigravity 앱 실행
- read-only 명령에서 숨은 rotate/inject
- Plugin Sync, Device Fingerprint
- daemon 전제 설계
- 독립 quota 명령
- YAML 정책 엔진
- multi-workspace 지원

---

## 3. 현재 구현과 목표 차이

| 항목 | 현재 구현 | 목표 |
|------|-----------|------|
| `auth login` | 새 `user-data-dir`로 앱 실행 후 `state.vscdb` polling | 브라우저 OAuth + account store 저장 |
| 계정 저장 | `~/.antigravity-cli/user-data/user-*` (프로필 통째) | `accounts.json + accounts/<id>.json` (토큰만) |
| `auth list` quota 소스 | live LS → `GetUserStatus` RPC / persisted → `state.vscdb` 파싱 | Cloud Code direct fetch + 60초 캐시 |
| active account | `auth.json`에 name 저장 | account index에 current_account_id 저장 |
| 계정 전환 | 없음 (user-data-dir 교체 방식) | auth inject (state.vscdb auth 키만 교체) |
| rotate | 없음 | 메시지 전송 경로에서만 판정 후 작업 종료 뒤 적용 |
| wake-up | 없음 | 잠든 계정(null-quota) 1턴 실행으로 활성화 |
| seamless | 없음 | 실험적 (경로 A: kill+respawn / 경로 B: 기존 LS에 새 apiKey RPC) |

---

## 4. Feature 1: auth login

### 4-1. 등록 경로 3종

| 경로 | CLI 표면 | 내부 역할 | 우선순위 |
|------|---------|-----------|---------|
| **브라우저 OAuth** | `auth login` (기본) | 앱 의존 완전 제거. Cockpit와 동일 client_id/secret | 필수 |
| **Local Import** | CLI 명령 없음 | `importLocalFromStateDb_func()` 내부 함수. 기존 user-data-dir에서 토큰 추출. 8개 계정 재로그인 방지용 | 필수 (내부) |
| **import-token** | CLI 표면 없음 (내부 경로만) | 마이그레이션/이행용 내부 capability. .env 사용자 전환용 | 선택 |

### 4-2. 브라우저 OAuth 내부 동작

```
1. 127.0.0.1:0 로 로컬 callback server 바인딩 (랜덤 포트)
2. Google OAuth URL 생성:
   - client_id = Cockpit Tools와 동일 (oauth.rs L3)
   - client_secret = Cockpit Tools와 동일 (oauth.rs L4)
   - redirect_uri = http://localhost:{port}/oauth-callback
   - scope = cloud-platform, userinfo.email, userinfo.profile, cclog, experimentsandconfigs
   - access_type = offline  ← refresh_token 보장
   - prompt = consent       ← 항상 새 refresh_token
   - state = random UUID    ← CSRF 방어
3. 브라우저 열기 (`open` / xdg-open / start)
4. 콜백 대기 (최대 10분)
   - state 검증
   - authorization code 추출
   - 자동 콜백 실패 시 수동 URL 붙여넣기 경로
5. Token 교환: code → access_token + refresh_token
6. Google userinfo API → email, name
7. upsert: accounts.json 인덱스 + accounts/{id}.json 상세
8. Cloud Code quota 1회 조회 (등록 직후 상태 확인)
9. 성공 출력: "Logged in as {email}"
```

### 4-3. Local Import 내부 동작

```
1. 기존 user-data-dir 경로 목록 스캔:
   - default: ~/Library/Application Support/Antigravity/
   - managed: ~/.antigravity-cli/user-data/user-*/
2. 각 경로에서 state.vscdb 열기
3. uss-oauth topic bytes에서 access_token 추출
4. uss-enterprisePreferences에서 계정 정보 확인
5. refresh_token 획득:
   a. uss-oauth에 refresh_token 포함 시 → 추출하여 저장
   b. refresh_token 미포함 시 → access_token만 저장.
      account_status를 "needs_reauth"로 설정.
      이 계정은 quota 조회 불가, rotate 대상에서 제외.
      사용자에게 "agcl auth login으로 재로그인 필요" 안내.
      (refresh_token 없이 Google OAuth refresh flow를 수행하는 것은 불가능하다)
6. accounts.json에 upsert (OAuth로 얻은 것과 동일한 형식)
7. 마이그레이션 완료 시 기존 user-data-dir 삭제하지 않음
```

> **refresh_token nullable**: 기존 state.vscdb에서 refresh_token을 바로 얻지 못할 수 있다.
> 이 경우 token.refresh_token은 null이고, account_status는 "needs_reauth"가 된다.
> 이 계정은 `agcl auth login`으로 재로그인해야 정상 사용 가능하다.
> L-8 테스트는 access_token 존재를 기본 확인으로 하고, refresh_token은 nullable로 검증한다.

### 4-4. 파일 변경

| 파일 | 변경 |
|------|------|
| `src/services/authLogin.ts` | **전면 재작성**: `open -n -a` 제거, OAuth 서버 + 브라우저 열기 + 토큰 교환 + upsert |
| `src/services/accounts.ts` | Account Store 로직 추가: `upsertAccount_func`, `getAccount_func`, `listAccounts_func` |
| `src/services/oauthClient.ts` | **신규**: Google OAuth URL 생성, token exchange, refresh, userinfo |
| `src/main.ts` | `handleAuthLogin_func` 업데이트 |

### 4-5. 성공 조건

| ID | 주장 (주장+증명) | 증명 방법 |
|----|-----------------|----------|
| L-1 | `agcl auth login` 실행 → 브라우저 열림 → 구글 로그인 → CLI에 "Logged in as {email}" 출력 | **도구**: 수동 E2E + `cat`. **절차**: 1) `agcl auth login` 실행. 2) 브라우저 자동 열림 확인. 3) 구글 로그인 완료. 4) CLI 터미널에 "Logged in as {email}" 출력 확인. 5) `cat ~/.antigravity-cli/accounts.json` → 해당 email 항목 존재 확인. **기대**: stdout에 "Logged in as {email}", accounts.json에 항목 추가됨 |
| L-2 | `~/.antigravity-cli/accounts/{id}.json`에 `refresh_token`, `email`, `name` 저장됨 | **도구**: `cat` + `jq`. **절차**: 1) `agcl auth login` → 브라우저 로그인 완료. 2) `cat ~/.antigravity-cli/accounts.json | jq '.accounts[0].id'` → 계정 ID 획득. 3) `cat ~/.antigravity-cli/accounts/{id}.json | jq '.token.refresh_token'` → null 아닌 문자열 확인. 4) `jq '.email'` → 로그인한 email 확인. 5) `jq '.name'` → 사용자 이름 확인. **기대**: refresh_token, email, name 모두 non-null |
| L-3 | `accounts.json` 인덱스에 항목 추가됨, `current_account_id` 갱신됨 | **도구**: `cat` + `jq`. **절차**: 1) `agcl auth login` 완료. 2) `cat ~/.antigravity-cli/accounts.json | jq '.accounts | length'` → 1 이상 확인. 3) `jq '.current_account_id'` → 방금 로그인한 계정의 ID와 일치 확인. **기대**: 인덱스에 항목 추가, current_account_id가 새 계정 ID와 일치 |
| L-4 | 10분 timeout 시 "Login timed out" 메시지 출력, exit code 1 | **도구**: `bun test` + mock timer. **절차**: 1) 테스트에서 OAuth callback server를 시작하되 브라우저 열지 않음 (mock). 2) `setTimeout`을 10분으로 고정 (테스트에서는 100ms로 단축). 3) timeout 발생 후 stderr에 "Login timed out" 포함 확인. 4) exit code 1 확인. **기대**: timeout 메시지 + exit code 1 |
| L-5 | state 불일치 시 거부, 에러 메시지 출력 | **도구**: `bun test` + mock HTTP. **절차**: 1) OAuth callback server 시작 (state=random-uuid 생성). 2) 변조된 state로 `GET /oauth-callback?state=tampered&code=xxx` 요청 전송. 3) 서버 응답: 400 + "Invalid state parameter" 확인. 4) accounts.json에 새 항목 추가 안 됨 확인. **기대**: state 불일치 시 400 거부, 계정 생성 안 됨 |
| L-6 | 같은 email로 재로그인 시 기존 계정 upsert (중복 생성 안 함) | **도구**: `bun test` + mock. **절차**: 1) 첫 로그인 완료 → accounts.json에 1개 항목 (email: test@gmail.com). 2) 같은 email로 두 번째 로그인 (mock OAuth callback). 3) `cat ~/.antigravity-cli/accounts.json | jq '.accounts | length'` → 여전히 1 확인 (중복 생성 안 됨). 4) `jq '.accounts[0].token.refresh_token'` → 두 번째 로그인의 새 refresh_token으로 교체됨 확인. **기대**: 항목 수 변화 없음, 토큰만 갱신 |
| L-7 | 앱(Antigravity.app)이 설치 안 돼 있어도 로그인 성공 | **도구**: `bun test` + 환경 변수. **절차**: 1) 테스트에서 `resolveHeadlessBackendConfig`의 `appPath`를 존재하지 않는 경로로 오버라이드. 2) `agcl auth login` 실행 → 브라우저 OAuth 진행. 3) 로그인 완료 → accounts.json에 계정 생성 확인. 4) `ls /Applications/Antigravity.app` → 없음 (또는 mock) 확인. **기대**: 앱 없이도 OAuth 로그인 성공 |
| L-8 | Local Import로 기존 user-data-dir에서 토큰 추출 후 accounts.json에 등록. refresh_token 없으면 needs_reauth 상태로 저장 | **도구**: `bun test` + `cat` + `jq`. **절차**: 1) 테스트에서 `~/Library/Application Support/Antigravity/User/globalStorage/state.vscdb` fixture 생성 (uss-oauth topic bytes 포함, refresh_token 포함 버전과 미포함 버전 2가지). 2) refresh_token 포함 fixture에서 `importLocalFromStateDb_func()` 실행. 3) `cat ~/.antigravity-cli/accounts.json | jq '.accounts | length'` → 1 이상 확인. 4) `cat ~/.antigravity-cli/accounts/{id}.json | jq '.token.refresh_token'` → non-null 문자열 확인. 5) `jq '.account_status'` → "active" 확인. 6) refresh_token 미포함 fixture로 다시 실행. 7) `jq '.token.refresh_token'` → null 확인. 8) `jq '.account_status'` → "needs_reauth" 확인. **기대**: refresh_token 있으면 active, 없으면 needs_reauth 상태로 등록 |

---

## 5. Feature 2: auth list

### 5-1. Quota 조회 변경

| | 현재 | 변경 |
|---|---|---|
| 소스 | live LS → `GetUserStatus` RPC / persisted → `state.vscdb` 파싱 | Cloud Code REST API 직접 호출 |
| 캐시 | 없음 | 60초 TTL 로컬 캐시 (`~/.antigravity-cli/cache/quota/`) |
| 인증 | LS의 내장 토큰 | 계정별 `access_token` (필요 시 `refresh_token`으로 갱신) |

**quota 조회 흐름 (bounded parallel fetch):**

```
1. accounts.json에서 모든 계정 로드
2. 각 계정에 대해 캐시 확인:
   a. 60초 이내 캐시 있음 → 즉시 사용
   b. 캐시 없거나 stale → fetch 대상 큐에 추가
3. fetch 대상 계정들을 병렬 조회 (동시성 제한: 최대 4개):
   a. access_token 만료 확인 → 만료 임박(5분 이내)이면 refresh
   b. Cloud Code API 호출 (계정당 최대 3초 timeout):
      - loadCodeAssist → subscription_tier, project_id, credits
      - fetchAvailableModels → 모델별 remainingFraction, resetTime
   c. 계정별 결과:
      - 성공 → 캐시 기록 (60초 TTL)
      - timeout → stale 캐시 있으면 stale 사용, 없으면 "-" 표시
      - 403 → account_status = "forbidden" 전이
4. 전체 fetch 최대 벽시계 시간: ceil(계정수 / 4) × 3초
```

> **Non-Blocking 원칙**: quota fetch 실패/timeout이 현재 CLI 명령을 실패시키지 않는다.

### 5-2. 출력 형식

현재 `renderAuthListText_func`의 출력 형식 **유지**:
- email은 `@` 앞 ID만
- GEMINI / CLAUDE family 진도바
- TTY: alternate screen + 화살표 선택기
- non-TTY / --json: 텍스트/JSON 출력

### 5-3. 선택 후 Auth Inject

TTY에서 계정 선택 시 **즉시** inject (사용자가 명시적으로 선택한 것이므로):

```
0. 대상 계정의 account_status 확인:
   - "needs_reauth" → stderr에 "재로그인 필요: agcl auth login" 안내 후 중단
   - "forbidden"/"disabled" → stderr에 사유 안내 후 중단
1. 대상 계정의 refresh_token → access_token 갱신 (access_token이 5분 이내 만료 시에만 refresh. 유효한 토큰은 그대로 inject. quota fetch §5-1과 동일한 5분 정책)
2. accounts.json에서 current_account_id 갱신
3. state.vscdb inject:
   a. antigravityUnifiedStateSync.oauthToken
   b. jetskiStateSync.agentManagerInitState field 6 교체
   c. antigravityOnboarding = "true"
4. ~~serviceMachineId 교체~~ → Device Fingerprint 필요. v0.2.2에서 지원 (NOT NOW).
5. live LS 존재 여부 확인:
   a. live LS 있음 → "재시작 필요" 안내 (stderr). inject 자체는 완료됨.
   b. live LS 없음 → inject만 완료. 다음 앱 실행 시 반영.
```

> **Full Switch Default (§5-3, §6-5, §8-4 공통 계약)**:
> live LS가 있든 없든, inject는 `state.vscdb`에 쓴다. LS kill/respawn은 하지 않는다.
> live LS가 있으면 stderr에 "재시작 필요" 안내만 추가. inject 자체는 항상 완료.
> 미검증 행동은 하지 않는다. 이것이 Full Switch의 닫힌 기본 경로다.

### 5-4. 파일 변경

| 파일 | 변경 |
|------|------|
| `src/services/quotaClient.ts` | **신규**: Cloud Code REST API 호출, 캐시, UA/metadata 정렬 |
| `src/services/authInject.ts` | **신규**: state.vscdb inject (oauthToken, agentManagerInitState, onboarding) |
| `src/services/authList.ts` | quota 데이터 소스를 Cloud Code API로 교체 |
| `src/main.ts` | `handleAuthList_func`: persisted/live 분기 → Cloud Code API 분기로 교체 |

### 5-5. 성공 조건

| ID | 주장 | 증명 방법 |
|----|------|----------|
| A-1 | `agcl auth list`가 Cloud Code API에서 quota를 가져와 진도바 표시 | **도구**: `bun test` + mock server. **절차**: 1) quotaClient 테스트에서 Cloud Code API 응답을 mock (`loadCodeAssist` → `{subscription_tier: "PRO"}`, `fetchAvailableModels` → `{GEMINI: {remainingFraction: 0.45}}`). 2) `agcl auth list --json` 실행. 3) JSON 출력에서 `quota_cache.families.GEMINI.remaining_pct`가 45인지 확인. **기대 출력**: `{"accounts":[{"email":"...","quota_cache":{"families":{"GEMINI":{"remaining_pct":45}}}}]}` |
| A-2 | 60초 이내 재호출 시 캐시 사용 (네트워크 호출 없음) | **도구**: `bun test` + mock. **절차**: 1) quotaClient 테스트에서 HTTP fetch를 mock (호출 카운트 추적). 2) 첫 번째 `fetchQuota(accountId)` 호출 → HTTP fetch 1회 발생 확인. 3) 10초 후 두 번째 호출 → HTTP fetch 발생 안 함(카운트 그대로) 확인. 4) 61초 경과 후 세 번째 호출 → HTTP fetch 1회 추가 발생 확인. **기대**: 60초 이내 두 번째 호출에서 캐시 hit, HTTP 요청 없음 |
| A-3 | 403 수신 시 해당 계정 `account_status → "forbidden"` 전이 + 자동 rotate 배정에서 즉시 제외 | **도구**: `bun test` + mock. **절차**: 1) 계정 fixture 생성 (account_status="active"). 2) quotaClient mock → Cloud Code API가 403 반환. 3) `fetchQuota(accountId)` 실행 → 403 처리 로직 트리거. 4) `cat ~/.antigravity-cli/accounts/{id}.json | jq '.account_status'` → "forbidden" 확인. 5) `jq '.account_status_reason'` → "api_403" 확인. 6) rotate 대상 탐색에서 해당 계정 제외됨 확인. **기대**: 403 → forbidden 전이 → rotate/wake-up 대상에서 즉시 제외 |
| A-4 | TTY에서 계정 선택 → state.vscdb에 3개 키 inject 성공 | **도구**: `bun test` + `sqlite3`. **절차**: 1) 테스트에서 TTY 환경 mock + 계정 B 선택 시뮬레이션. 2) `authInject_func({accountId: B, stateDbPath})` 실행. 3) `sqlite3 <stateDbPath> "SELECT length(value) FROM ItemTable WHERE key='antigravityUnifiedStateSync.oauthToken'"` → 0보다 큰 값 확인. 4) `SELECT length(value) WHERE key='antigravityUnifiedStateSync.oauthToken'` → inject 전후로 값 변경 확인. 5) `SELECT value WHERE key='antigravityOnboarding'` → "true" 확인. **기대**: 3개 키(oauthToken, agentManagerInitState field 6, onboarding) 모두 값 교체됨 |
| A-7 | non-TTY/--json에서 순수 출력만 (inject 안 함) | **도구**: `bun test`. **절차**: 1) 테스트에서 `process.stdout.isTTY = false` 설정. 2) `agcl auth list --json` 실행. 3) JSON 출력에 계정 목록 포함 확인. 4) authInject 호출 spy → 호출 0회 확인 (inject 발생 안 함). 5) `cat ~/.antigravity-cli/accounts.json | jq '.current_account_id'` → 변경 없음 확인. **기대**: --json에서 inject 로그 없음, current_account_id 변경 없음 |

---

## 6. Feature 3: Auto-Rotate

### 6-1. 정책: Sticky-Threshold Rotation

같은 계정을 **계속 쓰다가** threshold를 밑돌 때만 바꾼다. 매 명령마다 최고 quota 계정으로 갈아타지 않는다. 프롬프트 캐싱은 같은 계정 연속 사용 시 효과적이기 때문.

### 6-2. 트리거 조건

> **메시지 전송 경로**에서만 (`prompt 전송`, `resume send`). 읽기 전용 명령 제외.

```
antigravity-cli "메시지"         → quota 조회 + rotate 판정 + pending-switch 적용
antigravity-cli -r <id> "메시지" → quota 조회 + rotate 판정 + pending-switch 적용
antigravity-cli -h               → rotate 안 함, pending-switch 적용 안 함
antigravity-cli -r               → rotate 안 함, pending-switch 적용 안 함
antigravity-cli auth list        → rotate 안 함, pending-switch 적용 안 함
```

### 6-3. Rotate 규칙

| Tier | Threshold Buckets | 동작 |
|------|-------------------|------|
| **Ultra** | 70% → 40% → 10% | bucket 경계를 **처음** 밑돌 때 rotate |
| **Pro** | 70% → 20% | 20% 미만: **사용 금지** (`account_status → "protected"`) |
| **Free** | 0% | 소진 시 전환 |

**기준 값 (effective family 우선, min fallback):**

```
1. CLI의 최종 resolved model family를 알 수 있으면:
   → 해당 family의 remaining%만 기준
2. family를 알 수 없으면:
   → min(GEMINI remaining%, CLAUDE remaining%) fallback
```

### 6-4. Threshold Deduplication (`last_rotation_bucket`)

같은 bucket에서 반복 rotate하지 않도록 계정별·family별 `last_rotation_bucket` 저장.

```
rotation 판정 로직:
  effective_family = resolve_model_family(args, config)
  if effective_family:
    current_remaining = family_remaining[effective_family]
    bucket_key = effective_family
  else:
    current_remaining = min(GEMINI%, CLAUDE%)
    bucket_key = "_min"

  current_bucket = threshold_bucket(current_remaining, tier)
  stored_bucket = account.rotation.family_buckets[bucket_key]

  if current_bucket == stored_bucket:
    → rotate하지 않음 (이미 이 구간에서 rotate 했음)
  elif current_bucket == none:
    → rotate 불필요
  else:
    → rotate 예약
    → account.rotation.family_buckets[bucket_key] = current_bucket 저장
```

> **리셋**: quota가 90% 이상으로 회복되면 `last_rotation_bucket = none`으로 초기화.

### 6-5. 실행 타이밍 + Pending Switch 영속화

```
[CLI 시작 — 메시지 전송 경로만]
  → pending-switch.json 확인:
     - 메시지 전송 경로 → pending intent 적용 (auth inject) → 파일 삭제
     - 읽기 전용 명령 → 무시, 파일 건드리지 않음
  → config 로드
  → Cloud Code API로 현재 계정 quota 조회
  → effective family 판정
  → rotate 판정 (sticky-threshold + family-aware bucket)
  → 현재 작업 실행 (작업 중에는 절대 계정을 바꾸지 않음)
   → 작업 완료 후:
      - rotate 예약됨 → auth inject (Full Switch 경로, §5-3과 동일 계약: state.vscdb 쓰기만, LS kill/respawn 없음)
      - inject 성공 → pending-switch.json 삭제
      - inject 실패/CLI 비정상 종료 → pending-switch.json 유지
```

**`pending-switch.json` 구조:**

```json
{
  "target_account_id": "acc_uuid_002",
  "reason": "Ultra threshold 70% crossed (current: 68%)",
  "decided_at": 1712345678,
  "source_account_id": "acc_uuid_001"
}
```

> **Stale intent 폐기**: `decided_at`이 24시간 이상 경과한 intent는 무시하고 삭제.
> **Stale check timing**: pending-switch.json의 stale 판정은 CLI 시작 시 첫 번째 확인 단계에서 즉시 수행된다. stale이면 rotate 판정에 들어가기 전에 파일을 삭제하고, rotate를 건너뛴다.

### 6-6. Rotate 대상 선택

```
1. 현재 계정 제외
2. status == "forbidden" 계정 제외
3. status == "disabled" 계정 제외
4. status == "needs_reauth" 계정 제외 (refresh_token 없음, 재로그인 필요)
5. Pro remaining < 20% 계정 제외 (status == "protected")
6. 남은 계정 중 effective family의 remaining% 가장 높은 계정 선택
7. 동률이면 last_used가 가장 오래된 계정 우선 (spread 효과)
```

### 6-7. 성공 조건

| ID | 주장 | 증명 방법 |
|----|------|----------|
| R-1 | Ultra 계정: remaining이 70% bucket을 처음 밑돌면 rotate 예약 → 작업 후 inject | **도구**: `bun test` + mock quota. **절차**: 1) Ultra 계정 fixture 생성 + quota mock remaining_pct=65 (70% bucket 밑돌). 2) `rotate_func()` 실행. 3) `cat ~/.antigravity-cli/accounts/{id}.json | jq '.rotation.family_buckets.GEMINI'` → "70" 확인 (bucket 기록). 4) inject 후 `sqlite3 <state.vscdb> "SELECT length(value) FROM ItemTable WHERE key='antigravityUnifiedStateSync.oauthToken'"` → 새 계정 토큰으로 교체 확인. **기대**: rotate 예약 → 작업 후 state.vscdb에 새 계정 토큰 inject |
| R-2 | 같은 bucket(예: 65%)에서 반복 실행 시 추가 rotate 안 함 | **도구**: `bun test` + mock quota. **절차**: 1) Ultra 계정 fixture 생성 + `rotation.family_buckets.GEMINI = "70"` 이미 설정. 2) quota mock remaining_pct=65 (여전히 70% bucket 안). 3) `rotate_func()` 실행. 4) `cat ~/.antigravity-cli/accounts/{id}.json | jq '.rotation.family_buckets.GEMINI'` → 여전히 "70" (변화 없음). 5) pending-switch.json 생성 안 됨 확인. **기대**: family_buckets 값 변화 없음, rotate 발생 안 함 |
| R-3 | Pro 계정: remaining 20% 미만 시 protected 전이 → rotate 대상에서 제외 | **도구**: `bun test` + mock quota. **절차**: 1) Pro 계정 fixture 생성 + quota mock remaining_pct=15. 2) `rotate_func()` 실행 (대상 계정 탐색). 3) 해당 계정의 `account_status` → "protected" 전이 확인. 4) rotate 대상 목록에 해당 계정 포함 안 됨 확인. 5) `cat ~/.antigravity-cli/accounts/{id}.json | jq '.account_status'` → "protected" 확인. **기대**: 20% 미만 시 protected 전이, rotate 대상에서 제외 |
| R-4 | `antigravity-cli -h`에서는 rotate 안 함 | **도구**: `bun test`. **절차**: 1) `parseArgv_func(['-h'])` 결과 → command_type = "help" 확인. 2) `shouldEvaluateRotation_func(command_type)` → false 확인. 3) `ls ~/.antigravity-cli/runtime/pending-switch.json` → 파일 없음 (또는 기존 파일 변경 없음). **기대**: -h 실행 시 rotate 평가 자체가 수행되지 않음, pending-switch.json 없음 |
| R-5 | 모든 계정 소진 시 경고 메시지 출력, 현재 계정으로 계속 진행 | **도구**: `bun test` + mock. **절차**: 1) 모든 계정의 quota를 mock으로 remaining_pct=0으로 설정. 2) `agcl "hello"` 실행. 3) stderr에 `[quota exhausted]` 경고 포함 확인. 4) exit code 0 확인 (메시지는 정상 전송됨). **기대**: stderr에 "All accounts exhausted, using current account" 메시지 + 메시지 전송 성공 |
| R-6 | CLI가 rotate 판정 후 inject 전에 죽음 → pending-switch.json 남음 → 다음 실행에서 적용 | **도구**: `bun test` + mock + process kill. **절차**: 1) rotate 판정 트리거 (quota mock 65%). 2) `pending-switch.json` 파일 생성 직후 `process.kill(process.pid, 'SIGKILL')` 로 강제 종료 (테스트 코드). 3) `cat ~/.antigravity-cli/runtime/pending-switch.json` → 파일 존재 + 올바른 target_account_id 확인. 4) 새 프로세스에서 `agcl "continue"` 실행 → pending-switch 감지 → inject 수행 → 파일 삭제 확인. **기대**: 강제 종료 후 파일 유지, 재실행 시 inject 완료 후 파일 삭제 |

---

## 7. Feature 4: Wake-up

### 7-1. 대상

> quota API 응답에서 **모든 family의 `remainingFraction`이 null 또는 미존재**인 계정.
> 즉, 한 번도 LS 실행으로 리셋 사이클이 시작되지 않은 "잠든" 계정.

**null 판정 disambiguation:**

| API 응답 상태 | 판정 | 처리 |
|--------------|------|------|
| 정상 응답 + 모든 family의 remaining == null | 잠든 계정 | wake-up 대상 |
| 정상 응답 + 일부 family만 null | 부분 활성 | wake-up 대상 아님 |
| API 에러 (timeout, network) | 판정 불가 | wake-up 대상 아님 |
| API 403 | forbidden | status → "forbidden" 전이 |

### 7-2. Per-Account Cooldown

- 성공 후: 다음 wake-up 불필요
- 실패(timeout/error) 후: **30분** cooldown
- forbidden 후: status → "forbidden" 전이 → 영구 제외

### 7-3. 실행 흐름

> **대상 범위**: accounts.json에 등록된 **모든 계정**을 순회한다. "active 계정만"이 아니라,
> forbidden/disabled가 아닌 모든 계정이 대상이다. cooldown 중인 계정(30분 이내 실패)도 제외한다.
> null-quota 여부로 wake-up 필요성을 판정한다.
> 즉, `account_status == "active"`이더라도 quota가 이미 있으면 skip하고,
> `account_status`가 없는 신규 계정도 null-quota면 wake-up 대상이다.
>
> **current_account_id side effect**: wake-up은 5a 단계에서 current_account_id를
> wake-up 대상 계정으로 임시 변경한다. wake-up 완료 후 원래 active 계정으로 복원한다.

```
1. accounts.json에서 모든 계정 로드
   - 제외: account_status == "forbidden" 또는 "disabled" 또는 "needs_reauth"
   - 제외: cooldown 중 (30분 이내 실패)
2. 각 계정에 Cloud Code quota 조회 (bounded fetch)
3. 필터: 모든 family의 remainingFraction이 null인 계정만 wake-up 대상
   - 일부 family만 null → skip (부분 활성)
   - 정상 응답 + remaining 존재 → skip (이미 활성)
4. 대상 계정이 없으면 종료 ("모든 계정 이미 활성")
5. 각 대상 계정에 대해:
   a. auth inject → state.vscdb (§5-3과 동일한 inject payload: oauthToken, agentManagerInitState, onboarding)
   b. offline LS spawn
   c. StartCascade → SendUserCascadeMessage (최소 메시지 "." 1턴)
   d. 응답 대기 (최대 60초)
   e. LS 종료
   f. 결과 기록:
      - 성공 → wakeup_history 갱신
      - 403 → "forbidden" 전이
      - timeout → cooldown 시작
6. 완료 보고
```

### 7-4. 성공 조건

| ID | 주장 | 증명 방법 |
|----|------|----------|
| W-1 | null-quota 계정에 대해 LS spawn → 1턴 실행 → 종료 | **도구**: `bun test` + mock LS + mock authInject. **절차**: 1) 테스트에서 null-quota 계정 fixture 생성 (모든 family remainingFraction=null). 2) `wakeup_func()` 실행. 3) authInject spy 확인 → 호출 1회 + 인자에 올바른 access_token 포함 확인. 4) LS spawn 호출 확인 (spawn 인자에 올바른 metadata). 5) StartCascade + SendUserCascadeMessage 호출 확인. 6) 응답 수신 후 LS 종료 확인. 7) `cat ~/.antigravity-cli/accounts/{id}.json | jq '.wakeup_history.last_result'` → "success" 확인. **기대**: auth inject → LS spawn → 1턴 → 종료 로그가 순서대로 출력됨 |
| W-2 | 403 수신 시 해당 계정 "forbidden" 전이 | **도구**: `bun test` + mock. **절차**: 1) 계정 fixture 생성 (null-quota). 2) mock LS에서 StartCascade → 403 응답 반환 설정. 3) `wakeup_func()` 실행. 4) 403 수신 후 `cat ~/.antigravity-cli/accounts/{id}.json | jq '.account_status'` → "forbidden" 확인. 5) `jq '.account_status_reason'` → "api_403" 또는 유사 사유 확인. 6) 이후 rotate 대상에서 제외됨 확인. **기대**: 403 수신 → "forbidden" 전이 → 영구 제외 |
| W-3 | 이미 quota가 있는 계정은 skip | **도구**: `bun test` + mock. **절차**: 1) 계정 fixture 생성 (quota_cache.families.GEMINI.remaining_pct=50, 이미 활성). 2) `wakeup_func()` 실행. 3) 해당 계정에 대해 LS spawn이 시도되지 않음 확인 (null-quota 필터에서 제외). 4) 로그에 "skip: quota exists" 메시지 확인. **기대**: quota 있는 계정은 wake-up 대상에서 제외됨 |
| W-4 | 30분 이내 재실행 시 이전 실패 계정은 cooldown으로 skip | **도구**: `bun test` + mock. **절차**: 1) 테스트에서 wakeup_history가 `{last_result: "timeout", last_attempt_at: Date.now() - 60000}` (1분 전)인 계정 fixture 생성. 2) `wakeup_func()` 실행. 3) 해당 계정에 대해 LS spawn이 시도되지 않음 확인 (cooldown 필터링). 4) 31분 경과 후 재실행 → 해당 계정이 다시 대상에 포함됨 확인. **기대**: 30분 이내에는 cooldown으로 skip, 30분 경과 후에는 대상 포함 |
| W-5 | wake-up 완료 후 quota 재조회 → remainingFraction 존재 | **도구**: `bun test` + mock. **절차**: 1) null-quota 계정 fixture 생성. 2) `wakeup_func()` 실행 → 성공 (wakeup_history.last_result="success"). 3) `quotaClient.fetchQuota(accountId)` 재호출 → mock 응답 변경: `{GEMINI: {remaining_pct: 100}, CLAUDE: {remaining_pct: 100}}`. 4) `cat ~/.antigravity-cli/accounts/{id}.json | jq '.quota_cache.families.GEMINI.remaining_pct'` → null이 아닌 숫자 확인. **기대**: wake-up 성공 후 quota 재조회 시 remainingFraction 존재 |

---

## 8. Feature 5: Seamless Switch (Experimental)

### 8-1. 배경

Cockpit의 Full Switch = "앱을 띄워야 하니까 앱 재시작". 우리는 CLI가 백그라운드에서 LS만 띄움 (UI 없음). **주인님 통찰: "백그라운드라 더 쉬울 것"**

### 8-2. 조사 결과 (2026-04-15)

**핵심 발견**: IDE는 auth가 바뀌어도 LS를 재시작하지 않는다.

`handleAuthSessionChange` (extension L44870):
1. `MetadataProvider.updateApiKey(newToken)` — 내부 metadata만 업데이트
2. `client.getStatus({ metadata })` — 기존 LS 연결에 새 metadata
3. `client.getProfileData({ apiKey: newToken })` — 기존 LS에 새 apiKey

→ LS 프로세스는 계속 살아 있고, **기존 ConnectRPC 연결에 새 apiKey를 담아 요청**하는 것만으로 auth 전달.

### 8-3. 가능한 경로 3가지

| 경로 | 방식 | 확실성 | 속도 |
|------|------|--------|------|
| **A. Kill → Respawn** | LS 종료 → 새 토큰으로 재시작 | ✅ 확실 | 2~5초 |
| **B. 기존 LS에 새 apiKey RPC** | getStatus/getProfileData에 새 apiKey | 🟡 실험 필요 | <100ms |
| **C. USS re-push** | SubscribeToUnifiedStateSyncTopic에 새 bytes | 🔴 불확실 | 미정 |

### 8-4. Spec에서의 위치

> **Full Switch 기본 정의 (모든 Feature에서 동일한 계약)**:
> Full Switch = "`state.vscdb`에 auth 키만 쓴다. LS 재시작은 하지 않는다."
> 이 계약은 §5-3(auth list 선택), §6-5(auto-rotate), §8-4(Seamless) 모두에서 동일하다.
> live LS가 있으면 stderr에 "재시작 필요" 안내만 추가한다. inject 자체는 항상 완료된다.
>
> **예외**: Wake-up(§7)은 동일한 inject payload를 재사용하지만, 1턴 실행을 위해 별도 LS를 spawn하는 독자적 실행 흐름을 가진다. 이것은 "Full Switch"가 아니라 "wake-up 전용 경로"다.

- **기본 경로 (Full Switch)**: `state.vscdb`에 auth 키 3개(oauthToken, agentManagerInitState, onboarding)를 쓴다. LS kill/respawn은 **하지 않는다**. §5-3, §6-5와 동일한 계약.
- **실험 경로 A (Seamless 전용)**: LS kill → 새 토큰으로 respawn. `terminateChild_func()` 이미 구현됨. 실험 성공 시 Full Switch를 대체하는 **승격 경로**. 단, 이것은 Seamless Feature(§8) 내부에서만 수행되며, auth list 선택이나 auto-rotate에서는 수행하지 않는다.
- **실험 경로 B (Seamless 전용)**: 기존 LS에 새 apiKey로 RPC (`getStatus`/`getProfileData`). <100ms. 실험 성공 시 경로 A보다 우선 승격.
- **경로 C는 NOT NOW**: 불확실성 높음.
- **Live Attach 경로**: IDE가 이미 떠 있으면 IDE의 LS를 그대로 쓰므로 CLI는 auth inject만 하면 됨.

### 8-5. 성공 조건 (실험)

| ID | 주장 | 증명 방법 |
|----|------|----------|
| SS-1 | 경로 A: LS kill → respawn 후 새 토큰으로 정상 작동 | **도구**: 수동 E2E + `agcl`. **절차**: 1) 계정 A로 `agcl "hello"` 실행 → LS spawn + 대화 완료. 2) `terminateChild_func()` 로 LS kill (또는 자연 종료 대기). 3) 계정 B로 전환 (auth list 선택 → inject). 4) `agcl "test from account B"` 실행 → 새 LS spawn + 계정 B 토큰으로 metadata 생성. 5) 응답 수신 확인. **기대**: kill → respawn 후 새 토큰으로 정상 대화 |
| SS-2 | 경로 B: 기존 LS에 새 apiKey로 RPC → LS가 새 토큰 인식 | **도구**: `bun test` + live LS. **절차**: 1) 계정 A로 offline LS spawn (runOfflineSession_func). 2) 계정 B의 access_token 획득. 3) 기존 LS 연결에 `client.getStatus({metadata: {apiKey: account_B_token}})` RPC 전송. 4) 응답에서 계정 B의 user identity 확인. **기대**: getStatus 응답에 계정 B의 email 또는 user ID 포함. 실패 시 "LS rejected new token" 로그 |
| SS-3 | 대화 공유: 계정 전환 후 기존 cascadeId로 resume 시도 → 성공 또는 서버 거부 | **도구**: 수동 E2E + `agcl`. **절차**: 1) 계정 A로 `agcl "hello"` 실행 → cascadeId 기록. 2) 계정 B로 전환 (auth list 선택 → inject). 3) `agcl -r <cascadeId> "continue from B"` 실행. 4) 결과 확인: 성공(응답 수신) 또는 서버 거부(에러 메시지). **기대**: 서버가 cascadeId의 소유권을 검증 → 성공 또는 명확한 거부 에러 |

---

## 9. Account Store 스키마

> **주의**: GPT spec의 `version: "2.0"` 스키마(disabled boolean + is_forbidden boolean + flat model array)는 **폐기**되었다. 이 문서의 스키마(Opus 기반 v1.0, 5-state enum + family-aggregated quota)만이 유효한 계약이다. 구현자는 GPT spec의 스키마를 참조하지 말 것.
>
> **Account ID**: UUID v4. 계정 생성 시 생성. 불변. 중복 판정은 email (case-insensitive) 기준.
>
> **파일 권한**: accounts/ 디렉토리와 그 하위 파일은 반드시 mode `0600` (소유자만 읽기/쓰기)으로 생성한다. 토큰이 평문으로 저장되므로 필수.
>
> **저장소 무결성**:
> - 읽기: detail 파일 누락 시 `(err)` 표시. index는 계속 동작.
> - 쓰기: `.tmp` 파일에 write 후 rename (atomic write).
> - index 손상: 백업 보관 + 에러 로그 + 빈 store로 처리 (재로그인 필요).
>
> **단일 인스턴스 가정**: pending-switch.json은 CLI 단일 인스턴스를 가정한다. 동시 CLI 인스턴스는 v0.2.1에서 지원하지 않는다.
>
> **마이그레이션 안전**: 기존 `auth.json`은 첫 마이그레이션 시 `auth.json.v0.2.0.bak`로 보존한다. 롤백 = 이 파일 복원.

### 9-1. `~/.antigravity-cli/accounts.json` (인덱스)

```json
{
  "version": "1.0",
  "current_account_id": "acc_uuid_001",
  "accounts": [
    {
      "id": "acc_uuid_001",
      "email": "user@gmail.com",
      "name": "User",
      "created_at": 1712000000,
      "last_used": 1712340000
    }
  ]
}
```

### 9-2. `~/.antigravity-cli/accounts/{id}.json` (상세)

**계정 상태 모델 (5-state):**

| `account_status` | 의미 | 비유 | 자동 배정 | wake-up |
|------------------|------|------|----------|---------|
| `"active"` | 정상 사용 가능 | 건강한 직원 | ✅ | 조건부 |
| `"protected"` | Pro remaining < 20% | 과로 직원 | ❌ | ❌ |
| `"forbidden"` | API 403 수신 | 해고된 직원 | ❌ | ❌ |
| `"disabled"` | 수동 비활성화 | 휴직 직원 | ❌ | ❌ |
| `"needs_reauth"` | refresh_token 없음 (Local Import 불완전) | 출입증 만료 | ❌ | ❌ |

```json
{
  "id": "acc_uuid_001",
  "email": "user@gmail.com",
  "name": "User",
  "account_status": "active",
  "account_status_reason": null,
  "account_status_changed_at": null,
  "token": {
    "access_token": "ya29.xxx",
    "refresh_token": "1//xxx",
    "expires_in": 3600,
    "expiry_timestamp": 1712345678,
    "token_type": "Bearer",
    "project_id": null
  },
  "fingerprint_id": "original", // NOT NOW: 항상 "original". v0.2.2 fingerprint 지원 전까지 변경 없음
  "quota_cache": {
    "subscription_tier": "PRO",
    "families": {
      "GEMINI": {
        "remaining_pct": 45,
        "reset_time": "2026-04-14T14:00:00Z",
        "models": []
      },
      "CLAUDE": {
        "remaining_pct": 0,
        "reset_time": "2026-04-14T16:30:00Z",
        "models": []
      }
    },
    "fetch_error": null,
    "cached_at": 1712340000
  },
  "rotation": {
    "family_buckets": {
      "GEMINI": null,
      "CLAUDE": "70",
      "_min": "70"
    },
    "last_rotated_at": 1712340000
  },
  "wakeup_history": {
    "last_attempt_at": null,
    "last_result": null,
    "attempt_count": 0
  },
  "created_at": 1712000000,
  "last_used": 1712340000
}
```

### 9-3. 런타임 상태

```
~/.antigravity-cli/runtime/
  pending-switch.json     ← rotate intent 영속화
```

ephemeral. 적용 완료되면 삭제. 24시간 이상 경과한 stale intent도 삭제.

### 9-4. API 캐시

```
~/.antigravity-cli/cache/quota/{account_id}.json
```

60초 TTL. GPT spec의 `quota_api_v1_desktop/` 경로는 사용하지 않는다.

### 9-5. 마이그레이션

- 기존 `user-data/user-*` → Local Import로 자동 추출
- `auth.json.version` (integer, 예: `1`) → `accounts.json.version` (string, 예: `"1.0"`). 타입 변경 의도적.
- 실패 시 경고 메시지 + 기존 방식 유지 (중단 없음)
- 기존 user-data-dir은 삭제하지 않음

---

## 10. 성공 조건 (주장 + 증명)

### 10-1. 전체 E2E

| ID | 시나리오 | 성공 기준 |
|----|---------|----------|
| E2E-1 | 앱 없이 `auth login` → 계정 등록 → `auth list`에 표시 | **도구**: 수동 E2E + `agcl auth list --json`. **절차**: 1) `/Applications/Antigravity.app` 없는 환경(또는 PATH에서 제외). 2) `agcl auth login` → 브라우저 로그인 완료. 3) `agcl auth list --json` → 등록된 계정 email 확인. **기대**: 앱 없이 브라우저만으로 계정 획득, auth list에 표시 |
| E2E-2 | 2개 계정 등록 → `auth list`에서 2번째 선택 → state.vscdb inject → 앱 재시작 시 2번째 계정 | **도구**: 수동 E2E + `sqlite3`. **절차**: 1) 계정 2개 등록 (auth login 2회). 2) `agcl auth list` → 화살표로 2번째 계정 선택. 3) `sqlite3 ~/Library/Application\ Support/Antigravity/User/globalStorage/state.vscdb "SELECT length(value) FROM ItemTable WHERE key='antigravityUnifiedStateSync.oauthToken'"` → 값 존재 확인. 4) Antigravity 앱 재시작 → UI에 2번째 계정 email 표시 확인. **기대**: Account Overlay 동작, 앱이 2번째 계정으로 로그인 |
| E2E-3 | Ultra remaining 73% → 작업 사용 → 65%로 하락 → 70% boundary 첫 crossing → rotate inject | **도구**: `bun test` + `quotaClient` mock (환경변수 오버라이드). **절차**: 1) 2개 Ultra 계정 fixture 생성 (`tests/fixtures/two-ultra-accounts.json`). 2) `QUOTA_MOCK_DIR=tests/fixtures/quota-mocks` 환경변수 설정 → `quotaClient`가 mock 파일에서 quota 읽음. 3) 계정 A mock: `tests/fixtures/quota-mocks/{acc_A_id}.json` → `{families: {GEMINI: {remaining_pct: 73}, CLAUDE: {remaining_pct: 73}}}`. 4) `bun test tests/e2e/rotate-boundary.test.ts` 실행 → rotate 판정 없음 확인 (73% > 70% threshold). 5) mock 파일 수정: remaining_pct → 65. 6) 테스트 재실행 → rotate 판정 트리거 확인 + pending-switch.json 생성 또는 즉시 inject 확인. **기대**: 70% boundary crossing 감지 → rotate 예약/inject 수행, `family_buckets`에 "70" 기록 |
| E2E-4 | null-quota 계정 → wake-up → remaining 존재 | **도구**: 수동 E2E + `bun test` 내부 wake-up 호출. **절차**: 1) 신규 계정 등록 (아직 LS 실행 이력 없음). 2) `agcl auth list --json` → 해당 계정의 remaining_pct가 null 확인. 3) `agcl "hello"` 실행 (메시지 전송 경로). 이때 내부적으로 null-quota 감지 → wake-up 자동 트리거 (1턴 실행). 4) `agcl auth list --json` → remaining_pct가 숫자로 표시됨 확인. **기대**: 메시지 전송 경로에서 null-quota 자동 감지 → wake-up 1턴 → 이후 quota 존재 |
| E2E-5 | rotate 판정 후 CLI 강제 종료 → 재실행 → pending-switch 복원 → inject | **도구**: 수동 E2E + `cat` + `kill`. **절차**: 1) rotate 판정이 트리거되도록 설정 (quota 70% 밑돌). 2) `agcl "hello"` 실행 후 rotate 판정 완료 시점에 `kill -9`로 강제 종료. 3) `cat ~/.antigravity-cli/runtime/pending-switch.json` → 파일 존재 확인. 4) `agcl "resume"` 실행 → pending-switch 적용 + 파일 삭제 확인. **기대**: 강제 종료 후에도 pending-switch.json 유지, 재실행 시 inject 완료 후 파일 삭제 |

### 10-2. 비기능

| ID | 주장 | 증명 방법 |
|----|------|----------|
| NF-1 | `auth login` 전체 과정 < 30초 (브라우저 시간 제외) | **도구**: `bun test` + `performance.now()`. **절차**: 1) 테스트에서 OAuth callback을 mock (브라우저 시간 제외). 2) `authLogin_func()` 시작 시 `t0 = performance.now()`. 3) 완료 시 `t1 = performance.now()`. 4) `t1 - t0 < 30000` 어서션. **기대**: 서버 측 처리 < 30초 |
| NF-2 | quota 조회 (캐시 miss) < 3초 | **도구**: `bun test` + `performance.now()`. **절차**: 1) 캐시 비움 (`rm -rf ~/.antigravity-cli/cache/quota/`). 2) `t0 = performance.now()`. 3) `quotaClient.fetchQuota(accountId)` 실행 (실제 HTTP). 4) `t1 = performance.now()`. 5) `t1 - t0 < 3000` 어서션. **기대**: 캐시 miss 시 3초 이내 |
| NF-3 | quota 조회 (캐시 hit) < 10ms | **도구**: `bun test` + `performance.now()`. **절차**: 1) 캐시 warm-up: `quotaClient.fetchQuota(accountId)` 1회 실행. 2) `t0 = performance.now()`. 3) `quotaClient.fetchQuota(accountId)` 재실행. 4) `t1 = performance.now()`. 5) `t1 - t0 < 10` 어서션. **기대**: 캐시 hit 시 10ms 이내 |
| NF-4 | auth inject (state.vscdb 쓰기) < 500ms | **도구**: `bun test` + `performance.now()`. **절차**: 1) 계정 fixture + state.vscdb fixture 준비. 2) `t0 = performance.now()`. 3) `authInject_func({accountId, stateDbPath})` 실행. 4) `t1 = performance.now()`. 5) `t1 - t0 < 500` 어서션. **기대**: 3키 inject 500ms 이내 |
| NF-5 | quota fetch timeout/실패가 현재 명령 block 안 함 | **도구**: `bun test` + mock + `performance.now()`. **절차**: 1) quotaClient mock → 항상 3초 timeout (네트워크 지연 시뮬레이션). 2) `t0 = performance.now()`. 3) `agcl "hello"` 실행 (메시지 전송 경로). 4) 메시지 전송이 quota fetch 완료를 기다리지 않고 병렬 진행됨 확인. 5) stderr에 `[quota fetch timed out]` 포함 확인. 6) stdout에 정상 응답(메시지 전송 결과) 포함 확인. 7) exit code 0 확인. 8) `t1 = performance.now()` → 전체 실행 시간이 quota timeout(3초)에 종속되지 않음 확인. **기대**: quota 실패해도 메시지 전송은 성공, exit code 0, 전체 시간 quota에 종속 안 됨 |

### 10-3. 안전성

| ID | 주장 | 증명 방법 |
|----|------|----------|
| S-1 | 프로필 전체 복제 없음 | **도구**: `ls -la` + `diff`. **절차**: 1) 계정 A에서 계정 B로 전환 (auth list 선택). 2) `ls -la ~/Library/Application\ Support/Antigravity/User/globalStorage/` → inject 전후 동일한 파일 목록 확인. 3) `ls ~/.antigravity-cli/user-data/` → 새 user-data-dir 생성 안 됨 확인. **기대**: user-data 디렉토리 변화 없음, 오직 state.vscdb 내부 값만 변경 |
| S-2 | 계정 전환으로 기존 세션/대화/캐시 소실 안 됨 | **도구**: `sqlite3` + `diff`. **절차**: 1) 계정 A로 대화 1개 생성. 2) `sqlite3 ~/Library/Application\ Support/Antigravity/User/globalStorage/state.vscdb "SELECT length(value) FROM ItemTable WHERE key='antigravityUnifiedStateSync.trajectorySummaries'"` → 값 A 저장. 3) 계정 B로 전환 (auth inject). 4) 같은 쿼리 재실행 → 값 A와 동일 확인 (trajectorySummaries 보존). **기대**: inject 전후로 trajectorySummaries, sidebarWorkspaces 값 동일 |
| S-3 | 네트워크 실패가 현재 명령 망치지 않음 | **도구**: `bun test` + mock. **절차**: 1) 테스트에서 quotaClient.fetchQuota를 mock → 항상 timeout (3초). 2) `agcl "hello"` 실행 (메시지 전송 경로). 3) stderr에 `[quota fetch timed out]` 포함 확인. 4) stdout에 정상 응답(메시지 전송 결과) 포함 확인. 5) exit code 0 확인. **기대**: quota 실패해도 메시지 전송은 성공, exit code 0 |
| S-4 | 24시간 이상 stale intent는 무시하고 삭제 | **도구**: `bun test` + `cat`. **절차**: 1) `~/.antigravity-cli/runtime/pending-switch.json` 생성: `{decided_at: Date.now() - 86400000 - 1}` (24시간+1초 경과). 2) `agcl "hello"` 실행 (메시지 전송 경로). 3) pending-switch.json이 무시됨 확인 (rotate/inject 발생 안 함). 4) `cat ~/.antigravity-cli/runtime/pending-switch.json` → 파일 삭제됨 (또는 존재하지 않음) 확인. **기대**: stale intent 무시 + 파일 삭제 |

---

## 11. NOT NOW

| 항목 | 이유 |
|------|------|
| Seamless Switch (USS re-inject, 경로 C) | 검증 안 됨. Full Switch로 충분. 별도 조사 항목. |
| Device Fingerprint 자동 생성/교체 | v0.2.2+ |
| Background Daemon (자동 주기적 wake-up) | cron/launchd 연동은 v0.2.2+ |
| Plugin Sync | Cockpit 전용, 참고만 |
| Default 백업 (user-00) | Account Overlay로 불필요 |
| YAML 정책 엔진 | 하드코딩 규칙으로 시작 |
| multi-workspace | 단일 workspace 기준 |
| 독립 quota 명령 | auth list로 충분 |

---

## 12. 구현 순서

```
Phase 2-A: Account Store + OAuth Login
  1. accounts.ts 재작성 → Account Store 스키마 (5-state enum: active/protected/forbidden/disabled/needs_reauth)
  2. oauthClient.ts 신규 → Google OAuth flow
  3. authLogin.ts 재작성 → 브라우저 OAuth + Local Import
  4. 테스트: L-1 ~ L-8

Phase 2-B: Cloud Code Quota + Auth Inject
  5. quotaClient.ts 신규 → Cloud Code REST API (bounded parallel fetch)
  6. authInject.ts 신규 → state.vscdb inject (Full Switch 경로)
  7. authList.ts 수정 → quota 소스 교체
  8. main.ts 수정 → auth list 선택 후 inject
  9. 테스트: A-1 ~ A-7

Phase 2-C: Auto-Rotate
  10. main.ts 수정 → 메시지 전송 경로에 rotate hook + pending-switch
  11. 테스트: R-1 ~ R-6

Phase 2-D: Wake-up
  12. wakeup.ts 신규 (cooldown 포함)
  13. main.ts 수정 → wake-up 연동
  14. 테스트: W-1 ~ W-5

Phase 2-E: Seamless Switch (Experimental)
  15. 경로 B 실험 (기존 LS에 새 apiKey RPC)
  16. 성공 시 기본 경로로 승격, 실패 시 Full Switch 유지

Phase 2-F: E2E 검증
  17. E2E-1 ~ E2E-5 시나리오 수동 검증
  18. S-1 ~ S-4 안전성 검증
  19. NF-1 ~ NF-5 비기능 검증
```

---

## 13. 참조 맵

### 우리 코드

| 모듈 | 파일 | 역할 |
|------|------|------|
| Account Store | `src/services/accounts.ts` | 계정 발견/활성화 → 재작성 |
| Auth Login | `src/services/authLogin.ts` | 로그인 플로우 → 재작성 |
| Auth List | `src/services/authList.ts` | 목록 렌더링 → quota 소스 교체 |
| OAuth Client | `src/services/oauthClient.ts` | **신규**: Google OAuth |
| Quota Client | `src/services/quotaClient.ts` | **신규**: Cloud Code REST API |
| Auth Inject | `src/services/authInject.ts` | **신규**: state.vscdb inject |
| Wake-up | `src/services/wakeup.ts` | **신규**: 잠든 계정 활성화 |
| State DB | `src/services/stateVscdb.ts` | DB 읽기/쓰기 (inject에서 사용) |
| Fake Extension | `src/services/fakeExtensionServer.ts` | Offline LS 역방향 RPC |
| Main | `src/main.ts` | 오케스트레이션 |

### Cockpit Tools 참조

| 우리 모듈 | Cockpit 레퍼런스 | 핵심 참조 |
|-----------|-----------------|----------|
| `oauthClient.ts` | `oauth.rs` | client_id/secret (L3~4), scopes (L49~55), token exchange (L76~124), refresh (L127~155) |
| `quotaClient.ts` | `quota.rs` | base URL (L253~268), loadCodeAssist (L459~473), fetchAvailableModels (L998~1070), 캐시 (L327~371) |
| `authInject.ts` | `db.rs` | oauthToken (L107~137), agentManagerInitState field 6 (L42~103), onboarding (L95~100). serviceMachineId (L139~152)은 NOT NOW (v0.2.2+) |
| Account Store | `account.rs` | upsert, list, save 패턴 |
| Fingerprint (NOT NOW) | `fingerprint.rs` | FingerprintStore, generate/apply/bind |

### IDE 코드 참조

| 항목 | 위치 | 의미 |
|------|------|------|
| handleAuthSessionChange | `extension_formatted_latest.js` L44870 | IDE가 auth 변경 시 LS 재시작 안 함. 기존 연결에 새 apiKey만 전송 |
| subscribeToUnifiedStateSyncTopic | L100242 | USS 구독 = long-lived stream. initialState + 연속 업데이트 |
| pushUnifiedStateSyncUpdate | L100266 | LS→Extension push. extension은 이것을 로컬 저장소에 반영 |
| startLanguageServer | L80582 | LS spawn 방식: metadata stdin write + discovery file |
