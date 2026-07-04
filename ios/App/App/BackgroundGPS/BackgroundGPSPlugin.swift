import Capacitor
import CoreLocation
import Foundation
import UIKit

/// iOS implementation of the `BackgroundGPS` Capacitor plugin, matching the
/// platform-neutral TS contract in `src/plugins/BackgroundGPS.ts`. The shared
/// JS layer (CapacitorGPSProvider) is unchanged: every fix is written to a
/// SQLite buffer and drained in timestamp order; the `locationUpdate` event is
/// only a wakeup.
///
/// iOS differs from Android by design (see the iOS-port plan):
/// - No foreground service / notification — iOS shows the system location
///   indicator, so `setNotificationText` is a no-op.
/// - No Doze, so no AlarmManager watchdog and no per-fix wake lock: an active
///   standard-location request keeps the app alive and delivering fixes.
/// - `setScreenBrightness` is a no-op (iOS brightness is system-wide, not
///   per-window) and `getScreenOffTimeout` returns -1 (no API).
/// - Power "interval" is emulated: iOS has no time-interval knob, so passive
///   cadence is a timer gate on SQLite inserts while the manager stays at best
///   accuracy.
@objc(BackgroundGPSPlugin)
public class BackgroundGPSPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
  public let identifier = "BackgroundGPSPlugin"
  public let jsName = "BackgroundGPS"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "startTracking", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "stopTracking", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "getRecordedPoints", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "pruneRecordedPoints", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "setPowerMode", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "setNotificationText", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "isTracking", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "keepScreenOn", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "allowScreenOff", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "setScreenBrightness", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "getScreenOffTimeout", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "openDisplaySettings", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "appendDiag", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "readDiag", returnType: CAPPluginReturnPromise),
  ]

  private let manager = CLLocationManager()
  private let db = TrackDatabase()

  private var tracking = false
  private var passive = false
  private var activeIntervalMs: Double = 1000
  private var passiveIntervalMs: Double = 15000
  /// Last fix written while in passive mode (ms). Used to gate the cadence.
  private var lastPassiveInsertMs: Int64 = 0
  /// Native deferred active→passive transition (JS timers are suspended when
  /// the WebView is backgrounded, so the grace delay must live here).
  private var graceTimer: DispatchSourceTimer?

  /// Drop fixes worse than this — the backstop against coarse/cell fixes.
  /// Mirrors MAX_ACCURACY_M on the Android side and in TrackRecorder.ts.
  private let maxAccuracyM: Double = 30
  /// Reject obviously-stale cached fixes iOS sometimes delivers first.
  private let maxFixAgeMs: Double = 5000

  override public func load() {
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBest
    manager.distanceFilter = kCLDistanceFilterNone
    manager.activityType = .otherNavigation
    // Critical for marine use: without this iOS silently pauses updates when
    // it decides the vessel is "stationary" (anchored / drifting slowly).
    manager.pausesLocationUpdatesAutomatically = false
    manager.allowsBackgroundLocationUpdates = true
    manager.showsBackgroundLocationIndicator = true
  }

  // MARK: - Tracking lifecycle

  @objc func startTracking(_ call: CAPPluginCall) {
    DispatchQueue.main.async {
      self.ensureAuthorization()
      self.tracking = true
      self.manager.startUpdatingLocation()
      DiagLog.append(tag: "svc", message: "startTracking")
      call.resolve()
    }
  }

  @objc func stopTracking(_ call: CAPPluginCall) {
    DispatchQueue.main.async {
      self.cancelGrace()
      self.tracking = false
      self.manager.stopUpdatingLocation()
      DiagLog.append(tag: "svc", message: "stopTracking")
      call.resolve()
    }
  }

  @objc func isTracking(_ call: CAPPluginCall) {
    call.resolve(["tracking": tracking])
  }

  private func ensureAuthorization() {
    switch manager.authorizationStatus {
    case .notDetermined:
      manager.requestWhenInUseAuthorization()
    case .authorizedWhenInUse:
      // Escalate to Always so recording continues with the screen off.
      manager.requestAlwaysAuthorization()
    default:
      break
    }
  }

  public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    if manager.authorizationStatus == .authorizedWhenInUse {
      manager.requestAlwaysAuthorization()
    }
  }

  // MARK: - Power mode

  @objc func setPowerMode(_ call: CAPPluginCall) {
    let mode = call.getString("mode") ?? "active"
    let interval = call.getDouble("intervalMs")
    let grace = call.getDouble("graceMs") ?? 0

    if mode == "passive" {
      if let interval = interval { passiveIntervalMs = interval }
      if grace > 0 {
        schedulePassive(afterMs: grace)
      } else {
        applyPassive()
      }
    } else {
      if let interval = interval { activeIntervalMs = interval }
      cancelGrace()
      applyActive()
    }
    call.resolve()
  }

  private func applyActive() {
    passive = false
    DiagLog.append(tag: "svc", message: "mode active")
  }

  private func applyPassive() {
    passive = true
    lastPassiveInsertMs = 0
    DiagLog.append(tag: "svc", message: "mode passive interval=\(passiveIntervalMs)")
  }

  private func schedulePassive(afterMs: Double) {
    cancelGrace()
    let timer = DispatchSource.makeTimerSource(queue: .main)
    timer.schedule(deadline: .now() + .milliseconds(Int(afterMs)))
    timer.setEventHandler { [weak self] in
      self?.graceTimer = nil
      self?.applyPassive()
    }
    timer.resume()
    graceTimer = timer
  }

  private func cancelGrace() {
    graceTimer?.cancel()
    graceTimer = nil
  }

  // MARK: - Location delegate

  public func locationManager(
    _ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]
  ) {
    let nowMs = Date().timeIntervalSince1970 * 1000
    for loc in locations {
      // Accuracy backstop: negative = invalid, large = coarse/cell fix.
      if loc.horizontalAccuracy < 0 || loc.horizontalAccuracy > maxAccuracyM {
        DiagLog.append(tag: "fix", message: "drop acc=\(loc.horizontalAccuracy)")
        continue
      }
      let tsMs = Int64(loc.timestamp.timeIntervalSince1970 * 1000)
      // Skip stale cached fixes delivered on warmup.
      if nowMs - Double(tsMs) > maxFixAgeMs {
        DiagLog.append(tag: "fix", message: "drop stale ageMs=\(Int(nowMs - Double(tsMs)))")
        continue
      }

      // Passive cadence: gate inserts to the passive interval. The manager
      // stays at best accuracy (keeps the chip warm); we just thin what we
      // record. Always record the first fix after entering passive.
      if passive {
        if lastPassiveInsertMs != 0
          && Double(tsMs - lastPassiveInsertMs) < passiveIntervalMs
        {
          continue
        }
        lastPassiveInsertMs = tsMs
      }

      let point = TrackDatabase.Point(
        timestamp: tsMs,
        lat: loc.coordinate.latitude,
        lon: loc.coordinate.longitude,
        speed: loc.speed >= 0 ? loc.speed : -1,
        course: loc.course >= 0 ? loc.course : -1,
        accuracy: loc.horizontalAccuracy >= 0 ? loc.horizontalAccuracy : -1
      )
      db.insert(point)
      DiagLog.append(
        tag: "fix",
        message: "ok acc=\(String(format: "%.1f", loc.horizontalAccuracy)) passive=\(passive)")

      // Active mode: wake the JS drain. Passive stays silent (parity with the
      // Android service clearing its listener); JS drains on visibilitychange.
      if !passive {
        notifyListeners(
          "locationUpdate",
          data: [
            "timestamp": Int(tsMs),
            "lat": point.lat,
            "lon": point.lon,
            "speed": point.speed,
            "course": point.course,
            "accuracy": point.accuracy,
          ])
      }
    }
  }

  // MARK: - Buffer access

  @objc func getRecordedPoints(_ call: CAPPluginCall) {
    let since = Int64(call.getDouble("sinceTimestamp") ?? 0)
    let points = db.getSince(since)
    let arr: [[String: Any]] = points.map { p in
      [
        "timestamp": Int(p.timestamp),
        "lat": p.lat,
        "lon": p.lon,
        "speed": p.speed,
        "course": p.course,
        "accuracy": p.accuracy,
      ]
    }
    call.resolve(["points": arr])
  }

  @objc func pruneRecordedPoints(_ call: CAPPluginCall) {
    let before = Int64(call.getDouble("beforeTimestamp") ?? 0)
    db.pruneBefore(before)
    call.resolve()
  }

  // MARK: - Screen / notification shims

  @objc func setNotificationText(_ call: CAPPluginCall) {
    // No foreground-service notification on iOS; the OS shows the location
    // indicator instead.
    call.resolve()
  }

  @objc func keepScreenOn(_ call: CAPPluginCall) {
    DispatchQueue.main.async {
      UIApplication.shared.isIdleTimerDisabled = true
      call.resolve()
    }
  }

  @objc func allowScreenOff(_ call: CAPPluginCall) {
    DispatchQueue.main.async {
      UIApplication.shared.isIdleTimerDisabled = false
      call.resolve()
    }
  }

  @objc func setScreenBrightness(_ call: CAPPluginCall) {
    // iOS brightness is system-wide, not per-window — silently changing it
    // would be a poor surprise. This feature exists for Android e-ink devices.
    call.resolve()
  }

  @objc func getScreenOffTimeout(_ call: CAPPluginCall) {
    // iOS exposes no auto-lock-timeout API.
    call.resolve(["ms": -1])
  }

  @objc func openDisplaySettings(_ call: CAPPluginCall) {
    // iOS can only open the app's own Settings page (useful for toggling the
    // Always-location permission); there is no deep link to Display settings.
    DispatchQueue.main.async {
      if let url = URL(string: UIApplication.openSettingsURLString) {
        UIApplication.shared.open(url)
      }
      call.resolve()
    }
  }

  @objc func appendDiag(_ call: CAPPluginCall) {
    DiagLog.append(
      tag: call.getString("tag") ?? "",
      message: call.getString("message") ?? "")
    call.resolve()
  }

  /// Return the tail of the persistent diagnostic log for the diagnostics export.
  @objc func readDiag(_ call: CAPPluginCall) {
    let maxBytes = call.getInt("maxBytes") ?? 65_536
    DiagLog.readTail(maxBytes: maxBytes) { text, truncated, sizeBytes in
      call.resolve([
        "text": text,
        "truncated": truncated,
        "sizeBytes": sizeBytes,
      ])
    }
  }
}

