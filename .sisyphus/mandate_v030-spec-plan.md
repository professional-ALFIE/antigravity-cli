# Mandate: v030-spec-plan

## 현재 목표
- `handoff-plan-spec/v0.3.0-01-handoff.md`를 출발점으로 읽고,
- **빠진 맥락 없이** v0.3.0용 **spec + plan 통합 문서**를 만든다.

## 사용자 요구사항 (확정)
- 결과물은 v0.3.0으로 가기 위한 문서여야 한다.
- handoff 문서는 "주로 spec 느낌"이므로, 최종 결과물은 handoff를 재정리한 **정식 spec + 구현 plan 문서**여야 한다.
- **빠진 맥락이 있으면 안 된다.**
- spec에는 반드시 **성공조건**이 들어가야 한다.
- plan에는 **checklist**가 있어야 한다.
- plan은 **당장 구현 가능한 수준의 구체적 구현 지시서**여야 한다.

## 사용자 최신 응답 반영
- 문서 형태: `spec 섹션 + plan 섹션`을 한 문서에 통합
- 성공조건 범위: 제품 acceptance + 구현 verification 둘 다 포함
- 체크리스트 세밀함: 기능 단위가 아니라 파일/모듈 단위
- 과거 v0.2.x 문서는 최종 문서의 직접 근거로 삼지 않는다. 이미 스크립트/현행 코드에 반영된 현재 맥락만 사용한다.
- 90% 회복 시 bucket reset 규칙은 **폐기**한다.
- effective family 기본값은 **CLAUDE**로 둔다.
- `pending-switch.json`은 **적용 기록**으로 고정한다.
- wake-up의 실제 실행 방식은 **대상 계정으로 LS 1턴 실행**을 기본값으로 둔다.
- `auth list`는 **즉시 표시 + 필요한 계정만 소수 selective refresh** 방향으로 간다.
- `Offline-Gateway 제품화`, `fingerprint 자동화`는 성급히 NOT NOW로 잠그지 않는다.
- `list 전체 wake-up`은 잘못된 표현이었다. 정확한 방향은 **필요한 sleeping account만 wake-up**이다.
- `fingerprint`는 **auth login 때 만들어두고**, switch 시 **자동 적용**한다.
- `serviceMachineId`도 handoff 원문대로 switch 시 함께 맞추는 축으로 반영한다.
- post-prompt rotate는 **같은 실행 안에서 즉시 적용**한다.
- `auth list`의 sleeping account wake-up은 handoff 원문대로 **list 시점에 필요한 대상만** 수행한다.
- 확실한 `NOT NOW`는 현재 기준으로 **정책엔진/YAML**만 우선 잠근다.

## 사용자 추가 응답 (2026-04-17, handoff A~N 기준)

### 핵심 scope 변경
- **fingerprint 자동화**: 이번 v0.3.0에 **포함**. 생성+적용 파이프라인 전체.
  - auth login 때 fingerprint 미리 생성
  - switch 때 fingerprint 자동 적용
  - **cockpit에서 로직을 그대로 가져와서** 구현 (copy-paste 수준)
- **Offline-Gateway 최소 동작경로**: 이번 v0.3.0에 **포함**.
  - 로컬 fast-path 활성화: live LS 상태 읽기 + state.vscdb fast-path를 offline-only에서도 사용 가능하게
  - **antigravity-cli의 offline-only 방식 + cockpit의 ClientGateway 방식의 장점을 합친 것**
  - IDE 없이 LS를 직접 띄우면서도 UI에 surfaced되는 경로
- **NOT NOW 재확정**: 정책엔진/YAML만 잠금. fingerprint, Offline-Gateway는 NOT NOW에서 제외.

## 현재 작업 상태
- 작성된 문서: `.sisyphus/plans/01-plan-v030-auth-rotate.md` (4차 Metis+Momus 승인 완료)
- **scope 누락 발견**: fingerprint 자동화 + Offline-Gateway 최소 동작경로가 handoff에는 포함이나 plan에서 제외됨
- 현재: plan에 누락된 2개 feature Task 추가 + 재검증 필요

## 현재 열린 질문
- 추가 요구사항 질문 종료. 남은 일은 **누락된 2개 feature를 plan에 추가하고 재검증**하는 것.
