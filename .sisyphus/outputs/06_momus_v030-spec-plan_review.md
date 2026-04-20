## Critical Issues
- 없음.

## Minor Issues
1. `§9-3` Task 5/6가 `pending-switch.json`을 applied record로 재정의하지만, 현재 replay 소비 지점인 `src/main.ts`의 `applyPendingSwitchIntentIfNeeded_func()`와 main pre-run 호출(line 2384)을 어디서 정리할지는 checklist에서 직접 찍어주지 않았다. 문서 본문과 성공조건만으로도 의도는 읽히지만, 구현 누락 방지를 위해 Task 5 또는 Task 6 참조에 이 지점을 한 줄 추가하면 더 안전하다.

## Approved Decisions
1. rotate 타이밍은 이번 버전에서 일관적이다. TL;DR, `§3-3`, `§5-1`, `§5-9`, `§5-12`, `§6-1`, checklist Task 6이 모두 “시작 전 선판단 금지, 응답 후 fresh read → crossing 판단 → same-run switch apply”로 맞춰졌다.
2. checklist의 모든 task에 Bash 기준 QA 시나리오가 붙었고, happy/negative path와 기대 결과까지 적혀 있어 Final Verification Wave를 실제로 돌릴 수 있다.
3. `seamlessSwitch.ts` 누락은 해소됐다. `§4-1`에서 현재 구현 축으로 명시했고, Task 7/10이 `src/services/seamlessSwitch.ts`와 `evaluateSeamlessSwitchFeasibility_func()`를 직접 참조한다.
4. `rotate.ts` 변경 지시는 충분히 구체적이다. Task 5가 `thresholdBucket_func`, `decideAutoRotate_func`, `PendingSwitchIntent`, `loadPendingSwitchIntent_func` / `savePendingSwitchIntent_func` / `clearPendingSwitchIntent_func`를 직접 찍고, 90% reset 제거 / `needs_reauth` 제외 / pre-post snapshot + fingerprint/serviceMachineId 메타 확장을 명시한다.
5. `auth refresh` 진입점, `auth list` selective refresh helper, migration/cutover, Offline-Gateway 최소동작경로, secret boundary도 구현 가능한 수준까지 내려왔다. 각각 Task 1, 3, 4, 10, 11이 파일 단위 참조와 QA를 함께 제공한다.
