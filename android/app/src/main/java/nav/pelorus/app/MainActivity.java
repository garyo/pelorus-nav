package nav.pelorus.app;

import android.content.Intent;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.MotionEvent;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;
import nav.pelorus.plugins.backgroundgps.BackgroundGPSPlugin;
import nav.pelorus.plugins.btserial.BluetoothSerialPlugin;
import nav.pelorus.plugins.hardwarekeys.HardwareKeysPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundGPSPlugin.class);
        registerPlugin(BluetoothSerialPlugin.class);
        registerPlugin(HardwareKeysPlugin.class);
        discardReplayedIntent(savedInstanceState);
        super.onCreate(savedInstanceState);
        // Render at our exact CSS sizes regardless of the device's system font
        // scale (e-ink readers often ship below 100%). The WebView otherwise
        // applies that scale to all text via textZoom, shrinking the instrument
        // digits while vw-based widths (e.g. the side column) stay fixed —
        // leaving small numbers floating in too-wide panels.
        getBridge().getWebView().getSettings().setTextZoom(100);
    }

    private static boolean isFileOpen(Intent intent) {
        return intent != null
            && Intent.ACTION_VIEW.equals(intent.getAction())
            && intent.getData() != null;
    }

    // A task keeps the intent that started it, and Android replays it verbatim
    // when the process is reclaimed and the user returns through Recents — same
    // action, same data, same flags, with no FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY
    // to tell the two apart (measured on One UI / Android 16). Left alone, an
    // "open with .gpx" re-offers its import on every task restore, forever.
    //
    // What does distinguish them is the saved instance state: a restore hands
    // one back, a fresh open from a file manager never does. Replace the stale
    // intent before BridgeActivity.load() reads it, so appUrlOpen doesn't fire.
    // Must run before super.onCreate().
    private void discardReplayedIntent(Bundle savedInstanceState) {
        if (savedInstanceState != null && isFileOpen(getIntent())) {
            setIntent(new Intent(Intent.ACTION_MAIN));
        }
    }

    // Volume-key control: let the HardwareKeys plugin consume volume keys
    // (zoom / screen-lock) when the feature is enabled; otherwise fall through
    // to normal system volume handling.
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        HardwareKeysPlugin keys = keysPlugin();
        if (keys != null && keys.handleKeyEvent(event)) {
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    // While the touchscreen is locked, swallow all touch events before they
    // reach the WebView. The lock is released via a volume long-press, which
    // arrives through dispatchKeyEvent above (keys are unaffected).
    @Override
    public boolean dispatchTouchEvent(MotionEvent event) {
        HardwareKeysPlugin keys = keysPlugin();
        if (keys != null && keys.isTouchLocked()) {
            return true;
        }
        return super.dispatchTouchEvent(event);
    }

    private HardwareKeysPlugin keysPlugin() {
        if (getBridge() == null) {
            return null;
        }
        PluginHandle handle = getBridge().getPlugin("HardwareKeys");
        return handle == null ? null : (HardwareKeysPlugin) handle.getInstance();
    }
}
