import Cocoa
import ApplicationServices
import Foundation

struct LaunchConfig_struct {
    let bundle_id_var: String
    let launch_bin_var: String
    let workspace_path_var: String
    let poll_ms_var: UInt32
    let timeout_ms_var: UInt32
}

struct AXWindowSnapshot_struct {
    let element_var: AXUIElement
    let title_var: String
    let x_var: Double
    let y_var: Double
    let width_var: Double
    let height_var: Double

    var signature_var: String {
        return "\(title_var)|\(Int(x_var))|\(Int(y_var))|\(Int(width_var))|\(Int(height_var))"
    }
}

struct CGWindowInfo_struct {
    let number_var: Int
    let title_var: String
    let x_var: Double
    let y_var: Double
    let width_var: Double
    let height_var: Double
}

func fail_func(_ exit_code_var: Int32, _ message_var: String) -> Never {
    fputs(message_var + "\n", stderr)
    exit(exit_code_var)
}

func requireValue_func(_ args_var: [String], _ index_var: inout Int) -> String {
    index_var += 1
    if index_var >= args_var.count {
        fail_func(2, "missing value")
    }
    return args_var[index_var]
}

func parseArguments_func() -> LaunchConfig_struct {
    let args_var = CommandLine.arguments
    var bundle_id_var: String?
    var launch_bin_var: String?
    var workspace_path_var: String?
    var poll_ms_var: UInt32 = 1
    var timeout_ms_var: UInt32 = 2000

    var index_var = 1
    while index_var < args_var.count {
        switch args_var[index_var] {
        case "--bundle-id":
            bundle_id_var = requireValue_func(args_var, &index_var)
        case "--launch-bin":
            launch_bin_var = requireValue_func(args_var, &index_var)
        case "--workspace":
            workspace_path_var = requireValue_func(args_var, &index_var)
        case "--poll-ms":
            let value_var = requireValue_func(args_var, &index_var)
            poll_ms_var = UInt32(value_var) ?? 1
        case "--timeout-ms":
            let value_var = requireValue_func(args_var, &index_var)
            timeout_ms_var = UInt32(value_var) ?? 2000
        default:
            fail_func(2, "unknown option: \(args_var[index_var])")
        }

        index_var += 1
    }

    guard let bundle_id_var, let launch_bin_var, let workspace_path_var else {
        fail_func(2, "required: --bundle-id --launch-bin --workspace")
    }

    return LaunchConfig_struct(
        bundle_id_var: bundle_id_var,
        launch_bin_var: launch_bin_var,
        workspace_path_var: workspace_path_var,
        poll_ms_var: max(1, poll_ms_var),
        timeout_ms_var: max(1, timeout_ms_var)
    )
}

func hasAccessibilityPermission_func() -> Bool {
    let options_var = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    return AXIsProcessTrustedWithOptions(options_var)
}

func runningApps_func(bundle_id_var: String) -> [NSRunningApplication] {
    return NSRunningApplication.runningApplications(withBundleIdentifier: bundle_id_var)
        .filter { $0.processIdentifier > 0 }
}

func pidSet_func(_ apps_var: [NSRunningApplication]) -> Set<pid_t> {
    return Set(apps_var.map(\.processIdentifier))
}

func windowTitle_func(_ window_var: AXUIElement) -> String? {
    var title_ref_var: CFTypeRef?
    let result_var = AXUIElementCopyAttributeValue(window_var, kAXTitleAttribute as CFString, &title_ref_var)
    guard result_var == .success, let title_var = title_ref_var as? String, !title_var.isEmpty else {
        return nil
    }
    return title_var
}

func pointAttribute_func(_ window_var: AXUIElement, _ attribute_var: CFString) -> CGPoint? {
    var value_ref_var: CFTypeRef?
    let result_var = AXUIElementCopyAttributeValue(window_var, attribute_var, &value_ref_var)
    guard result_var == .success, let value_var = value_ref_var else {
        return nil
    }

    let ax_value_var = unsafeBitCast(value_var, to: AXValue.self)
    var point_var = CGPoint.zero
    guard AXValueGetValue(ax_value_var, .cgPoint, &point_var) else {
        return nil
    }
    return point_var
}

