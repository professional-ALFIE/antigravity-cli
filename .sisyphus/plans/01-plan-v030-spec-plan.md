# v0.3.0 Auth/Quota Orchestration — 통합 Spec + Implementation Plan

> **문서 성격**: `handoff-plan-spec/v0.3.0-01-handoff.md`를 기준으로 재구성한 **정식 spec + 구현 plan 통합 문서**
>
> **문서 목적**:
> - handoff의 핵심 주장과 원본맥락을 빠뜨리지 않는다.
> - v0.3.0에서 무엇을 제품 계약으로 고정할지 명확히 한다.
> - 구현팀이 이 문서만 보고도 바로 착수할 수 있도록 파일/모듈 단위 checklist를 제공한다.

---

## 1. TL;DR

- `auth refresh`는 **전체 quota 동기화** 명령으로 고정한다.
- `auth list`는 **계정 카드 기반 빠른 조회** 명령으로 고정하고, 오래되거나 불확실한 계정만 선택 갱신한다.
- 프롬프트 시작 시에는 **rotate를 선판단하지 않고 현재 계정으로 바로 실행**한다.
- 프롬프트 종료 후에는 **현재 계정 fresh quota 재조회 → pre/post 비교 → threshold crossing 판단 → 즉시 switch 기록** 순서로 처리한다.
- `wake-up`은 “매번 실행” 기능이 아니라, **5h usage cycle이 아직 시작되지 않은 계정의 타이머를 앞당기는 기능**으로 정의한다.
- `pending-switch.json`은 예약 메모가 아니라 **이미 적용된 switch의 안전한 기록 파일**로 정의한다.
- live attach / future Offline-Gateway가 있으면 **로컬 fast-path**를 우선 활용하되, 무엇을 신뢰할지는 source-priority 계약으로 고정한다.

---

## 2. 문서 범위

### 2-1. 이 문서가 고정하는 것

- v0.3.0 auth/quota/rotate/wake-up/pending-switch의 제품 정책
- 현재 코드에서 유지할 것 / 바꿀 것 / 새로 넣을 것
- 성공조건(제품 동작 기준 + 구현 검증 기준)
- 파일/모듈 단위 구현 checklist
- 이번 버전에서 **하지 않을 것(NOT NOW)**
- 과거 v0.2.x 문서를 직접 근거로 삼지 않고, `v0.3.0 handoff + 현재 코드`만을 근거로 삼는 기준

### 2-2. 이 문서가 하지 않는 것

- 실제 코드 구현
- `.sisyphus/` 밖 문서 직접 반영
- 릴리스 노트 작성

---

## 3. handoff에서 반드시 보존해야 하는 핵심 맥락

### 3-1. refresh 와 list 는 같은 명령이 아니다

- `auth refresh`는 **모든 계정 quota를 cloud에서 읽고 계정 카드를 최신화**하는 전체 갱신 명령이다.
- `auth list`는 **기본적으로 저장된 계정 카드**를 읽어 빠르게 보여주는 명령이다.
- 따라서 `auth list`가 느린 문제를 해결하는 핵심은, list에서 전체 네트워크 갱신을 떼어내고 `auth refresh`로 역할을 분리하는 것이다.

### 3-2. wake-up 은 “답변을 받기 위한 트릭”이 아니라 시간 관리 기능이다

- wake-up 대상은 **5h usage cycle이 아직 시작되지 않은 계정**이다.
- 즉 all-null quota, reset 정보 없음, 아직 실제 사용 시작 전인 계정을 미리 깨워 두는 기능이다.
- 이 기능의 목적은 “당장 이 턴의 응답”보다, **다음 계정의 5시간 타이머를 미리 돌려 대기 시간을 줄이는 것**이다.

### 3-3. rotate 는 프롬프트 시작 전에 하지 않는다

- `agcl "프롬프트"` 또는 `agcl -r <uuid> "프롬프트"` 시작 시점에는 rotate를 선판단하지 않는다.
- 이번 턴은 이미 정해진 current account로 바로 실행한다.
- 다만 background quick check 또는 다른 sleeping account wake-up 준비는 허용할 수 있다.
- 중요한 원칙은 **이번 턴의 첫 응답을 background 작업이 막으면 안 된다**는 점이다.

### 3-4. rotate 판단은 snapshot 1장이 아니라 pre/post 비교다

- Ultra는 `70 → 40 → 10`, Pro는 `70 → 20` 경계를 쓴다.
- `73 → 64`는 처음 70을 넘긴 것이므로 rotate 대상이다.
- `67 → 64`는 이미 70 아래였으므로 같은 이유의 재rotate 대상이 아니다.
- 같은 구간 반복 흔들림을 막기 위해 bucket 기록을 계정 카드에 남긴다.

### 3-5. pending-switch.json 은 적용 기록이다

- 이 파일은 “다음에 바꾸자” 메모가 아니라, **지금 이 계정으로 이미 바꿨다**는 기록이다.
- `target_account_id`, `source_account_id`, crossing 이유, pre/post 값, 적용 시각, fingerprint/serviceMachineId 식별자는 포함 가능하다.
- **auth token 원문은 절대 저장하지 않는다.**

---

## 4. 현재 코드 기준 출발점

### 4-1. 이미 존재하는 구현 축

- `src/services/accounts.ts`
  - 계정 index/detail 구조, 5-state `account_status`, quota_cache/rotation/wakeup_history 저장 구조가 이미 있다.
