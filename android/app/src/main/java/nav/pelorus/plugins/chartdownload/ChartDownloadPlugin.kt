package nav.pelorus.plugins.chartdownload

import android.content.Intent
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import nav.pelorus.plugins.backgroundgps.DiagLog

/**
 * Runs [ChartDownloadService] for the JS download queue: `start` while there
 * is work (again with each progress update), `stop` once the queue drains.
 * Independent of the GPS service; either may run without the other.
 */
@CapacitorPlugin(name = "ChartDownload")
class ChartDownloadPlugin : Plugin() {

    override fun load() {
        ChartDownloadService.stoppedListener = { reason ->
            notifyListeners("stopped", JSObject().put("reason", reason))
        }
    }

    /**
     * Start the service, or update its notification when it is running.
     * Resolves `running: false` when Android refuses the start (the app is
     * in the background, or the dataSync time limit is used up).
     */
    @PluginMethod
    fun start(call: PluginCall) {
        val text = call.getString("text") ?: ""
        val percent = call.getInt("percent") ?: -1
        ChartDownloadService.stopRequested = false
        val service = ChartDownloadService.instance
        if (service != null) {
            service.update(text, percent)
            call.resolve(JSObject().put("running", true))
            return
        }
        val intent = Intent(context, ChartDownloadService::class.java)
            .putExtra(ChartDownloadService.EXTRA_TEXT, text)
            .putExtra(ChartDownloadService.EXTRA_PERCENT, percent)
        val running = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            true
        } catch (e: Exception) {
            DiagLog.log(context, "dlsvc", "start refused: ${e.javaClass.simpleName}: ${e.message}")
            false
        }
        call.resolve(JSObject().put("running", running))
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        stopService()
        call.resolve()
    }

    /** The WebView doing the downloading is going away with the activity. */
    override fun handleOnDestroy() {
        stopService()
    }

    private fun stopService() {
        ChartDownloadService.stopRequested = true
        ChartDownloadService.instance?.stopSelf()
    }
}
