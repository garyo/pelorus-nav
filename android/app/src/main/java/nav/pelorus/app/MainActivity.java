package nav.pelorus.app;

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
        super.onCreate(savedInstanceState);
        // Render at our exact CSS sizes regardless of the device's system font
        // scale (e-ink readers often ship below 100%). The WebView otherwise
        // applies that scale to all text via textZoom, shrinking the instrument
        // digits while vw-based widths (e.g. the side column) stay fixed —
        // leaving small numbers floating in too-wide panels.
        getBridge().getWebView().getSettings().setTextZoom(100);
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
