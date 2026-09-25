package nav.pelorus.plugins.installsource

import android.content.pm.PackageManager
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject

/**
 * Reports which app installed this one: "com.android.vending" for the Play
 * Store, a browser/file manager/package installer for a sideloaded APK, or
 * null (adb, and some sideload paths). The web layer uses it to decide who
 * delivers updates — the store, or GitHub releases.
 */
@CapacitorPlugin(name = "InstallSource")
class InstallSourcePlugin : Plugin() {

    @PluginMethod
    fun getInstaller(call: PluginCall) {
        val installer = try {
            val pm = context.packageManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                pm.getInstallSourceInfo(context.packageName).installingPackageName
            } else {
                @Suppress("DEPRECATION")
                pm.getInstallerPackageName(context.packageName)
            }
        } catch (e: PackageManager.NameNotFoundException) {
            null
        }
        call.resolve(JSObject().put("installer", installer ?: JSONObject.NULL))
    }
}