- `src/services/authList.ts`
  - `GEMINI / CLAUDE` 고정 열, stale/reset 경과 시 99% 보정(progress bar clamp) 규칙이 이미 있다.
- `src/services/quotaClient.ts`
  - Cloud Code direct quota fetch, 60초 cache TTL, 동시성 4 배치 구조가 이미 있다.
- `src/services/rotate.ts`
  - threshold bucket 판정, pending-switch 저장/로드, stale intent 정리 로직이 이미 있다.
- `src/services/wakeup.ts`
  - sleeping account 필터링과 cooldown 기록의 기초 로직이 이미 있다.
- `src/services/seamlessSwitch.ts`
  - live attach / plugin transport / USS push path 기준으로 seamless switch 가능성을 평가하는 기초 로직이 이미 있다.
- `src/services/authInject.ts`
  - `state.vscdb`의 `oauthToken`, `agentManagerInitState`, `antigravityOnboarding` 갱신 로직이 이미 있다.
- `src/services/authLogin.ts`, `src/services/oauthClient.ts`
  - 브라우저 OAuth 기반 로그인과 local import의 기본 골격이 이미 있다.

### 4-2. v0.3.0에서 아직 고정/정리가 필요한 축

- `auth refresh` 명령 표면과 `auth list` 역할 분리
- “계정 카드”를 실제 제품 표면 개념으로 명시하는 문서화
- prompt 전/후 quota 갱신 타이밍 계약
- refresh 대상 vs wake-up 대상 구분 규칙
- current account post-turn fresh read source priority
- `pending-switch.json` 필드 계약의 최종 고정
- live attach / Offline-Gateway / state.vscdb / cloud direct 간 source priority 계약

---

## 5. v0.3.0 최종 Spec

### 5-1. 명령 표면

#### `auth refresh`
- 역할: 전체 계정 quota를 cloud에서 읽어 계정 카드를 최신화한다.
- 기본 동작:
  - 모든 계정 대상
  - 계정 카드 갱신
  - 5h usage cycle 미시작 계정 발견 시 wake-up 실행
- 이 명령은 **정리/준비용**이다.

#### `auth list`
- 역할: 저장된 계정 카드를 빠르게 읽어 보여준다.
- 기본 동작:
  - 전체 cloud 조회를 기본값으로 수행하지 않는다.
  - 오래되거나 불확실한 계정만 선택 갱신한다.
  - sleeping account가 잡히면 필요한 대상만 wake-up한다.
  - UI/텍스트 표면은 `GEMINI / CLAUDE` 고정 열과 99% stale clamp 규칙을 유지한다.
- 이 명령은 **빠른 조회용**이다.

#### 실제 프롬프트 실행 (`agcl "..."`, `agcl -r <uuid> "..."`)
- 시작 시점:
  - rotate 선판단 금지
  - current account로 바로 실행
  - 첫 응답을 background 작업이 막으면 안 됨
- 종료 시점:
  - current account fresh quota 재조회
  - pre/post crossing 판단
  - 필요 시 같은 실행 안에서 즉시 switch 적용 + applied record 기록

### 5-2. 계정 카드(Account Card)

계정 카드는 다음 값을 최소 포함해야 한다.

- tier
- family별 잔량 (`GEMINI`, `CLAUDE`)
- family별 reset 시각
- 마지막 quota 조회 시각
- 계정 상태(`account_status`)
- 마지막으로 처리한 threshold bucket
- wake-up 관련 상태

### 5-3. `auth list`의 선택 갱신 규칙

#### 오래된 계정
- 마지막 quota 조회 시각이 5시간을 넘은 계정

#### 불확실한 계정
- 최근 quota 조회 실패 이력이 남은 계정
- family quota가 비어 있거나 전부 null인 계정
- reset 시각이 이미 지난 계정
- offline-only 또는 기타 로컬 경로 최신화 검증이 아직 안 된 current account

### 5-4. stale/reset 경과 표시 규칙

- reset 시각이 이미 지난 계정은 **표시상 99%**처럼 보정한다.
- 이 값은 “실제 cloud를 다시 읽었다”는 뜻이 아니라 **사용자 표시용 신호**다.
- 다만 실제 rotate 후보 계산에 사용할 때는 fresh read 또는 refresh 대상 재판정을 먼저 거친다.

### 5-5. 현재 턴의 기준 family

- 기본값은 `CLAUDE`
- 사용 모델이 명확히 Gemini 계열일 때만 `GEMINI`
- “애매하면 더 적게 남은 쪽” 규칙은 쓰지 않는다.

### 5-6. rotate 정책

- Ultra: `70 / 40 / 10`
- Pro: `70 / 20`
- crossing은 **이번 턴 시작 전 값과 종료 후 값의 비교**로만 판단한다.
- 같은 bucket에서 반복 rotate가 나지 않도록 계정 카드에 bucket 기록을 저장한다.
- Pro 20% 이하는 절대 사용 금지
- Ultra 10% 이하는 가장 후순위

### 5-7. 후보 선정 규칙

- 제외:
  - 금지된 계정
  - 비활성 계정
  - 보호 상태 계정
  - 재로그인 필요한 계정
- 우선순위:
  - 남은 퍼센트가 더 높은 계정 우선
  - Pro 20% 이하 제외
  - Ultra 10% 이하는 최후순위

### 5-8. `pending-switch.json`

