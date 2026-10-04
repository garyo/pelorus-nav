package nav.pelorus.plugins.backgroundgps

/**
 * Wording of the notice posted when Android restarts the service for a
 * recording but refuses to let it run in the foreground, so the recording
 * stops until the app is opened. [detail] is the expanded text, carrying
 * any manufacturer-specific remedy; null when there is none.
 */
data class RecordingStoppedNotice(val title: String, val text: String, val detail: String?)

fun recordingStoppedNotice(manufacturer: String): RecordingStoppedNotice {
    val text = "Android closed Pelorus Nav in the background. Open the app to resume recording."
    val remedy = when {
        manufacturer.equals("samsung", ignoreCase = true) ->
            "To prevent this, add Pelorus Nav to Never auto sleeping apps " +
                "(Settings › Battery › Background usage limits)."
        else -> null
    }
    return RecordingStoppedNotice("Track recording stopped", text, remedy?.let { "$text $it" })
}
