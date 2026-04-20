**[REJECT]**
**Summary**: 계획의 대부분은 구현에 바로 들어갈 수 있을 정도로 구체적이지만, 현재 기준으로는 pending-switch 의미 전환과 wake-up 계정 경로 전제가 task 정의에 제대로 반영되지 않았고, Final Verification Wave의 한 delegation category도 실행 환경과 맞지 않아 그대로는 막힙니다.

**Blocking Issues**
1. `src/main.ts:1028-1052`, `src/main.ts:2383-2394`는 아직 `pending-switch.json`을 “다음 실행 시 소비할 intent”로 읽고 적용/삭제합니다. 그런데 계획은 SC-7과 Task 8에서 이 파일을 “즉시 적용된 switch의 기록”으로 재정의합니다. Task 8 또는 Task 9에 startup consumer(`applyPendingSwitchIntentIfNeeded_func`)를 제거/대체하고, 기록 파일로 남길지 소비 파일로 유지할지를 한쪽으로 고정하는 변경을 명시해야 합니다.
2. `src/services/accounts.ts:468-477`는 store-backed account에 대해 모든 `userDataDirPath`를 `defaultDataDir`로 반환합니다. 그런데 Task 5의 wake-up은 이 경로로 `open -n -a Antigravity --args --user-data-dir=<abs>`를 실행하므로, managed account를 정확히 깨우려면 먼저 이 경로 버그가 수정돼야 합니다. 계획 본문에는 “이 수정은 Task 1에 포함”이라고 적혀 있지만, 실제 Task 1의 What to do / Acceptance Criteria / Commit 범위에는 빠져 있으니 Task 1(또는 별도 task)에 명시적으로 넣어야 합니다.
3. Final Verification Wave의 F1이 `oracle` category를 사용하도록 되어 있는데, 이 실행 계획이 전제하는 delegation category 목록에는 `oracle`이 없습니다. Final wave가 실제로 돌아가도록 F1 category를 허용된 category(예: `deep`, `unspecified-high`)로 바꾸고 동일 QA 절차를 다시 연결해야 합니다.