- 성격: **즉시 적용된 switch의 기록 파일**
- 반드시 남길 것:
  - target_account_id
  - source_account_id
  - crossing reason
  - pre/post quota 요약
  - decided/applied timestamp
  - fingerprint id / serviceMachineId 식별 정보(토큰 제외)
- 절대 넣지 말 것:
  - auth token 원문

### 5-8-a. `pending-switch.json` 생명주기

- 생성 시점:
  - post-prompt fresh quota 재조회 후 crossing이 확정되고,
  - 같은 실행 안에서 switch 적용까지 끝난 직후 생성한다.
- 읽기 목적:
  - **재적용용 intent 소비 파일이 아니다.**
  - 운영 추적, 디버깅, 마지막 적용 결과 확인용 기록이다.
- 삭제 시점:
  - 기본은 보존
  - 상위 정책에서 별도 archive/rotation 규칙이 생기기 전까지는 최근 적용 기록으로 유지
- 금지:
  - 다음 실행에서 이 파일을 읽어 “아직 안 된 전환”처럼 replay 하지 않는다.

### 5-9. wake-up 정책

- wake-up 대상은 **5h usage cycle 미시작 계정**이다.
- refresh 대상과 wake-up 대상은 다르다.
- wake-up 자동 타이밍:
  - `auth refresh` 시: 전부 quota 조회 후 sleeping account를 발견하면 wake-up 시킨다.
  - `auth list` 시: 카드/선택 갱신 과정에서 sleeping account를 발견하면 wake-up 시킨다.
  - prompt 시작 전: background로 현재 계정 카드 조회 + sleeping account 발견 시 wake-up 시킨다.
  - prompt 실행 생명주기 중: current account cloud quota 조회는 background로 미리 시작할 수 있다.
  - prompt 종료 후: current account fresh quota를 기준으로 카드 기록 → rotate 판단 → rotate 적용을 수행한다.
- 핵심 제약:
  - 첫 응답을 막지 않는다.
  - 이미 깨어 있는 계정은 다시 wake-up하지 않는다.

### 5-9-a. wake-up 실행 방식

- 기본 메커니즘은 **대상 계정으로 LS 1턴 실행**이다.
- 목표는 UI 장식이 아니라 **5h usage cycle 시작**이다.
- sleeping account 판정은 기본적으로 다음 신호를 사용한다.
  - all-null family quota
  - reset 정보 없음
  - 아직 usage cycle 시작 전으로 볼 수 있는 상태

### 5-9-b. auth list wake-up 처리 원칙

- `auth list`는 여전히 **빠른 조회 명령**이다.
- 따라서 동작 순서는 다음으로 고정한다.
  1. 카드 기반 결과를 즉시 표시
  2. 오래되거나 불확실한 계정만 selective refresh
  3. 그 과정에서 sleeping account가 발견되면 **필요한 대상만** background wake-up
- 즉, `auth list`가 모든 계정을 깨우는 명령은 아니다.

### 5-10. switch 적용 범위

- switch는 auth만이 아니라 **fingerprint + serviceMachineId**까지 맞추는 흐름으로 정의한다.
- `fingerprint`는 **auth login 시점에 미리 생성/준비**되어 있어야 한다.
- fingerprint 생성 방식은 **Cockpit Tools의 `fingerprint.rs` 로직을 그대로 따르는 것**을 기본 계약으로 둔다.
- `serviceMachineId`는 `state.vscdb`의 `storage.serviceMachineId`에 쓰이는 값으로 정의한다.
- post-prompt rotate로 switch가 필요해지면 **같은 실행 안에서 즉시 적용**한다.
- live attach 상태에서는 다음을 구분해서 문서화한다.
  - state.vscdb 반영은 즉시 가능
  - 현재 붙어 있는 live LS 반영은 restart-needed 계약과 함께 서술

### 5-11. fast-path / source priority

current account의 post-turn fresh read는 다음 source priority를 따른다.

1. live attach LS 또는 future Offline-Gateway LS의 live 상태
2. `state.vscdb` 같은 로컬 persisted 상태
3. cloud direct 조회

주의:
- `state.vscdb`는 persisted 상태라 반영이 늦을 수 있다.
- 따라서 **살아 있는 LS 상태가 있으면 그것이 최우선**이다.
- Offline-Gateway는 이 문서에서 목표 경로로 다루되, **v0.3.0 최소 동작경로는 기존 offline path에 quota local fast-path를 추가하는 수준**으로 제한한다.
- 즉 이번 문서의 Offline-Gateway 최소 범위는 **gateway/live state 또는 `state.vscdb` 같은 로컬 경로에서 current quota를 빠르게 읽는 것**이지, gateway 전체 제품화를 끝내는 것이 아니다.

### 5-12. command × runtime path × allowed side-effects

| command / path | cloud fetch | local quick check | selective refresh | wake-up | auth inject | post-turn rotate | 비고 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `auth refresh` | YES (all) | YES | N/A | YES (sleeping only) | NO | NO | 전체 동기화 명령 |
| `auth list` | partial | YES | YES | YES (needed only) | 선택 시 YES | NO | 카드 즉시 표시 우선, sleeping account 발견 시 needed-only wake-up |
| prompt 시작 전 | background | YES | 필요 시 YES | YES (sleeping only) | NO | NO | 첫 응답 block 금지 |
| prompt 실행 중 | background(current only) | YES | N/A | 필요 시 YES | NO | NO | 첫 응답 block 금지, crossing 판단 금지 |
| prompt 종료 후 | YES (current only, final) | YES | N/A | 필요 시 YES | YES | YES | crossing 판단 + 같은 실행 즉시 적용 |
| live attach path | YES | live state 우선 | YES | YES | YES | YES | live LS 반영성은 restart-needed와 함께 서술 |
| offline path | YES | state/local 우선 | YES | YES | YES | YES | 기존 offline path에 current quota local fast-path 추가가 v0.3.0 최소 범위 |

