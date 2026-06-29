package nav.pelorus.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import nav.pelorus.plugins.backgroundgps.BackgroundGPSPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundGPSPlugin.class);
        super.onCreate(savedInstanceState);
        // Render at our exact CSS sizes regardless of the device's system font
        // scale (e-ink readers often ship below 100%). The WebView otherwise
        // applies that scale to all text via textZoom, shrinking the instrument
        // digits while vw-based widths (e.g. the side column) stay fixed —
        // leaving small numbers floating in too-wide panels.
        getBridge().getWebView().getSettings().setTextZoom(100);
    }
}
