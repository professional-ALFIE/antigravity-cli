# `--resume` 전체 UUID 출력 + 인스턴스 없을 때 백그라운드 자동 실행

## 문제

1. `--resume` 목록에서 UUID가 8자로 잘림 → 복사해서 `--resume <id>` 불가
2. 매칭 인스턴스 없으면 에러만 → 자동으로 **백그라운드**에서 Antigravity 띄워야 함

---

## Proposed Changes

### Feature 1: 전체 UUID 출력

#### [MODIFY] `packages/cli/src/resume-list.ts`

Line 80: `.slice(0, 8)` 제거

```diff
-      return `${cascade_id_var.slice(0, 8)}  ${summary_var}`;
+      return `${cascade_id_var}  ${summary_var}`;
```

---

### Feature 2: 백그라운드 자동 실행

#### 왜 `open` 플래그로는 안 되는가

macOS `open` 명령의 `-g`(background), `-j`(hidden), `-jg`(둘 다)를 로컬에서 직접 테스트한 결과:

| 플래그 | Antigravity 실행 중 | Antigravity 미실행 (cold start) |
|--------|---------------------|-------------------------------|
| `open -g` | 창이 뒤에 뜨긴 하나 보장 못함 | ❌ Electron이 self-activate → 창 앞으로 |
| `open -j` | ❌ 이미 실행 중인 앱을 앞으로 가져옴 | ❌ Electron self-activate |
| `open -jg` | ❌ 위 두 문제 모두 해당 | ❌ 동일 |
| AppleScript `launch` | — | ❌ `frontmost=true`로 올라옴 |

원인: `open` 플래그는 macOS LaunchServices **힌트**일 뿐이고, Electron(VS Code 포크)은 시작 과정에서 스스로 `activate()`를 호출하므로 OS 힌트를 무시함.

Extension API로도 불가: `vscode.window`는 에디터/패널 등 **내부 UI**만 제어. 메인 윈도우의 최소화/숨기기 API는 VS Code에 존재하지 않음. GitHub에서도 반복적으로 out-of-scope로 닫힘.

#### 해결: Swift 네이티브 바이너리 (`ag-minimize`) — ✅ 로컬 검증 완료

macOS Accessibility API(`AXUIElement`)를 사용하여 새 창이 뜨는 즉시 화면 밖 이동 + 최소화.

로컬 테스트 결과:
- VS Code로 검증 완료
- 컴파일된 바이너리: **~50ms** (1ms 폴링)
- `swift` 인터프리터: **300ms~1,700ms** (매번 컴파일 오버헤드)
- → **빌드 필수**, 인터프리터 모드는 깜빡임 발생

#### 핵심: 새로 생긴 창만 최소화 — ✅ 로컬 검증 완료

사용자가 A 작업영역에서 Antigravity를 사용 중일 때, CLI로 B 작업영역을 소환하면:
- B 창만 최소화되어야 함
- A 창은 그대로 유지되어야 함 (포커스, 위치, 크기 모두 변경 없음)

방식: **윈도우 타이틀 기반 스냅샷 비교** (`kAXTitleAttribute`)
1. 실행 시점에 앱의 현재 윈도우 타이틀 집합 스냅샷
2. 폴링하며 스냅샷에 없는 타이틀의 **새 창**만 감지
3. 새 창에 대해서만 `position = {-9999, -9999}` → `minimized = true`
4. 기존 창은 절대 건드리지 않음

검증 시나리오:
- ✅ 기존 창(A) 열려있는 상태에서 새 창(B) 열기 → B만 최소화, A 유지
- ✅ 앱 미실행 상태에서 cold start → 스냅샷 0개 → 새 창 최소화
- ✅ 컴파일된 바이너리 50ms 내 반응

#### [NEW] `packages/cli/native/ag-minimize.swift`

검증된 구현 (`/tmp/ag-minimize-v2.swift` 기반):

```swift
import Cocoa

let target = CommandLine.arguments[1]  // "Antigravity" 또는 "Code"

// 1. 기존 윈도우 타이틀 스냅샷
func getTitle(_ w: AXUIElement) -> String? { /* kAXTitleAttribute */ }
func getWindows(pid: pid_t) -> [AXUIElement] { /* kAXWindowsAttribute */ }

var snapshotTitles = Set<String>()  // 기존 창 타이틀 기록

// 2. 1ms 폴링 — 새 창 감지
while Date() < deadline {
    for w in getWindows(pid) {
        guard let title = getTitle(w) else { continue }
        if snapshotTitles.contains(title) { continue }  // 기존 창 → skip
        // 새 창 → 화면 밖 이동 + 최소화
        setPosition(w, {-9999, -9999})
        setMinimized(w, true)
        exit(0)
    }
    usleep(1_000)
}
```

