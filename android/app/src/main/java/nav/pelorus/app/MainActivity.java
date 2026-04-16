package nav.pelorus.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import nav.pelorus.plugins.backgroundgps.BackgroundGPSPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundGPSPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
