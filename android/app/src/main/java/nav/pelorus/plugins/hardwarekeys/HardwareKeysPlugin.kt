package nav.pelorus.plugins.hardwarekeys

import android.os.Handler
import android.os.Looper
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
 *  - short press  -> "volumeKey" event ("in" = up, "out" = down); the web
 *    layer zooms the chart.
 *  - long press   -> toggles a touchscreen lock. While locked, MainActivity
 *    swallows touch events (see dispatchTouchEvent) and the system bars are
 *    hidden; the volume keys still work so a long press unlocks.
 *
 * MainActivity forwards key and touch events here — this plugin owns the
 * enabled/locked state because the touch swallowing lives in the Activity and
 * the long-press detection needs a main-looper timer.
 */
@CapacitorPlugin(name = "HardwareKeys")
class HardwareKeysPlugin : Plugin() {

    private val handler = Handler(Looper.getMainLooper())
    private var pendingLongPress: Runnable? = null
    private var longPressFired = false

    @Volatile private var enabled = false
    @Volatile private var touchLocked = false

    companion object {
        private const val LONG_PRESS_MS = 600L
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
     * was a volume key we handled (and therefore consumed).
     */
    fun handleKeyEvent(event: KeyEvent): Boolean {
        if (!enabled) return false
        val code = event.keyCode
        if (code != KeyEvent.KEYCODE_VOLUME_UP && code != KeyEvent.KEYCODE_VOLUME_DOWN) {
            return false
        }
        when (event.action) {
            KeyEvent.ACTION_DOWN -> {
                if (event.repeatCount == 0) {
                    longPressFired = false
                    cancelPendingLongPress()
                    val r = Runnable { fireLongPress() }
                    pendingLongPress = r
                    handler.postDelayed(r, LONG_PRESS_MS)
                }
                // Also honor an explicit system long-press flag: some OEMs (and
                // injected test events) deliver FLAG_LONG_PRESS instead of a held
                // key our timer would see. Guarded by longPressFired so the two
                // paths can't both toggle the lock.
                if (!longPressFired &&
                    event.flags and KeyEvent.FLAG_LONG_PRESS != 0
                ) {
                    fireLongPress()
                }
                // Swallow auto-repeats too, so the system volume UI never shows.
            }
            KeyEvent.ACTION_UP -> {
                cancelPendingLongPress()
                if (!longPressFired) {
                    emitVolumeKey(if (code == KeyEvent.KEYCODE_VOLUME_UP) "in" else "out")
                }
                longPressFired = false
            }
        }
        return true
    }

    private fun fireLongPress() {
        if (longPressFired) return
        longPressFired = true
        cancelPendingLongPress()
        setLocked(!touchLocked)
    }

    private fun cancelPendingLongPress() {
        pendingLongPress?.let { handler.removeCallbacks(it) }
        pendingLongPress = null
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

    override fun handleOnDestroy() {
        cancelPendingLongPress()
        super.handleOnDestroy()
    }
}