func sizeAttribute_func(_ window_var: AXUIElement) -> CGSize? {
    var value_ref_var: CFTypeRef?
    let result_var = AXUIElementCopyAttributeValue(window_var, kAXSizeAttribute as CFString, &value_ref_var)
    guard result_var == .success, let value_var = value_ref_var else {
        return nil
    }

    let ax_value_var = unsafeBitCast(value_var, to: AXValue.self)
    var size_var = CGSize.zero
    guard AXValueGetValue(ax_value_var, .cgSize, &size_var) else {
        return nil
    }
    return size_var
}

func axSnapshot_func(_ window_var: AXUIElement) -> AXWindowSnapshot_struct? {
    guard let title_var = windowTitle_func(window_var) else {
        return nil
    }

    let point_var = pointAttribute_func(window_var, kAXPositionAttribute as CFString) ?? .zero
    let size_var = sizeAttribute_func(window_var) ?? .zero

    return AXWindowSnapshot_struct(
        element_var: window_var,
        title_var: title_var,
        x_var: point_var.x,
        y_var: point_var.y,
        width_var: size_var.width,
        height_var: size_var.height
    )
}

func axWindows_func(pid_var: pid_t) -> [AXWindowSnapshot_struct] {
    let application_ref_var = AXUIElementCreateApplication(pid_var)
    var windows_ref_var: CFTypeRef?
    let result_var = AXUIElementCopyAttributeValue(application_ref_var, kAXWindowsAttribute as CFString, &windows_ref_var)
    guard result_var == .success, let windows_var = windows_ref_var as? [AXUIElement] else {
        return []
    }

    return windows_var.compactMap(axSnapshot_func)
}

func cgWindows_func(pid_set_var: Set<pid_t>) -> [CGWindowInfo_struct] {
    guard !pid_set_var.isEmpty else {
        return []
    }

    let options_var: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let raw_windows_var = CGWindowListCopyWindowInfo(options_var, kCGNullWindowID) as? [[String: Any]] else {
        return []
    }

    return raw_windows_var.compactMap { raw_window_var in
        guard let owner_pid_var = raw_window_var[kCGWindowOwnerPID as String] as? pid_t,
              pid_set_var.contains(owner_pid_var),
              let window_number_var = raw_window_var[kCGWindowNumber as String] as? Int,
              let bounds_var = raw_window_var[kCGWindowBounds as String] as? [String: CGFloat] else {
            return nil
        }

        let width_var = bounds_var["Width"] ?? 0
        let height_var = bounds_var["Height"] ?? 0
        if width_var <= 0 || height_var <= 0 {
            return nil
        }

        let x_var = bounds_var["X"] ?? 0
        let y_var = bounds_var["Y"] ?? 0
        let title_var = (raw_window_var[kCGWindowName as String] as? String) ?? ""

        return CGWindowInfo_struct(
            number_var: window_number_var,
            title_var: title_var,
            x_var: Double(x_var),
            y_var: Double(y_var),
            width_var: Double(width_var),
            height_var: Double(height_var)
        )
    }
}

func distance_func(_ left_var: AXWindowSnapshot_struct, _ right_var: CGWindowInfo_struct) -> Double {
    let title_penalty_var: Double
    if right_var.title_var.isEmpty || left_var.title_var.isEmpty || left_var.title_var == right_var.title_var {
        title_penalty_var = 0
    } else {
        title_penalty_var = 100_000
    }

    return title_penalty_var
        + abs(left_var.x_var - right_var.x_var)
        + abs(left_var.y_var - right_var.y_var)
        + abs(left_var.width_var - right_var.width_var)
        + abs(left_var.height_var - right_var.height_var)
}

