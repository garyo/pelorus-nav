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
 *  - single press        -> "volumeKey" event ("in" = up, "out" = down); the
 *    web layer zooms the chart.
 *  - both keys together   -> pressing volume-up and volume-down within a short
 *    window toggles a touchscreen lock. While locked, MainActivity swallows
 *    touch events (see dispatchTouchEvent) and the system bars are hidden;
 *    the volume keys still work so the same both-keys gesture unlocks.
 *
 * We can't use a press-and-hold gesture: some devices (e.g. BOOX e-ink readers)
 * report volume keys as an instantaneous down+up with no hold duration, so a
 * two-key chord is the reliable cross-hardware signal. The first key of a chord
 * still zooms — we only know it's a chord once the second key arrives — which is
 * a deliberately accepted quirk (no zoom delay).
 *
 * MainActivity forwards key and touch events here — this plugin owns the
 * enabled/locked state because the touch swallowing lives in the Activity.
 */
@CapacitorPlugin(name = "HardwareKeys")
class HardwareKeysPlugin : Plugin() {

    @Volatile private var enabled = false
    @Volatile private var touchLocked = false

    private var lastKeyCode = 0
    private var lastKeyTime = 0L

    companion object {
        private const val CHORD_WINDOW_MS = 400L
    }

    @PluginMethod
    fun setEnabled(call: PluginCall) {
        enabled = call.getBoolean("enabled", false) == true
        if (!enabled && touchLocked) setLocked(false)
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
            val now = event.eventTime
            val isChord =
                lastKeyCode != 0 &&
                    code != lastKeyCode &&
                    now - lastKeyTime <= CHORD_WINDOW_MS
            if (isChord) {
                lastKeyCode = 0 // consume the chord; don't let a third press re-trigger
                setLocked(!touchLocked)
            } else {
                lastKeyCode = code
                lastKeyTime = now
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
