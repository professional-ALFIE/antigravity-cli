# v030 문서 컨텍스트 조사 A

먼저 `.sisyphus/mandate_v030-spec-plan.md`를 읽어라.

그 다음 아래 작업을 수행하라.

## 목표
- `handoff-plan-spec/v0.3.0-01-handoff.md`를 기반으로 v0.3.0 spec+plan 문서를 만들 때,
- **빠질 수 있는 현재 코드베이스 맥락**을 최대한 회수한다.

## 조사 범위
- 현재 auth/quota/list/refresh/switch/wake-up/pending-switch 관련 실제 코드 위치
- 현재 구현과 handoff가 이미 일치하는 점 / 아직 없는 점 / 충돌하는 점
- 현재 `auth list`가 느린 이유와 관련된 실제 코드 경로
- 계정 카드, threshold bucket, pending-switch 기록과 연결될 수 있는 기존 저장/상태 파일 경로

## 반드시 포함할 것
- 파일 경로 + 왜 중요한지
- handoff의 어떤 주장과 연결되는지
- “이건 현재 코드에 이미 있음 / 없음 / 부분적으로만 있음” 구분
- v0.3.0 plan에서 반드시 구현 지시로 내려가야 할 모듈 후보

## 출력 형식
- 결과는 `.sisyphus/outputs/NN_explore_v030-doc-context_ctx-a.md` 에 저장
- 응답은 한 줄로만:
  - `DONE | <output-file-path> | <핵심 한줄요약>`

## 언어
- 파일 내용은 한국어로 작성
