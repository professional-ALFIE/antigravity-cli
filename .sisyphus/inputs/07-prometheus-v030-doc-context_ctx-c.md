# v030 문서 구조/구현지시 조사 C

먼저 `.sisyphus/mandate_v030-spec-plan.md`를 읽어라.

그 다음 아래 작업을 수행하라.

## 목표
- 사용자가 요구한 “spec + 성공조건 + checklist 있는 plan + 당장 구현 가능한 구체 지시”를 만족하려면,
- 최종 문서 구조가 어떻게 되어야 하는지 제안한다.

## 조사 범위
- 현재 repo 구조 (`src/`, `services/`, `utils/`, `handoff-plan-spec/`, README)
- handoff의 각 항목을 실제 구현 단위로 내릴 때 어떤 파일/모듈 수준으로 쪼개야 하는지
- spec과 plan을 한 문서로 합칠지 / 둘로 나눌지 판단 근거

## 반드시 포함할 것
- 추천 문서 구조안 (섹션 트리)
- 왜 그 구조가 “빠진 맥락 없음” 요구를 만족하는지
- plan checklist가 추상어가 되지 않기 위해 필요한 granularity 규칙
- 구현 지시를 내릴 때 최소로 필요한 파일/모듈 reference 목록

## 출력 형식
- 결과는 `.sisyphus/outputs/NN_explore_v030-doc-context_ctx-c.md` 에 저장
- 응답은 한 줄로만:
  - `DONE | <output-file-path> | <핵심 한줄요약>`

## 언어
- 파일 내용은 한국어로 작성
