# Mandate: v0.2.1 Auth Overhaul — 통합 Spec 작성

> 세션 목적: **spec 문서 산출물**. 구현 계획이 아님.
> 버전: v0.2.1 (v0.3.0 아님 — 주인님 확인: "이게 완료되면 v0.2.1이 되는거야")

---

## 1. 산출물

| 산출물 | 경로 | 상태 |
|--------|------|------|
| mandate | `.sisyphus/mandate_v0.2.1-auth-overhaul.md` | ✅ 작성 중 |
| draft (비교표) | `.sisyphus/drafts/v0.2.1-spec-draft.md` | ⬜ |
| 통합 spec | `.sisyphus/plans/00-plan-v0.2.1-auth-overhaul.md` | ⬜ |

---

## 2. 베이스 spec 및 레퍼런스

| 문서 | 역할 |
|------|------|
| `handoff-plan-spec/v0.2.1-02-spec-opus.md` | 상세 설계 원천. Opus 작성. bucket dedup, family-aware 판정, pending-switch 영속화 등 상세 |
| `handoff-plan-spec/v0.2.1-02-spec-gpt.md` | 기능 스코프 원천. GPT 작성. 4개 Feature + 성공조건 + 구현순서 |
| `handoff-plan-spec/cockpit조사-01-auth.md` | Auth 아키텍처 조사. OAuth, Local Import, Auth Inject, Device Fingerprint 등 |
| `handoff-plan-spec/cockpit조사-02-ui.md` | Local Gateway + UI 표시 조사 |
| `handoff-plan-spec/cockpit조사-03-quota.md` | Quota REST API + Wake-up + 로테이션 조사 |

---

## 3. 인터뷰 합의사항 (3라운드 + 다른 세션 결과)

### 3-1. Spec 작성 방식

| 항목 | 결정 |
|------|------|
| **베이스** | 새 통합 spec (두 spec 장점 병합) |
| **성공조건 형태** | 주장별 증명형 (각 주장에 대해 증명 방법 명시) |
| **다른 세션 결과** | 우선근거로 승격 (spec의 판단 근거로 직접 인용) |

### 3-2. 인증 방식

| 항목 | 결정 | 비고 |
|------|------|------|
| **브라우저 OAuth** | 기본 등록 경로 | `auth login`. 앱 의존 완전 제거. Cockpit와 동일 client_id/secret |
| **Local Import** | 내부 capability | CLI 명령 없음. `importLocalFromStateDb_func()` 내부 함수만. user-data 기존 폴더에서 토큰 추출용. 8개 계정 재로그인 방지 |
| **import-token** | 내부/이행 축 | `auth login --token` 또는 마이그레이션 경로로 명시. .env 사용자 전환용 |

주인님: "기본으로는 OAuth. Local Import는 user-data-dir을 삭제 안 할 거니까 거기서 뽑아올 함수. 아니면 8개 계정 다시 다 로그인해야 하잖아. 끔찍하게."

### 3-3. 저장소

| 항목 | 결정 |
|------|------|
| **형식** | Cockpit 호환: `accounts.json` (인덱스) + `accounts/{id}.json` (상세) |
| **account_status** | Opus 4-state enum: `active` / `protected` / `forbidden` / `disabled` |
| **마이그레이션** | 기존 `user-data/user-*` → 자동 마이그레이션 (Local Import 함수로 추출) |
| **user-data-dir** | 삭제 안 함. overlay 방식에서 base profile은 기존 경로 유지 |

### 3-4. Auth Inject (계정 전환)

| 항목 | 결정 |
|------|------|
| **위상** | 기본 apply 메커니즘. switch의 하위 동작. 둘 다. |
| **방식** | Auth Inject: state.vscdb의 auth 키만 교체 (oauthToken, agentManagerInitState, antigravityOnboarding) |
| **세션/대화** | 대화 공유 (overlay). 같은 user-data-dir → auth만 다르고 세션 공유. usage 끝나도 다른 계정으로 작업 지속 가능. |
| **영속화** | `pending-switch.json` (rotate intent). CLI 비정상 종료 대비. 24시간 stale 폐기. |

### 3-5. Seamless Switch

| 항목 | 결정 |
|------|------|
| **위상** | **가장 중요한 축 중 하나**. 두 spec 모두 NOT NOW로 빠뜨린 것이 문제. |
| **개념 재정립** | Cockpit의 Full Switch = "앱을 띄워야 하니까 앱 재시작". 우리는 user-data-dir 기반 CLI. 백그라운드 LS. **더 쉬울 것** (주인님 통찰). |
| **조사** | 전면 조사 (Cockpit 코드 + 이미 조사된 자료 참조 + 실험). spec엔 experimental로 표시. 조사 결과에 따라 기본 경로 승격. |
| **가설** | offline LS kill → 새 토큰 respawn 또는 USS re-push (PushUnifiedStateSyncUpdate 역방향). |

### 3-6. Quota

| 항목 | 결정 |
|------|------|
| **소스** | 결정 게이트로 표기. wake-up이 UI에 뜨면 state.vscdb 갱신 확인 → 되면 vscdb/LS 읽기. 안 되면 Cloud Code REST API 직접. |
| **독립 명령** | 없음. `auth list`가 사실상 quota의 모든 내용을 읽음. quotaClient.ts는 내부 모듈만. |
| **현재 구현** | auth list에서 state.vscdb의 userStatus 파싱. 확인 필요. |
| **참조** | Opus: bounded parallel fetch + 60초 캐시 + 403→forbidden 전이 |

### 3-7. Auto-Rotate