### 5-13. source-of-truth / secret boundary / write-order

#### 파일 책임

| 파일/저장소 | 진실 원본 역할 | 비밀정보 포함 여부 |
| --- | --- | --- |
| `accounts.json` | 현재 계정 index / 계정 목록 | NO |
| `accounts/{id}.json` | 계정 detail, token, quota card, rotation, wake-up 상태 | YES |
| `cache/quota/{id}.json` | quota fetch cache | **토큰 원문 저장 금지** |
| `state.vscdb` | 실제 런타임 inject 대상 | YES |
| `pending-switch.json` | 마지막 적용 switch 기록 | NO |

#### 쓰기 순서 원칙

1. source fetch / 판정
2. account card 갱신
3. switch 필요 시 runtime apply (`state.vscdb`)
4. applied record(`pending-switch.json`) 기록

#### secret boundary

- auth token 원문은 `accounts/{id}.json`, `state.vscdb` 외 저장 금지
- `pending-switch.json` 저장 금지
- `cache/quota/{id}.json` 저장 금지
- `quotaClient.ts`의 refreshed token은 cache 파일이 아니라 account store 갱신 경로에서만 소비되어야 한다.

### 5-14. legacy → v0.3.0 migration / cutover / rollback

- `accounts.json`이 authoritative 저장소가 되는 시점을 명시한다.
- legacy `auth.json`, `user-data/user-*`, 기존 state DB import 흐름은 컷오버 전환 규칙과 함께 쓴다.
- migration 실패 시 rollback 경로를 문서에 남긴다.
- dedupe 기본 기준은 email upsert다.

### 5-15. canonical policy tables

#### 상태 전이 / 후보 제외

| 상태 | 의미 | rotate 후보 | wake-up 후보 |
| --- | --- | --- | --- |
| `active` | 정상 사용 가능 | YES | 조건부 |
| `protected` | 보호 상태 | NO | NO |
| `forbidden` | 차단/403 | NO | NO |
| `disabled` | 비활성 | NO | NO |
| `needs_reauth` | 재로그인 필요 | NO | NO |

#### 99% 보정 의미

| 항목 | 의미 |
| --- | --- |
| UI 표시 | YES |
| refresh 대상 신호 | YES |
| rotate 입력값 그 자체 | NO |

#### bucket 규칙

| 항목 | 규칙 |
| --- | --- |
| Ultra | 70 / 40 / 10 |
| Pro | 70 / 20 |
| 비교 방식 | pre/post snapshot 기반 crossing |
| 90% 회복 reset | **사용 안 함** |

---

## 6. 성공조건

> 이 섹션은 **제품 동작 기준 + 구현 검증 기준**을 함께 가진다.

### 6-1. 제품 동작 성공조건

- `auth refresh`는 전체 계정 quota를 cloud에서 읽고 계정 카드를 최신화한다.
- `auth list`는 기본적으로 계정 카드를 즉시 읽어 보여주고, 오래되거나 불확실한 계정만 선택 갱신한다.
- reset 시각이 지난 계정은 표시상 99%로 보정된다.
- wake-up은 매번 실행되지 않고, 5h usage cycle 미시작 계정에 대해서만 실행된다.
- wake-up의 목적이 “다음 계정의 5시간 타이머를 앞당기는 것”으로 설계에 반영된다.
- 프롬프트 시작 시점에는 rotate를 선판단하지 않고 current account로 바로 실행한다.
- 프롬프트 종료 후 current account에 대해 fresh quota를 다시 읽고, pre/post 비교로 threshold crossing을 판단한다.
- `73 → 64`는 rotate 대상이고, `67 → 64`는 같은 이유의 재rotate 대상이 아니다.
- bucket 기록이 저장되어 같은 구간 반복 rotate가 발생하지 않는다.
- Pro 20% 이하 절대 사용 금지, Ultra 10% 최후순위 규칙이 지켜진다.
- rotate가 필요하면 그 즉시 switch가 수행되고, 결과가 `pending-switch.json`에 적용 기록으로 남는다.
- `pending-switch.json`에는 토큰 원문이 저장되지 않는다.
- live attach 또는 future Offline-Gateway가 있으면 로컬 fast-path를 사용할 수 있다.

### 6-2. 구현 검증 성공조건