func matchWindow_func(
    cg_window_var: CGWindowInfo_struct,
    candidates_var: [AXWindowSnapshot_struct],
) -> AXWindowSnapshot_struct? {
    return candidates_var.min { left_var, right_var in
        distance_func(left_var, cg_window_var) < distance_func(right_var, cg_window_var)
    }
}

func setWindowPosition_func(_ window_var: AXUIElement, _ x_var: Double, _ y_var: Double) -> Bool {
    var point_var = CGPoint(x: x_var, y: y_var)
    guard let value_var = AXValueCreate(.cgPoint, &point_var) else {
        return false
    }

    return AXUIElementSetAttributeValue(window_var, kAXPositionAttribute as CFString, value_var) == .success
}

func setWindowMinimized_func(_ window_var: AXUIElement) -> Bool {
    return AXUIElementSetAttributeValue(window_var, kAXMinimizedAttribute as CFString, kCFBooleanTrue) == .success
}

func launchWorkspace_func(config_var: LaunchConfig_struct) -> Bool {
    let process_var = Process()
    process_var.executableURL = URL(fileURLWithPath: config_var.launch_bin_var)
    process_var.arguments = ["-n", "--disable-workspace-trust", config_var.workspace_path_var]
    process_var.standardOutput = Pipe()
    process_var.standardError = Pipe()

    do {
        try process_var.run()
        return true
    } catch {
        return false
    }
}

func sleepPoll_func(_ poll_ms_var: UInt32) {
    usleep(useconds_t(poll_ms_var * 1_000))
}

let config_var = parseArguments_func()

if !hasAccessibilityPermission_func() {
    fail_func(10, "macOS 접근성 권한이 필요합니다.")
}

let initial_apps_var = runningApps_func(bundle_id_var: config_var.bundle_id_var)
if initial_apps_var.isEmpty {
    fail_func(11, "실행 중인 Antigravity 앱이 없습니다.")
}

let cg_snapshot_var = Set(cgWindows_func(pid_set_var: pidSet_func(initial_apps_var)).map(\.number_var))
let ax_snapshot_var = Set(
    initial_apps_var
        .flatMap { axWindows_func(pid_var: $0.processIdentifier) }
        .map(\.signature_var)
)

if !launchWorkspace_func(config_var: config_var) {
    fail_func(12, "새 작업영역 창 생성에 실패했습니다.")
}

let deadline_var = Date().addingTimeInterval(TimeInterval(config_var.timeout_ms_var) / 1000.0)
var saw_new_window_var = false

while Date() < deadline_var {
    let current_apps_var = runningApps_func(bundle_id_var: config_var.bundle_id_var)
    let current_pid_set_var = pidSet_func(current_apps_var)
    let current_cg_windows_var = cgWindows_func(pid_set_var: current_pid_set_var)
    let new_cg_windows_var = current_cg_windows_var.filter { !cg_snapshot_var.contains($0.number_var) }

    if !new_cg_windows_var.isEmpty {
        saw_new_window_var = true
        let current_ax_windows_var = current_apps_var
            .flatMap { axWindows_func(pid_var: $0.processIdentifier) }
            .filter { !ax_snapshot_var.contains($0.signature_var) }

        for cg_window_var in new_cg_windows_var.sorted(by: { $0.number_var > $1.number_var }) {
            guard let matched_window_var = matchWindow_func(
                cg_window_var: cg_window_var,
                candidates_var: current_ax_windows_var
            ) else {
                continue
            }

            let _ = setWindowPosition_func(matched_window_var.element_var, -9999, -9999)
            if setWindowMinimized_func(matched_window_var.element_var) {
                exit(0)
            }
        }
    }

    sleepPoll_func(config_var.poll_ms_var)
}

if saw_new_window_var {
    fail_func(14, "새 창은 찾았지만 최소화에 실패했습니다.")
}

fail_func(13, "새 창을 시간 안에 찾지 못했습니다.")