#### 바이너리 배포 방식: Prebuilt + Fallback

첫 실행 체감 속도가 중요하므로, 설치 훅(postinstall)이나 lazy build 단독에 의존하지 않음.

- Bun은 보안상 postinstall을 기본 차단 (trustedDependencies 필요)
- npm@7 이후도 글로벌 설치 시 postinstall 불안정 보고 있음
- lazy build만 쓰면 첫 실행 시 `swiftc` 컴파일 대기 (1~2초) 발생

배포 구조:

```
packages/cli/
├── native/
│   └── ag-minimize.swift          # 소스 (항상 포함)
├── bin-native/
│   └── ag-minimize-darwin-universal  # prebuilt universal binary (arm64 + x86_64)
```

빌드 명령 (배포 전 1회):
```bash
swiftc -O -target arm64-apple-macosx11.0  native/ag-minimize.swift -o ag-minimize-arm64
swiftc -O -target x86_64-apple-macosx11.0 native/ag-minimize.swift -o ag-minimize-x86_64
lipo -create ag-minimize-arm64 ag-minimize-x86_64 -output bin-native/ag-minimize-darwin-universal
```

런타임 바이너리 탐색 순서:
1. `~/.antigravity-cli/bin/ag-minimize` (캐시) → 있으면 즉시 실행
2. `packages/cli/bin-native/ag-minimize-darwin-universal` (prebuilt) → 캐시에 복사 후 실행
3. 둘 다 없으면 → `swiftc`로 빌드 → 캐시에 저장 (최초 1회, 이후 재사용)

#### [NEW] `packages/cli/src/auto-launch.ts`

핵심 흐름:

```
discoverInstance() 실패 (매칭 인스턴스 없음)
  ↓
ag-minimize <앱이름> 백그라운드 실행 (기존 창 스냅샷 포함)
  ↓
antigravity <workspace> 실행
  ↓
instances.json 폴링 (500ms 간격, 30초 타임아웃) — Bridge 포트 대기
  ↓
Bridge 포트 획득 → BridgeClient 생성 → 원래 명령 계속 실행
```

함수:
- `ensureMinimizeBinary_func()` — 바이너리 탐색 (캐시 → prebuilt → fallback 빌드)
- `launchAntigravityBackground_func(workspace)` — `ag-minimize` + `antigravity` 동시 실행
- `waitForBridge_func(workspace, timeout)` — `instances.json` 폴링, Bridge 포트 반환

#### [MODIFY] `packages/cli/src/root-mode.ts`

`discoverInstance()` 실패 시 → `launchAntigravityBackground_func` → `waitForBridge_func` → 원래 로직 계속

#### [MODIFY] `packages/cli/src/helpers.ts`

`getClient()` 내부에서도 동일하게 discovery 실패 시 auto-launch 재시도

---

## 주의사항

- `ag-minimize`는 macOS **접근성 권한**이 필요함. 처음 실행 시 "터미널이 이 컴퓨터를 제어하도록 허용하시겠습니까?" 팝업이 뜸 → 허용 필요
- 현재 macOS 전용. Linux/Windows 지원이 필요하면 별도 구현 필요
- prebuilt universal binary 크기는 수십 KB 수준 (Swift 런타임은 macOS에 내장)

---

## Verification Plan

### 자동 테스트
- `phase10.test.ts` UUID 기대값 전체로 변경
- auto-launch 단위 테스트 (mock spawn, mock instances.json)

### 수동 검증
1. `--resume` → 전체 UUID 확인
2. **A 작업영역 사용 중 + B 작업영역 CLI 소환** → B만 최소화, A 그대로 유지 ✅ 검증됨
3. Antigravity 종료 상태 → 실행 + 즉시 최소화, Bridge 연결 후 대화 생성 ✅ 검증됨
4. prebuilt 바이너리 → 첫 실행 50ms 이내
5. prebuilt 없는 환경 → fallback 빌드 후 캐시, 두 번째부터 50ms 이내