- 코드 표면에 `auth refresh` 경로가 존재하고, `auth list`와 별도 라우팅된다.
- 계정 카드 스키마에 tier/family quota/reset/cached_at/account_status/bucket/wakeup 상태가 모두 반영된다.
- `auth list` 렌더링은 `GEMINI / CLAUDE` 고정 열 + stale 99% 규칙을 유지한다.
- refresh 대상 판정 로직과 wake-up 대상 판정 로직이 분리되어 있다.
- rotate 판정은 pre/post quota 비교 기반으로 동작하고, 단순 현재 snapshot만으로 결정하지 않는다.
- `pending-switch.json` 스키마가 토큰 없이 기록 중심으로 고정된다.
- `pending-switch.json`이 replay용 intent 소비 파일처럼 사용되지 않는다.
- source priority가 live 상태 → `state.vscdb` → cloud direct 순으로 문서와 구현에 일치한다.
- `fingerprint`가 auth login 시점에 준비되고, switch 시 자동 적용된다.
- `serviceMachineId`가 switch 시 적용 축으로 포함된다.
- `auth list`에서 sleeping account 발견 시 필요한 대상만 wake-up한다.
- post-prompt rotate가 같은 실행 안에서 즉시 적용된다.
- 모든 새/변경 경로에 대해 테스트 또는 검증 시나리오가 plan checklist에 연결된다.

---

## 7. NOT NOW

> 주인님 요청대로, 여기에는 “이번 버전에서 일부러 잠그는 것”만 적는다.

- 추상 정책 엔진화(YAML/DSL)
  - 현재는 하드코딩 규칙으로 고정하는 편이 더 안전하다.

---

## 8. 근거표

| 근거 소스 | 왜 중요한가 |
| --- | --- |
| `handoff-plan-spec/v0.3.0-01-handoff.md` | 이번 문서의 1차 출발점. refresh/list 분리, wake-up 의미, pending-switch 성격, source priority 방향이 여기서 나온다. |
| `handoff-plan-spec/v0.3.0-01-question.md` | handoff를 다시 읽고 확정한 decision log다. fingerprint 생성 방식(Cockpit `fingerprint.rs`), Offline-Gateway 최소 범위, NOT NOW 범위 같은 최종 해석이 여기서 확정된다. |
| `src/services/accounts.ts` | 계정 카드 스키마와 상태 저장 구조의 현재 구현 출발점이다. |
| `src/services/authList.ts` | `GEMINI / CLAUDE` 고정 열과 99% stale clamp 규칙의 현재 구현 근거다. |
| `src/services/quotaClient.ts` | Cloud Code direct fetch, 60초 cache, 동시성 4 배치 구조의 현재 구현 근거다. |
| `src/services/rotate.ts` | threshold bucket / pending-switch 저장 로직의 현재 구현 근거다. |
| `src/services/wakeup.ts` | sleeping account 판정과 cooldown 상태의 현재 구현 근거다. |
| `src/services/seamlessSwitch.ts` | seamless switch feasibility와 full-switch fallback 계약의 현재 구현 근거다. |
| `src/services/authInject.ts` | state.vscdb auth inject 범위(oauthToken, agentManagerInitState, onboarding)의 현재 근거다. |
| `src/services/authLogin.ts` | 브라우저 OAuth + local import의 현재 구현 근거다. |
| `src/services/oauthClient.ts` | Google OAuth client/scopes/token refresh의 현재 구현 근거다. |

---

## 9. 구현 Plan

### 9-1. 구현 목표

- handoff의 제품 정책을 현재 코드에 정확히 반영한다.
- `auth refresh` / `auth list` / prompt 전후 quota/rotate/wake-up 흐름을 문서와 코드에서 일치시킨다.
- “빠른 조회”, “post-turn 판단”, “sleeping account wake-up”, “안전한 switch 기록”을 각 모듈 책임으로 분리한다.

### 9-2. 구현 전략

- 기존 모듈을 최대한 재사용하되, 명령 책임을 다시 나눈다.
- checklist는 **파일/모듈 단위**로 작성한다.
- 각 항목은 바로 구현 가능한 수준으로 써야 한다.
- 각 항목은 성공조건과 연결되어야 한다.

### 9-2-a. 병렬 실행 웨이브 / 의존성

- **Wave 1 — 계약/스키마 선행**
  - Task 1: `auth refresh` 진입점
  - Task 4: account card canonical schema + migration/cutover
  - Task 11: quota cache secret boundary 정리
- **Wave 2 — 조회/판정 규칙 정리**
  - Task 2: `auth refresh` 전체 동기화
  - Task 3: `auth list` 즉시 표시 + selective refresh
  - Task 5: rotate 규칙 정리 (`90% reset 제거`, `needs_reauth` 제외, applied record)
  - Task 8: auth login fingerprint 준비
- **Wave 3 — 실행 경로 연결**
  - Task 6: post-prompt rotate 위치 이동
  - Task 7: switch apply + seamless feasibility/fallback 연결
  - Task 9: wake-up orchestration 실제 연결
  - Task 10: Offline-Gateway 최소 동작경로 정리
- **Wave 4 — 검증 고정**
  - Task 12: 테스트 확장 및 회귀 검증

- **핵심 의존성**
  - Task 4 → Task 2, 3, 5, 7, 8, 9, 11
  - Task 5 → Task 6, 7
  - Task 6 → Task 7, 9, 10
  - Task 2 + 3 + 5 + 6 + 7 + 9 + 10 + 11 → Task 12

### 9-3. 구현 Checklist

