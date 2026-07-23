package nav.pelorus.plugins.btserial

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.os.Build
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.IOException
import java.util.UUID

/**
 * Bluetooth Classic SPP (RFCOMM) transport for NMEA GPS receivers such as the
 * Garmin GLO — devices that predate BLE UART and stream NMEA 0183 over the
 * Serial Port Profile. The BLE pod path (@capacitor-community/bluetooth-le)
 * cannot reach these at all.
 *
 * Model: Classic devices must be paired in Android's Bluetooth settings first
 * (there is no in-app pairing flow), so the JS side lists bonded devices and
 * connects by MAC address. The reader thread emits "data" events with decoded
 * text chunks; a broken link emits one "disconnected" event. Reconnect policy
 * lives entirely in the web layer (ReconnectingTransport) — this plugin only
 * opens, reads, and closes one socket at a time.
 */
@CapacitorPlugin(
    name = "BluetoothSerial",
    permissions = [
        Permission(alias = "bluetooth", strings = [Manifest.permission.BLUETOOTH_CONNECT])
    ]
)
class BluetoothSerialPlugin : Plugin() {

    companion object {
        private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }

    @Volatile private var socket: BluetoothSocket? = null
    // Identifies the current connection so a stale reader thread (whose socket
    // was replaced underneath it) can't emit a spurious "disconnected".
    @Volatile private var generation = 0

    private val adapter: BluetoothAdapter?
        get() = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    // BLUETOOTH_CONNECT is a runtime permission only on API 31+; below that the
    // manifest's legacy BLUETOOTH permission is granted at install time.
    private fun needsRuntimePermission(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            getPermissionState("bluetooth") != com.getcapacitor.PermissionState.GRANTED

    private fun withPermission(call: PluginCall) {
        if (needsRuntimePermission()) {
            requestPermissionForAlias("bluetooth", call, "permissionCallback")
        } else {
            dispatch(call)
        }
    }

    @PermissionCallback
    private fun permissionCallback(call: PluginCall) {
        if (needsRuntimePermission()) {
            call.reject("Bluetooth permission denied")
        } else {
            dispatch(call)
        }
    }

    // Permission-gated methods funnel through withPermission → dispatch so the
    // permission callback can resume whichever method originally ran.
    private fun dispatch(call: PluginCall) {
        when (call.methodName) {
            "getBondedDevices" -> doGetBondedDevices(call)
            "connect" -> doConnect(call)
            else -> call.reject("Unknown method ${call.methodName}")
        }
    }

    @PluginMethod
    fun isEnabled(call: PluginCall) {
        val ret = JSObject()
        ret.put("enabled", adapter?.isEnabled == true)
        call.resolve(ret)
    }

    @PluginMethod
    fun getBondedDevices(call: PluginCall) = withPermission(call)

    @PluginMethod
    fun connect(call: PluginCall) = withPermission(call)

    @PluginMethod
    fun disconnect(call: PluginCall) {
        closeSocket()
        call.resolve()
    }

    override fun handleOnDestroy() {
        closeSocket()
    }

    @SuppressLint("MissingPermission")
    private fun doGetBondedDevices(call: PluginCall) {
        val adapter = this.adapter ?: return call.reject("Bluetooth unavailable")
        if (!adapter.isEnabled) return call.reject("Bluetooth is off")
        val devices = JSArray()
        for (device in adapter.bondedDevices ?: emptySet()) {
            // BLE-only peripherals can't open an RFCOMM socket; leave them out.
            if (device.type == BluetoothDevice.DEVICE_TYPE_LE) continue
            val obj = JSObject()
            obj.put("deviceId", device.address)
            obj.put("name", device.name ?: device.address)
            devices.put(obj)
        }
        val ret = JSObject()
        ret.put("devices", devices)
        call.resolve(ret)
    }

    @SuppressLint("MissingPermission")
    private fun doConnect(call: PluginCall) {
        val deviceId = call.getString("deviceId")
            ?: return call.reject("deviceId is required")
        val adapter = this.adapter ?: return call.reject("Bluetooth unavailable")
        if (!adapter.isEnabled) return call.reject("Bluetooth is off")

        closeSocket()
        val gen = ++generation
        Thread({
            try {
                val device = adapter.getRemoteDevice(deviceId)
                // Discovery starves RFCOMM connection attempts; cancel it if we
                // can. On API 31+ cancelDiscovery() needs BLUETOOTH_SCAN, which
                // this plugin never requests (SPP uses bonded devices only) —
                // a SecurityException here must not kill the connect.
                try {
                    adapter.cancelDiscovery()
                } catch (_: SecurityException) {}
                val sock = device.createRfcommSocketToServiceRecord(SPP_UUID)
                sock.connect()
                synchronized(this) {
                    if (gen != generation) {
                        // A newer connect/disconnect superseded us mid-connect.
                        try { sock.close() } catch (_: IOException) {}
                        return@Thread
                    }
                    socket = sock
                }
                call.resolve()
                readLoop(sock, gen)
            } catch (e: Exception) {
                if (gen == generation) call.reject("Connect failed: ${e.message}")
            }
        }, "bt-spp-connect").start()
    }

    /** Blocking read loop on the connect thread; ends when the socket breaks. */
    private fun readLoop(sock: BluetoothSocket, gen: Int) {
        // NMEA is 7-bit ASCII; ISO-8859-1 decodes any byte without multi-byte
        // sequences, so chunk boundaries can never split a character.
        val buffer = ByteArray(1024)
        try {
            val input = sock.inputStream
            while (gen == generation) {
                val n = input.read(buffer)
                if (n < 0) break
                if (n > 0) {
                    val data = JSObject()
                    data.put("data", String(buffer, 0, n, Charsets.ISO_8859_1))
                    notifyListeners("data", data)
                }
            }
        } catch (_: IOException) {
            // Broken link — fall through to the disconnected notification.
        }
        if (gen == generation) {
            closeSocket()
            notifyListeners("disconnected", JSObject())
        }
    }

    private fun closeSocket() {
        synchronized(this) {
            generation++
            val sock = socket ?: return
            socket = null
            try { sock.close() } catch (_: IOException) {}
        }
    }
}
