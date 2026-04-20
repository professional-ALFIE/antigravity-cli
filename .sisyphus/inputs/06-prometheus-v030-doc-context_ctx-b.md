# v030 문서 컨텍스트 조사 B

먼저 `.sisyphus/mandate_v030-spec-plan.md`를 읽어라.

그 다음 아래 작업을 수행하라.

## 목표
- `handoff-plan-spec/` 아래 기존 v0.2.x 문서들과 `v0.3.0-01-handoff.md`를 비교해서,
- 최종 spec+plan 문서에 **반드시 흡수해야 할 역사적 맥락 / 빠질 위험이 큰 결정사항**을 정리한다.

## 조사 범위
- `v0.2.1-02-spec-gpt.md`
- `v0.2.1-02-spec-opus.md`
- `v0.2.1-02-handoff-gpt.md`
- `v0.2.1-01-plan-gpt-5.4.md`
- 필요 시 관련 조사 문서 1~2개 추가 참조

## 반드시 포함할 것
- v0.3.0 handoff에는 있는데 과거 문서와 연결 설명이 필요한 항목
- 과거 문서에는 있었는데 이번 handoff만 보면 빠질 수 있는 항목
- 용어/정책 충돌 지점
- spec 섹션으로 가야 할 항목 vs implementation plan 섹션으로 가야 할 항목 구분

## 출력 형식
- 결과는 `.sisyphus/outputs/NN_explore_v030-doc-context_ctx-b.md` 에 저장
- 응답은 한 줄로만:
  - `DONE | <output-file-path> | <핵심 한줄요약>`

## 언어
- 파일 내용은 한국어로 작성