- [ ] 1. `src/main.ts`: `auth refresh` 명령 진입점 추가

  **해야 할 일**
  - `detectRootCommand_func`, auth subcommand 파싱, help 문구에 `auth refresh` 추가
  - `handleAuthRefresh_func`를 신규로 연결
  - `auth list` / `auth login`과 라우팅 분리

  **참조**
  - `src/main.ts`: `detectRootCommand_func`, `parseAuthArgv_func`, `handleAuthCommand_func`, `buildRootHelp_func`
  - `handoff-plan-spec/v0.3.0-01-handoff.md` [1], [2-1]

  **검증 연결**
  - 성공조건: `auth refresh` 경로 존재, 별도 라우팅

  **QA 시나리오**
  - Tool: Bash
  - Happy path: `bun run src/main.ts auth refresh --json` 실행 시 `auth refresh` 경로로 라우팅되고 usage 에러 없이 refresh 핸들러가 호출된다.
  - Negative path: `bun run src/main.ts auth nope` 실행 시 non-zero 종료와 함께 `list / login / refresh`가 포함된 help 문구가 출력된다.

- [ ] 2. `src/main.ts` + `src/services/quotaClient.ts`: `auth refresh` 전체 동기화 흐름 고정

  **해야 할 일**
  - 모든 계정 quota cloud fetch
  - 계정 카드 최신화
  - sleeping account 발견 시 wake-up 연계 hook 추가
  - 출력 형식을 `auth list`와 호환되게 정리

  **참조**
  - `src/services/quotaClient.ts`: `fetchQuotaForAccounts_func`
  - `src/services/accounts.ts`: `updateAccountQuotaState_func`, `listAccounts_func`
  - handoff [1], [2-1]

  **검증 연결**
  - 성공조건: auth refresh 전체 동기화 + wake-up 대상 처리

  **QA 시나리오**
  - Tool: Bash
  - Happy path: stale account 3개 fixture 상태에서 `bun run src/main.ts auth refresh` 실행 후 각 `accounts/{id}.json`의 `quota_cache.cached_at`가 갱신된다.
  - Negative path: 계정 1개가 forbidden 응답이어도 명령 전체는 종료 코드 0을 유지하고 해당 account card에는 forbidden 상태/에러가 기록된다.

- [ ] 3. `src/main.ts` + `src/services/authList.ts`: 카드 즉시 표시 + selective refresh 구조로 재구성

  **해야 할 일**
  - 카드 기반 즉시 렌더
  - `src/services/authList.ts` 안에 selective refresh 대상 판정 helper를 명시적으로 둔다.
  - 오래된/불확실한 계정만 selective refresh
  - sleeping account 발견 시 필요한 대상만 wake-up
  - list가 전체 fetch 명령으로 되돌아가지 않게 guardrail 추가

  **참조**
  - `src/services/authList.ts`: `buildAuthListRows_func` 주변 렌더링 경로
  - `src/main.ts`: `handleAuthList_func`
  - `src/services/quotaClient.ts`: selective fetch 대상만 호출되도록 연결
  - handoff [1-3], [W](2-2)

  **검증 연결**
  - 성공조건: auth list 즉시 표시 + selective refresh + needed-only wake-up

  **QA 시나리오**
  - Tool: Bash
  - Happy path: fresh 3개 + stale 2개 fixture에서 `bun run src/main.ts auth list --json` 실행 시 5개 카드가 즉시 출력되고 stale 2개만 선택 갱신된다.
  - Negative path: 전부 fresh인 상태에서는 cloud fetch 호출 수가 0이고 cached card만으로 출력이 완료된다.

- [ ] 4. `src/services/accounts.ts`: 계정 카드 canonical schema 보강

  **해야 할 일**
  - tier/families/reset/cached_at/status/bucket/wakeup 상태 필드가 문서 계약과 완전히 일치하는지 정리
  - migration/cutover/rollback 규칙을 반영할 기본 helper 보강
  - `auth.json`, `user-data/user-*`, `importLocalFromStateDb_func()`와의 cutover/rollback 계약을 checklist에 반영
  - `needs_reauth` / `protected` 등 상태 전이 기준을 문서와 일치시킴

  **참조**
  - `src/services/accounts.ts`: `readAccountsIndex_func`, `upsertAccount_func`, `discoverAccounts_func`
  - `src/services/authLogin.ts`: `importLocalFromStateDb_func`
  - Metis/Oracle 리뷰: canonical tables 필요

  **검증 연결**
  - 성공조건: 계정 카드 스키마 완전성

  **QA 시나리오**
  - Tool: Bash
  - Happy path: legacy import 후 `accounts.json`과 `accounts/{id}.json`가 authoritative 구조로 유지되고 email dedupe가 동작한다.
  - Negative path: 깨진 account detail 파일이 있어도 해당 계정은 refresh 대상처럼 처리되고 전체 명령은 중단되지 않는다.

- [ ] 5. `src/services/rotate.ts`: 90% reset 제거 + `needs_reauth` 후보 제외 + applied-record 구조 반영

  **해야 할 일**
  - `thresholdBucket_func()`의 `remainingPct >= 90` 분기와 `decideAutoRotate_func()`의 90% reset 블록을 제거
  - `decideAutoRotate_func()` candidate filter에서 `needs_reauth`를 명시적으로 제외
  - `PendingSwitchIntent` 타입 정의 자체를 replay intent가 아니라 applied record 구조로 확장
  - pre/post quota snapshot 필드와 fingerprint/serviceMachineId 메타 필드를 아래 이름으로 추가
    - `pre_quota_pct: number | null`
    - `post_quota_pct: number | null`
    - `fingerprint_id: string | null`
    - `service_machine_id: string | null`
    - `applied_at: number | null`

  **참조**
  - `src/services/rotate.ts`: `PendingSwitchIntent`, `thresholdBucket_func`, `decideAutoRotate_func`, `loadPendingSwitchIntent_func`, `savePendingSwitchIntent_func`, `clearPendingSwitchIntent_func`
  - handoff [9], [6], [7]

  **검증 연결**
  - 성공조건: 90% reset 없음, applied record, token 미포함

  **QA 시나리오**
  - Tool: Bash
  - Happy path: 73→64 fixture에서 applied record가 생성되고 `familyBuckets`는 crossing bucket으로 기록된다.
  - Negative path: `needs_reauth` 후보만 남은 경우 rotate 후보가 비어 경고만 남고 switch 기록은 생성되지 않는다.

