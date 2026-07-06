package nav.pelorus.plugins.hardwarekeys

import android.view.KeyEvent
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Takes over the physical volume keys when enabled:
 *  - when unlocked, a volume press emits a "volumeKey" event ("in" = up,
 *    "out" = down) and the web layer zooms the chart.
 *  - the touchscreen lock is engaged from the web layer (a menu item -> lock())
 *    and released by any single volume press. While locked, MainActivity
 *    swallows touch events (see dispatchTouchEvent) and the system bars are
 *    hidden.
 *
 * The lock can't be a key gesture: some devices (e.g. BOOX e-ink readers)
 * report volume keys as an instantaneous down+up and only ever deliver one key
 * at a time, so holds, chords, and fast double-presses are all undetectable.
 * A single press is the one reliable signal, so it's used to unlock; locking is
 * a deliberate on-screen action.
 *
 * MainActivity forwards key and touch events here — this plugin owns the
 * enabled/locked state because the touch swallowing lives in the Activity.
 */
@CapacitorPlugin(name = "HardwareKeys")
class HardwareKeysPlugin : Plugin() {

    @Volatile private var enabled = false
    @Volatile private var touchLocked = false

    @PluginMethod
    fun setEnabled(call: PluginCall) {
        enabled = call.getBoolean("enabled", false) == true
        if (!enabled && touchLocked) setLocked(false)
        call.resolve()
    }

    /** Lock the touchscreen (called from the web menu). No-op if the feature is
     *  disabled, since then volume keys wouldn't be intercepted to unlock. */
    @PluginMethod
    fun lock(call: PluginCall) {
        if (enabled && !touchLocked) setLocked(true)
        call.resolve()
    }

    /** Called from MainActivity.dispatchTouchEvent — true means swallow the touch. */
    fun isTouchLocked(): Boolean = touchLocked

    /**
     * Called from MainActivity.dispatchKeyEvent. Returns true when the event
     * was a volume key we handled (and therefore consumed). We act on the key
     * UP and swallow everything else so the system volume UI never appears.
     */
    fun handleKeyEvent(event: KeyEvent): Boolean {
        if (!enabled) return false
        val code = event.keyCode
        if (code != KeyEvent.KEYCODE_VOLUME_UP && code != KeyEvent.KEYCODE_VOLUME_DOWN) {
            return false
        }
        if (event.action == KeyEvent.ACTION_UP) {
            if (touchLocked) {
                setLocked(false) // any press unlocks; don't also zoom
            } else {
                emitVolumeKey(if (code == KeyEvent.KEYCODE_VOLUME_UP) "in" else "out")
            }
        }
        return true
    }

    private fun emitVolumeKey(direction: String) {
        notifyListeners("volumeKey", JSObject().put("key", direction))
    }

    private fun setLocked(locked: Boolean) {
        touchLocked = locked
        activity?.runOnUiThread { applySystemBars(hidden = locked) }
        notifyListeners("touchLock", JSObject().put("locked", locked))
    }

    /** Hide the system bars while locked so edge swipes are less likely to
     *  pull them down; restore them on unlock. */
    private fun applySystemBars(hidden: Boolean) {
        val window = activity?.window ?: return
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        if (hidden) {
            controller.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
    }
}
