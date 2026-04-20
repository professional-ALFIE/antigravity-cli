# Draft: v030-spec-plan

## Requirements (confirmed)
- 출발 문서: `handoff-plan-spec/v0.3.0-01-handoff.md`
- 목표: v0.3.0용 spec + plan 문서 생성
- 누락 없는 맥락 반영 필수
- spec에는 성공조건 필수
- plan에는 checklist + 즉시 구현 가능한 구체 지시 필수

## Working Interpretation
- 사용자는 handoff를 재정리한 수준이 아니라, 바로 구현팀이 쓸 수 있는 정식 문서를 원함
- spec은 정책/동작/성공조건을 고정해야 함
- plan은 구현 순서와 체크리스트, 파일 수준 지시를 포함해야 함

## Research Findings
- 과거 v0.2.x 문서에서 계속 유지되는 중심 정책:
  - `auth refresh`는 전체 갱신, `auth list`는 카드 기반 빠른 조회
  - `wake-up`은 5h usage cycle 미시작 계정을 미리 깨워 다음 대기시간을 줄이는 기능
  - rotate는 턴 종료 후 pre/post quota 비교로 threshold crossing을 판단
  - `pending-switch.json`은 적용 기록이며 토큰 저장소가 아님
  - stale 또는 reset 경과 계정의 99% 보정 규칙은 유지 축
- 문서 구조 측면에서 가장 안전한 형태는 **통합 1문서 안에서 spec 섹션 / plan 섹션을 분리하는 방식**으로 보임
- 사용자가 원하는 “당장 구현 가능한 checklist”를 만족하려면 plan은 파일/모듈 reference를 포함해야 함

## User Answers Recorded
- 산출물 형식: 통합 1문서
- 성공조건 범위: 제품 동작 + 검증 기준 둘 다
- 계획 체크리스트: 파일/모듈 단위
- 과거 v0.2.x 문서는 최종 문서의 직접 근거로 쓰지 않음. 이미 현재 스크립트/코드에 반영된 맥락으로 간주
- `NOT NOW`: 명시적으로 포함
- 근거 표기: 본문 + 근거표 동시 제공
- 90% 회복 reset 규칙: 폐기
- 기준 family 기본값: CLAUDE
- `pending-switch.json`: 적용 기록
- wake-up 방식: LS 1턴 실행
- `auth list`: 즉시 표시 + 필요한 계정만 selective refresh
- `Offline-Gateway 제품화`, `fingerprint 자동화`는 사용자가 핵심이라고 봄 → 성급한 NOT NOW 처리 금지
- `list 전체 wake-up`은 오해였음 → 필요한 sleeping account만 wake-up
- `fingerprint`: auth login 때 만들어두고, switch 시 자동적용
- `serviceMachineId`: handoff 원문대로 switch 시 같이 맞추는 축으로 반영
- post-prompt rotate: 같은 실행 안에 즉시 적용
- `auth list` wake-up: handoff 원문대로 list 시점에 필요한 sleeping account만 수행
- 확실한 NOT NOW: 정책엔진/YAML

## New Findings From Reviews
- `auth refresh` 명령은 아직 실제 코드에 없음 → 신규 명령 표면 필요
- `accounts.ts`의 `AccountDetail`에는 이미 사실상 계정 카드 역할을 하는 구조가 있음
- `rotate.ts`는 새로 만들 대상이 아니라 확장 대상
- `wakeup.ts`는 후보 판정 유틸은 있지만 main.ts orchestration 연결이 없음
- main.ts는 현재 rotate를 응답 전에 수행함 → handoff 요구와 충돌
- source-of-truth / write-order / secret-boundary를 문서에 표로 못 박아야 함
- legacy storage → v0.3.0 storage cutover/rollback 섹션이 필요함
- command × runtime path × allowed side-effects 표가 필요함

## Critical Decisions Needed
- 남은 일은 질문이 아니라, 위 확정 정책을 spec 본문 / canonical table / checklist에 정확히 반영하는 것

## Scope Boundaries
- INCLUDE:
  - handoff 원문 핵심 주장
  - 현재 repo 코드/문서와의 연결 맥락
  - 성공조건
  - 구현 가능한 checklist 기반 plan
- EXCLUDE (현재 시점):
  - 실제 코드 구현
  - `.sisyphus/` 밖 문서 직접 작성

## Open Questions
- 이번 문서에서 `NOT NOW`에 넣을 구체 항목 목록은 무엇인가?
- 구현 지시에서 반드시 직접 참조할 코드 파일 범위를 어디까지 넓힐 것인가?
