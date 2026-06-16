import Capacitor
import UIKit

/// Bridge view controller that registers app-embedded Capacitor plugins.
/// Capacitor's `packageClassList` only covers plugins shipped as Swift
/// packages; a plugin defined inside the app target must be registered here.
class MainViewController: CAPBridgeViewController {
  override func capacitorDidLoad() {
    bridge?.registerPluginInstance(BackgroundGPSPlugin())
  }
}