| 항목 | 결정 |
|------|------|
| **방식** | Opus의 Sticky-Threshold 전체: bucket dedup + family-aware 판정 |
| **트리거** | 메시지 전송 경로만. 읽기 전용 명령 제외. |
| **threshold** | Ultra: 70→40→10. Pro: 70→20 (20% 미만 사용 금지). Free: 소진 시. |
| **pending-switch** | 작업 전 판정 → 작업 후 inject. 영속화. 24시간 stale 폐기. |

### 3-8. Wake-up

| 항목 | 결정 |
|------|------|
| **위상** | 기능 + 검증축 둘 다 |
| **구현 수준** | Opus의 상세 wake-up: null-quota 판정 disambiguation + per-account cooldown 30분 + 403→forbidden 전이 |
| **중요도** | 주인님: "wake up이 엄청 중요한 거야" |

### 3-9. CLI 표면 명령

| 명령 | 역할 |
|------|------|
| `auth login` | 브라우저 OAuth (기본). 내부적으로 Local Import도 처리 |
| `auth list` | 계정 목록 + quota 진도바. TTY에서 선택 시 auth inject |

### 3-10. NOT NOW (v0.2.1 이후)

| 항목 | 이유 |
|------|------|
| Plugin Sync | Cockpit 전용, 참고만 |
| Device Fingerprint | v0.2.2+ |
| Default 백업 (user-00) | Account Overlay로 불필요 |
| YAML 정책 엔진 | 하드코딩 규칙으로 시작 |
| Seamless Switch | experimental 조사 후 승격 |
| multi-workspace | 단일 workspace 기준 |
| 독립 quota 명령 | auth list로 충분 |

### 3-11. 테스트

| 항목 | 결정 |
|------|------|
| **전략** | 모듈별 단위 테스트 + 통합 테스트 |
| **실제 API** | 수동 E2E |
| **Mock** | OAuth flow, Cloud Code API 호출 등 |

### 3-12. Google OAuth Credential

| 항목 | 결정 |
|------|------|
| **방식** | Cockpit와 동일한 client_id/client_secret |
| **의미** | Antigravity 공식 앱과 동일한 "간판" 사용. Google이 Antigravity 앱으로 인식. |
| **비유** | client_id = 식당 간판 ("구글 로그인 가능"), client_secret = 직원 비밀 열쇠 |

### 3-13. account_status 4-state enum

| 상태 | 의미 | 비유 | 자동 배정 | wake-up |
|------|------|------|----------|---------|
| `active` | 정상, 쿼터 있음 | 건강한 직원 | ✅ | 조건부 |
| `protected` | Pro 쿼터 <20% | 과로 직원 | ❌ | ❌ |
| `forbidden` | 403 반환 | 해고된 직원 | ❌ | ❌ |
| `disabled` | 수동 비활성화 | 휴직 직원 | ❌ | ❌ |

---

## 3-14. Codex 세션 결과 (spec 문구/톤 결정)

| 항목 | 결정 |
|------|------|
| **quota 소스 문구** | 결정 게이트 (조건부): "wake-up이 state.vscdb를 갱신하면 → vscdb/LS에서 읽고, 아니면 → Cloud Code REST API 직접" |
| **대화 공유 태도** | 공유가 기본. 서버가 "이 대화는 다른 계정 건데?" 하고 거부할 수 있다는 가능성도 명시 |
| **계정 전환 문구** | 토큰 교체(inject) 중심으로 적기. "seamless"라는 말은 실험적으로만 |
| **quota 성공조건** | 출처별 증명형: "vscdb에서 읽든 REST API에서 읽든 결과가 같으면 OK" |
| **대화 공유 성공조건** | 연속성 우선: "계정을 바꿔도 대화 기록이 유지되어야 한다" |
| **spec 첫 문단 톤** | auth-only 리팩토링: "auth만 바꾸는 리팩토링"이 핵심 주제 |
| **성공조건 형태** | 주장+증명 쌍. 각 조건마다 증명 방법 명시 |
| **Seamless Switch** | Feature 5: 독립 섹션. spec 완성 전 조사 진행 |
| **Wake-up** | 기능+검증 둘 다. Pro 20% 미만=protected(자동 배정 금지, 24h→5day 패널티) |
| **마이그레이션 실패** | 경고 메시지 + 기존 user-data 방식 유지 (중단 없음) |
| **import-token** | 내부/이행 축. CLI 표면 논의 금지 (주인님 불쾌) |

---

## 4. 두 Spec에서 빠진 것 / 잘못된 것 (주인님 지적)

### 빠진 것

| 항목 | 설명 | 반영 |
|------|------|------|
| **Seamless Switch** | 두 spec 모두 NOT NOW. 주인님: "가장 중요한데 빠진 것 같다". | experimental로 포함 + 전면 조사 |
| **Wake-up** | GPT spec은 있지만 약함. | Opus 수준 상세화 |
| **등록 3종** | Opus NOT NOW에 import-token, import-local 빠짐. | OAuth 기본 + Local Import 내부 함수 + import-token 이행 축 |
| **v0.2.1 버전 번호** | 두 spec 모두 "Phase 2"로 표기. | v0.2.1로 명확화 |

### 잘못된 것

| 항목 | 설명 | 수정 |
|------|------|------|
| **Seamless Switch 개념** | Cockpit의 Full Switch = 앱 재시작. 우리는 백그라운드 LS. 개념이 다름. | 주인님 통찰 반영: "백그라운드라 더 쉬울 것" |
| **v0.3.0 버전** | 두 spec이 Phase 2 / v0.3.0 표기. | v0.2.1로 정정 (주인님 확인) |

---

## 5. 다음 단계

1. draft 파일 작성 (두 spec 비교표 + 빠진 항목 체크리스트)
2. 통합 spec 문서 작성 (skeleton → 내용 충원)
3. Metis + Momus 병렬 검증
4. 피드백 반영 + 재검증 (OKAY까지)
