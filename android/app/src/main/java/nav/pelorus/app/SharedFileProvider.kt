package nav.pelorus.app

import android.net.Uri
import androidx.core.content.FileProvider

/**
 * The app's FileProvider, typing the files we share where Android's
 * extension table can't. That table has no GPX entry, so an exported route
 * reached receivers as application/octet-stream — and Quick Share hands an
 * untyped received file to Google Wallet instead of a GPX app.
 */
class SharedFileProvider : FileProvider() {
    override fun getType(uri: Uri): String? {
        if (uri.lastPathSegment?.endsWith(".gpx", ignoreCase = true) == true) {
            return "application/gpx+xml"
        }
        return super.getType(uri)
    }
}