/// Minimal persistent diagnostic log — the iOS counterpart of the Android
/// `DiagLog`, appending to a file in the app container. Rotates once at
/// `maxBytes` (mirroring DiagLog.kt) so the file can't grow unbounded.
enum DiagLog {
  private static let queue = DispatchQueue(label: "nav.pelorus.diag")
  private static let maxBytes: UInt64 = 1_000_000

  private static var fileURL: URL? {
    let fm = FileManager.default
    guard
      let dir = try? fm.url(
        for: .applicationSupportDirectory, in: .userDomainMask,
        appropriateFor: nil, create: true)
    else { return nil }
    return dir.appendingPathComponent("diag.log")
  }

  static func append(tag: String, message: String) {
    queue.async {
      guard let url = fileURL else { return }
      rotateIfNeeded(url)
      let line = "\(ISO8601DateFormatter().string(from: Date())) [\(tag)] \(message)\n"
      guard let data = line.data(using: .utf8) else { return }
      if let handle = try? FileHandle(forWritingTo: url) {
        defer { try? handle.close() }
        handle.seekToEndOfFile()
        handle.write(data)
      } else {
        try? data.write(to: url)
      }
    }
  }

  private static func rotateIfNeeded(_ url: URL) {
    let fm = FileManager.default
    guard
      let size = (try? fm.attributesOfItem(atPath: url.path))?[.size] as? UInt64,
      size > maxBytes
    else { return }
    let old = url.deletingLastPathComponent().appendingPathComponent("diag.log.1")
    try? fm.removeItem(at: old)
    try? fm.moveItem(at: url, to: old)
  }

  /// Read the last `maxBytes` of the log; completion runs on the diag queue,
  /// serialized against append so a mid-write read can't tear a line.
  static func readTail(
    maxBytes: Int, completion: @escaping (String, Bool, Int) -> Void
  ) {
    queue.async {
      guard let url = fileURL,
        let data = try? Data(contentsOf: url)
      else {
        completion("(no diag.log)", false, 0)
        return
      }
      let size = data.count
      if size <= maxBytes {
        completion(String(decoding: data, as: UTF8.self), false, size)
        return
      }
      let tail = data.suffix(maxBytes)
      var text = String(decoding: tail, as: UTF8.self)
      if let nl = text.firstIndex(of: "\n") {
        text = String(text[text.index(after: nl)...])  // drop partial first line
      }
      completion(text, true, size)
    }
  }
}
