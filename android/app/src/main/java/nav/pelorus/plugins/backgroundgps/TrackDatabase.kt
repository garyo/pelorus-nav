package nav.pelorus.plugins.backgroundgps

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

data class TrackPointRow(
    val timestamp: Long,
    val lat: Double,
    val lon: Double,
    val speed: Float,
    val course: Float,
    val accuracy: Float
)

class TrackDatabase(context: Context) : SQLiteOpenHelper(context, DB_NAME, null, DB_VERSION) {

    companion object {
        private const val DB_NAME = "background_track.db"
        private const val DB_VERSION = 1
        private const val TABLE = "track_points"
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""
            CREATE TABLE $TABLE (
                timestamp INTEGER NOT NULL,
                lat REAL NOT NULL,
                lon REAL NOT NULL,
                speed REAL NOT NULL,
                course REAL NOT NULL,
                accuracy REAL NOT NULL
            )
        """)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS $TABLE")
        onCreate(db)
    }

    fun insertPoint(point: TrackPointRow) {
        writableDatabase.insert(TABLE, null, ContentValues().apply {
            put("timestamp", point.timestamp)
            put("lat", point.lat)
            put("lon", point.lon)
            put("speed", point.speed)
            put("course", point.course)
            put("accuracy", point.accuracy)
        })
    }

    /**
     * Return points strictly newer than [since] in chronological order.
     * Pass 0 to fetch the entire buffer.
     */
    fun getPointsSince(since: Long): List<TrackPointRow> {
        val points = mutableListOf<TrackPointRow>()
        val (selection, args) =
            if (since > 0) "timestamp > ?" to arrayOf(since.toString())
            else null to null
        val cursor = readableDatabase.query(
            TABLE, null, selection, args, null, null, "timestamp ASC"
        )
        cursor.use {
            while (it.moveToNext()) {
                points.add(TrackPointRow(
                    timestamp = it.getLong(it.getColumnIndexOrThrow("timestamp")),
                    lat = it.getDouble(it.getColumnIndexOrThrow("lat")),
                    lon = it.getDouble(it.getColumnIndexOrThrow("lon")),
                    speed = it.getFloat(it.getColumnIndexOrThrow("speed")),
                    course = it.getFloat(it.getColumnIndexOrThrow("course")),
                    accuracy = it.getFloat(it.getColumnIndexOrThrow("accuracy"))
                ))
            }
        }
        return points
    }

    /**
     * Delete all points with timestamp ≤ [before]. Pass 0 to clear the table.
     * Race-safe: any rows inserted after this call (timestamp > before) are
     * preserved.
     */
    fun pruneBefore(before: Long) {
        if (before > 0) {
            writableDatabase.delete(TABLE, "timestamp <= ?", arrayOf(before.toString()))
        } else {
            writableDatabase.delete(TABLE, null, null)
        }
    }
}
