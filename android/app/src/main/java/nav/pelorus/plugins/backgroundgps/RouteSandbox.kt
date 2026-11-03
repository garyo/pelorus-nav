package nav.pelorus.plugins.backgroundgps

import android.content.Context
import android.os.Build
import androidx.javascriptengine.JavaScriptIsolate
import androidx.javascriptengine.JavaScriptSandbox
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Follows the active route while the app is frozen, so passing a waypoint
 * chimes with the screen off. The WebView stops running JavaScript about 90 s
 * after the screen goes off; a [JavaScriptSandbox] — the system WebView's
 * engine in a process of its own, with no page — does not, so this runs the
 * app's own route-following code there (assets/route-sandbox.js, built from
 * src/navigation/route-sandbox.ts). No navigation rule lives on this side.
 *
 * The app hands over the route with [setRoute] whenever its navigation
 * changes; each fix then goes to [onFix], and an arrival comes back through
 * [onArrival]. The leg reached is kept here too, so a sandbox process that
 * dies resumes from it rather than from the leg the app last sent.
 *
 * All sandbox calls run on one background thread. Devices whose WebView
 * lacks the sandbox (or Android before 8) simply never chime in the
 * background.
 */
class RouteSandbox(
    context: Context,
    private val onArrival: (reached: String, next: String?, vibrate: LongArray) -> Unit,
) {
    private val appContext = context.applicationContext
    private val executor = Executors.newSingleThreadExecutor()
    private var sandbox: JavaScriptSandbox? = null
    private var isolate: JavaScriptIsolate? = null
    private var unsupported = false
    /** The route as the sandbox should hold it, legIndex kept current. */
    private var route: JSONObject? = null

    /**
     * Follow `json` (a SandboxRoute), or stop following on null. With
     * `keepAhead`, a leg behind the one this side has already reached on the
     * same route is ignored: an app still running hidden can catch up on a
     * waypoint after the sandbox has passed it, and following its leg would
     * chime for that waypoint again.
     */
    fun setRoute(json: String?, keepAhead: Boolean) = executor.execute {
        val incoming = json?.let { JSONObject(it) }
        val current = route
        if (keepAhead && incoming != null && current != null &&
            incoming.optJSONArray("waypoints")?.toString() ==
            current.optJSONArray("waypoints")?.toString() &&
            incoming.optInt("legIndex") < current.optInt("legIndex")
        ) {
            return@execute
        }
        route = incoming
        val iso = isolate ?: return@execute
        try {
            load(iso)
        } catch (e: Exception) {
            DiagLog.log(appContext, "route", "sandbox setRoute failed: ${e.message}")
        }
    }

    fun onFix(lat: Double, lon: Double, sogKn: Double?, cogDeg: Double?) = executor.execute {
        if (route == null) return@execute
        val iso = isolate ?: connect() ?: return@execute
        try {
            val result = iso.evaluateJavaScriptAsync(
                "pelorusRoute.onFix($lat, $lon, ${sogKn ?: "null"}, ${cogDeg ?: "null"})",
            ).get(EVAL_TIMEOUT_S, TimeUnit.SECONDS)
            if (result.isEmpty()) return@execute
            val arrival = JSONObject(result)
            val legIndex = arrival.getInt("legIndex")
            if (legIndex < 0) route = null else route?.put("legIndex", legIndex)
            val pattern = arrival.getJSONArray("vibrate")
            onArrival(
                arrival.getString("reached"),
                if (arrival.isNull("next")) null else arrival.getString("next"),
                // Android patterns start with a delay; navigator.vibrate's
                // start with the first pulse.
                LongArray(pattern.length() + 1) { if (it == 0) 0L else pattern.getLong(it - 1) },
            )
        } catch (e: Exception) {
            DiagLog.log(appContext, "route", "sandbox eval failed: ${e.javaClass.simpleName}: ${e.message}")
            // A dead sandbox process: reconnect on the next fix.
            close(isolate, sandbox)
            isolate = null
            sandbox = null
        }
    }

    fun close() {
        executor.execute {
            close(isolate, sandbox)
            isolate = null
            sandbox = null
        }
        executor.shutdown()
    }

    private fun connect(): JavaScriptIsolate? {
        if (unsupported) return null
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !JavaScriptSandbox.isSupported()) {
            unsupported = true
            DiagLog.log(appContext, "route", "JavaScriptSandbox unsupported; no background chimes")
            return null
        }
        return try {
            val box = JavaScriptSandbox.createConnectedInstanceAsync(appContext)
                .get(CONNECT_TIMEOUT_S, TimeUnit.SECONDS)
            val iso = box.createIsolate()
            val script = appContext.assets.open(SCRIPT_ASSET).bufferedReader().use { it.readText() }
            iso.evaluateJavaScriptAsync(script).get(EVAL_TIMEOUT_S, TimeUnit.SECONDS)
            sandbox = box
            isolate = iso
            load(iso)
            DiagLog.log(appContext, "route", "sandbox connected")
            iso
        } catch (e: Exception) {
            DiagLog.log(appContext, "route", "sandbox connect failed: ${e.javaClass.simpleName}: ${e.message}")
            null
        }
    }

    private fun load(iso: JavaScriptIsolate) {
        // JSONObject.quote makes the route JSON a JS string literal.
        val arg = route?.let { JSONObject.quote(it.toString()) } ?: "\"\""
        iso.evaluateJavaScriptAsync("pelorusRoute.setRoute($arg)")
            .get(EVAL_TIMEOUT_S, TimeUnit.SECONDS)
    }

    private fun close(iso: JavaScriptIsolate?, box: JavaScriptSandbox?) {
        try {
            iso?.close()
            box?.close()
        } catch (_: Exception) {
            // Already dead.
        }
    }

    private companion object {
        const val SCRIPT_ASSET = "route-sandbox.js"
        const val CONNECT_TIMEOUT_S = 10L
        const val EVAL_TIMEOUT_S = 5L
    }
}
