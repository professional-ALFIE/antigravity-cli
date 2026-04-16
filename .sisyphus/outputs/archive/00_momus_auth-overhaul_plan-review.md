**[REJECT]**
**Summary**: 핵심 레퍼런스들은 실제로 존재하고, 각 Feature도 대체로 시작점이 충분합니다. 하지만 계정 전환의 기본 계약이 섹션마다 서로 달리고, 여러 QA 시나리오가 실행 가능한 수준으로 닫혀 있지 않아 그대로는 구현자가 마지막 동작과 검증 기준에서 막힙니다.

**Blocking Issues**
1. `.sisyphus/plans/00-plan-v0.2.1-auth-overhaul.md`의 Feature 2/3/5에서 switch 기본 경로가 서로 충돌합니다. §5-3은 live LS가 있으면 "재시작 필요"만 안내하고 inject만 수행하는 계약인데, §8-4는 Full Switch 기본 경로를 "LS kill → respawn"으로 정의합니다. `auth list` 선택, auto-rotate 후 적용, live attach 상황에서 기본 switch 동작을 하나로 고정하고, 어떤 경우에 자동 respawn을 하고 어떤 경우에 단순 inject+안내만 하는지 명시해야 구현자가 멈추지 않습니다.
2. 같은 파일의 QA 시나리오가 task 수준에서 실행 가능하게 닫혀 있지 않습니다. 예를 들어 A-1/A-6, R-5, SS-2는 도구·구체 절차·기대 결과가 부족하거나 "수동 E2E"/"테스트"로만 적혀 있어 Final Verification Wave를 바로 수행할 수 없습니다. 각 Feature의 검증 항목마다 사용할 도구/명령(예: `bun test`, mock server, `sqlite3`, 실제 CLI invocation), 재현 절차, 기대 출력·상태를 명시해야 합니다.