- [ ] 6. `src/main.ts`: rotate 호출 위치를 post-prompt로 이동

  **해야 할 일**
  - 현재 pre-response `decideAndPersistAutoRotate_func` 호출 제거/이동
  - `applyPendingSwitchIntentIfNeeded_func()`와 main pre-run 호출(line 2384 부근)의 replay 소비 경로를 제거하거나 applied-record semantics에 맞게 비활성화한다.
  - `main()`의 현재 pre-call(`await decideAndPersistAutoRotate_func(...)`)을 제거하고,
    `handleLivePath_func`, `handleLiveResumeSend_func`, `runOfflineSession_func`, `handleResumeSend_func`에서 `observeAndAppendSteps_func()` 성공 직후 공통 post-prompt pipeline helper를 호출하도록 설계한다.
  - 응답 완료 후 current account fresh read → 카드 기록 → crossing 판단 → 즉시 적용
  - same execution apply 계약을 구현 흐름에 반영

  **참조**
  - `src/main.ts`: `decideAndPersistAutoRotate_func`, current pre-call near line 2463, `observeAndAppendSteps_func`, `handleLivePath_func`, `handleLiveResumeSend_func`, `runOfflineSession_func`, `handleResumeSend_func`
  - handoff [3], [4], [W](2-4)

  **검증 연결**
  - 성공조건: post-prompt fresh read + same-run rotate apply

  **QA 시나리오**
  - Tool: Bash
  - Happy path: 대화 1턴 성공 후에만 rotate pipeline이 실행되고 pre-send 시점에는 switch 판단 로그가 남지 않는다.
  - Negative path: 응답 실패/observe 실패 시 post-prompt rotate pipeline이 실행되지 않는다.

- [ ] 7. `src/services/authInject.ts` + `src/services/seamlessSwitch.ts` + `src/main.ts`: switch 시 auth + fingerprint + serviceMachineId 적용과 seamless fallback 계약 연결

  **해야 할 일**
  - switch payload에 fingerprint/serviceMachineId 적용 순서 정의
  - `evaluateSeamlessSwitchFeasibility_func()` 결과를 switch apply 경로에서 읽어 `experimental` vs `full-switch` fallback 계약을 명시한다.
  - partial failure 시 복구 규칙 문서와 맞춤
  - live attach 경로의 restart-needed 메시지 계약 반영

  **참조**
  - `src/services/authInject.ts`
  - `src/services/seamlessSwitch.ts`: `evaluateSeamlessSwitchFeasibility_func`
  - `src/services/seamlessSwitch.test.ts`
  - handoff [9], “switch는 auth만이 아니라 fingerprint와 serviceMachineId까지”

  **검증 연결**
  - 성공조건: switch 시 세 축 동시 적용, token 외 비밀정보 경계 유지

  **QA 시나리오**
  - Tool: Bash
  - Happy path: seamless feasibility가 `unsupported`면 full-switch fallback으로 진행되고 state.vscdb와 applied record가 모두 갱신된다.
  - Negative path: auth inject는 성공했지만 fingerprint/serviceMachine 단계가 실패하면 partial failure가 감지되고 복구/경고 경로가 실행된다.

- [ ] 8. `src/services/authLogin.ts` + 관련 신규/보강 모듈: auth login 시 fingerprint 준비 흐름 추가

  **해야 할 일**
  - auth login 시점에 **Cockpit Tools `fingerprint.rs`와 동일한 규칙**으로 fingerprint를 생성/준비해 account store에 저장
  - 이후 switch에서 재사용 가능한 source-of-truth로 연결
  - login과 switch의 책임 분리를 문서와 코드에 일치시킴

  **참조**
  - `src/services/authLogin.ts`: `authLogin_func`, `importLocalFromStateDb_func`
  - `src/services/accounts.ts`: `upsertAccount_func`
  - `handoff-plan-spec/v0.3.0-01-question.md`: Q1 → `Cockpit fingerprint.rs 그대로`

  **검증 연결**
  - 성공조건: fingerprint가 login에서 준비되고 switch에서 적용됨

  **QA 시나리오**
  - Tool: Bash
  - Happy path: 신규 login 후 생성된 account detail에 Cockpit `fingerprint.rs` 규칙 기반 fingerprint source 값이 준비되어 이후 switch 입력으로 재사용된다.
  - Negative path: login 취소/timeout 시 fingerprint placeholder만 남는 불완전 account가 생성되지 않는다.

