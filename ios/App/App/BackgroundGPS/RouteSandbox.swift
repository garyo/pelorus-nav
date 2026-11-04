import AudioToolbox
import Foundation
import JavaScriptCore

/// Follows the active route while the app is in the background, so passing a
/// waypoint chimes with the screen off. The WKWebView stops running the app's
/// JavaScript once the app leaves the foreground, but a JavaScriptCore context
/// in this process keeps running as long as location updates keep the app
/// alive, so it runs the app's own route-following code
/// (NativeAssets/route-sandbox.js, built from src/navigation/route-sandbox.ts).
/// No navigation rule lives on this side.
///
/// The app hands over the route with `setRoute` whenever its navigation
/// changes; each fix then goes to `onFix`, and an arrival comes back through
/// `onArrival`. Mirrors RouteSandbox.kt on Android.
final class RouteSandbox {
  typealias ArrivalHandler = (_ reached: String, _ next: String?) -> Void

  private let queue = DispatchQueue(label: "nav.pelorus.route-sandbox")
  private let onArrival: ArrivalHandler
  private var context: JSContext?
  private var unavailable = false
  /// The route as the sandbox should hold it, legIndex kept current; past
  /// the last waypoint once finished, so a stale leg can't restart it.
  private var route: [String: Any]?

  init(onArrival: @escaping ArrivalHandler) {
    self.onArrival = onArrival
  }

  /// Follow `json` (a SandboxRoute), or stop following on nil. With
  /// `keepAhead`, a leg behind the one this side has already reached on the
  /// same route is ignored: an app still running in the background can catch
  /// up on a waypoint after the sandbox has passed it, and following its leg
  /// would chime for that waypoint again.
  func setRoute(json: String?, keepAhead: Bool) {
    queue.async {
      let incoming = json.flatMap(Self.parse)
      if keepAhead, let incoming, let current = self.route,
        Self.sameWaypoints(incoming, current),
        (incoming["legIndex"] as? Int ?? 0) < (current["legIndex"] as? Int ?? 0)
      {
        return
      }
      self.route = incoming
      if let context = self.context { self.load(context) }
    }
  }

  func onFix(lat: Double, lon: Double, sogKn: Double?, cogDeg: Double?) {
    queue.async {
      guard self.route != nil, let context = self.context ?? self.connect() else { return }
      let result = context.objectForKeyedSubscript("pelorusRoute")?
        .invokeMethod("onFix", withArguments: [lat, lon, sogKn ?? NSNull(), cogDeg ?? NSNull()])
      if let error = context.exception {
        DiagLog.append(tag: "route", message: "sandbox eval failed: \(error)")
        context.exception = nil
        return
      }
      guard let json = result?.toString(), !json.isEmpty,
        let arrival = Self.parse(json)
      else { return }
      let legIndex = arrival["legIndex"] as? Int ?? -1
      let finished = (self.route?["waypoints"] as? [Any])?.count ?? 0
      self.route?["legIndex"] = legIndex < 0 ? finished : legIndex
      self.onArrival(arrival["reached"] as? String ?? "", arrival["next"] as? String)
    }
  }

  /// The route as followed, leg current: what the app reads back. Call off
  /// the sandbox's queue.
  func current() -> [String: Any]? {
    queue.sync { route }
  }

  private func connect() -> JSContext? {
    if unavailable { return nil }
    guard
      let url = Bundle.main.url(
        forResource: "route-sandbox", withExtension: "js", subdirectory: "NativeAssets"),
      let script = try? String(contentsOf: url, encoding: .utf8),
      let context = JSContext()
    else {
      unavailable = true
      DiagLog.append(tag: "route", message: "route sandbox unavailable")
      return nil
    }
    context.evaluateScript(script)
    if let error = context.exception {
      unavailable = true
      DiagLog.append(tag: "route", message: "route sandbox failed to load: \(error)")
      return nil
    }
    self.context = context
    load(context)
    DiagLog.append(tag: "route", message: "sandbox connected")
    return context
  }

  private func load(_ context: JSContext) {
    let json =
      route.flatMap { try? JSONSerialization.data(withJSONObject: $0) }
      .flatMap { String(data: $0, encoding: .utf8) } ?? ""
    context.objectForKeyedSubscript("pelorusRoute")?
      .invokeMethod("setRoute", withArguments: [json])
  }

  private static func parse(_ json: String) -> [String: Any]? {
    guard let data = json.data(using: .utf8) else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  }

  private static func sameWaypoints(_ a: [String: Any], _ b: [String: Any]) -> Bool {
    (a["waypoints"] as? NSArray)?.isEqual(b["waypoints"] as? NSArray) ?? false
  }
}

/// The waypoint chime, from the WAVs rendered from the app's own chime cues
/// (tools/gen-alarm-sounds.ts). Plays as an alert sound, which also vibrates.
enum WaypointChime {
  private static var sounds: [String: SystemSoundID] = [:]

  static func play(final: Bool) {
    let name = final ? "waypoint_chime_arrival" : "waypoint_chime_pass"
    if sounds[name] == nil,
      let url = Bundle.main.url(forResource: name, withExtension: "wav", subdirectory: "NativeAssets")
    {
      var id: SystemSoundID = 0
      if AudioServicesCreateSystemSoundID(url as CFURL, &id) == kAudioServicesNoError {
        sounds[name] = id
      }
    }
    guard let id = sounds[name] else {
      DiagLog.append(tag: "route", message: "chime \(name) unavailable")
      return
    }
    AudioServicesPlayAlertSoundWithCompletion(id) {
      DiagLog.append(tag: "route", message: "chime \(name) played")
    }
  }
}