- [ ] 9. `src/services/wakeup.ts` + `src/main.ts`: wake-up orchestration 실제 실행 경로 연결

  **해야 할 일**
  - 후보 필터 유틸 위에 LS 1턴 실행 orchestration 추가
  - `auth refresh`, `auth list`, pre-prompt, post-prompt 경로별 hook 연결
  - needed-only wake-up과 non-blocking 계약 유지

  **참조**
  - `src/services/wakeup.ts`: `filterWakeupCandidates_func`, `updateWakeupHistory_func`
  - `src/main.ts`: `runOfflineSession_func` 및 post-prompt/pre-prompt hook 지점
  - handoff [W](2-1)~(2-4)

  **검증 연결**
  - 성공조건: wake-up 타이밍별 동작 + 첫 응답 non-blocking

  **QA 시나리오**
  - Tool: Bash
  - Happy path: sleeping account fixture에서 LS 1턴 wake-up 후 `wakeup_history.last_result=success`와 cycle-start 상태가 기록된다.
  - Negative path: wake-up timeout 계정은 cooldown에 들어가고 첫 응답 latency는 증가하지 않는다.

- [ ] 10. `src/main.ts` + `src/services/stateVscdb.ts` + `src/services/liveAttach.ts`: Offline-Gateway 최소 동작경로 계획 반영

  **해야 할 일**
  - 최소 동작경로 기준으로 hook point와 source-priority를 문서/코드 reference에 연결
  - primary target 파일을 `src/main.ts`, `src/services/stateVscdb.ts`, `src/services/liveAttach.ts`로 고정한다.
  - 기존 offline path에 **current quota local fast-path**를 추가하는 범위로 한정한다.
  - live attach / offline path / future gateway path 차이를 명시하되, v0.3.0에서는 **gateway 전체 제품화**가 아니라 **quota 로컬 fast-path 추가**만 다룬다.
  - 최소 동작경로 = live LS 또는 `state.vscdb` 같은 로컬 경로에서 current quota를 빠르게 읽고, 최신화 검증이 안 되면 cloud direct로 fallback하는 계약까지로 제한한다.

  **참조**
  - handoff [4-(1)], [150-161]
  - `handoff-plan-spec/v0.3.0-01-question.md`: Q2 → A (기존 offline path에 quota local fast-path 추가)
  - `src/main.ts`: `discoverLiveLanguageServer_func`, `handleLivePath_func`, `runOfflineSession_func`
  - `src/services/stateVscdb.ts`
  - `src/services/liveAttach.ts`

  **검증 연결**
  - 성공조건: local fast-path 우선순위 문서/코드 일치

  **QA 시나리오**
  - Tool: Bash
  - Happy path: 기존 offline path 실행 시 current quota가 live LS 또는 `state.vscdb` 같은 로컬 경로에서 먼저 읽히고, 그 값이 최신으로 검증되면 cloud direct 호출 없이 카드가 갱신된다.
  - Negative path: 로컬 경로 최신화가 검증되지 않으면 current account만 cloud direct fallback으로 조회된다.

- [ ] 11. `src/services/quotaClient.ts`: secret boundary 재정렬

  **해야 할 일**
  - cache 파일에 token 원문이나 재사용 가능한 민감값이 스며들지 않게 경계 재검토
  - source-of-truth / cache 책임을 문서와 구현에 일치시킴
  - write-order와 atomic write 패턴을 재검토

  **참조**
  - `src/services/quotaClient.ts`
  - `src/services/accounts.ts`: `writeJsonAtomic0600_func`

  **검증 연결**
  - 성공조건: token은 account store/state DB 외 저장 금지

  **QA 시나리오**
  - Tool: Bash
  - Happy path: quota cache 파일을 검사했을 때 access_token / refresh_token / bearer 문자열이 존재하지 않는다.
  - Negative path: refreshedToken이 반환되더라도 cache 파일이 아니라 account store 갱신 경로에서만 소비된다.

- [ ] 12. 테스트 파일들: spec 계약을 테스트로 고정

  **해야 할 일**
  - `rotate.test.ts`: 90% reset 제거, `needs_reauth` 제외, applied-record 계약 반영
  - `wakeup.test.ts`: LS 1턴 orchestration 경로 추가
  - `authList.test.ts`: 즉시 표시 + selective refresh + needed-only wake-up 검증 추가
  - `authLogin.test.ts`: fingerprint 준비 흐름 검증 추가
  - 필요 시 `main.test.ts`: pre/post prompt hook 이동 검증 추가

  **참조**
  - `src/services/rotate.test.ts`
  - `src/services/wakeup.test.ts`
  - `src/services/authList.test.ts`
  - `src/services/authLogin.test.ts`
  - `src/services/seamlessSwitch.test.ts`
  - `src/main.test.ts`

  **검증 연결**
  - 성공조건: 제품 동작 + 구현 검증 조건을 테스트로 고정

  **QA 시나리오**
  - Tool: Bash
  - Happy path: `bun test` 실행 시 신규/기존 테스트가 모두 통과한다.
  - Negative path: 90% reset, pre-response rotate, pending-switch replay 같은 금지 회귀를 일부러 넣으면 대응 테스트가 실패한다.

---

## 10. 최종 검증 기준

- 문서의 spec 섹션과 plan 섹션이 서로 모순되지 않는다.
- handoff 핵심 맥락이 refresh/list/rotate/wake-up/pending-switch/source priority 축에서 빠지지 않는다.
- NOT NOW 항목이 범위 잠금 역할을 실제로 수행한다.
- checklist가 기능 슬로건 수준이 아니라 파일/모듈 행동 수준까지 내려가 있다.
- 성공조건이 제품 동작과 구현 검증을 모두 포함한다.
