import Foundation
import SQLite3

/// Persistent SQLite buffer of GPS fixes — the iOS counterpart of the Android
/// `TrackDatabase`. Every fix (active and passive) is written here; the JS
/// `CapacitorGPSProvider` drains it in timestamp order and prunes consumed
/// rows. Persisting to disk is what lets screen-off / suspended recording
/// survive a WebView reload or process restart.
///
/// `timestamp` is wall-clock epoch milliseconds. `speed`/`course`/`accuracy`
/// use `-1` as the "unknown" sentinel, matching the Android schema so the JS
/// `emit()` `>= 0` guards behave identically.
final class TrackDatabase {
  struct Point {
    let timestamp: Int64
    let lat: Double
    let lon: Double
    let speed: Double
    let course: Double
    let accuracy: Double
  }

  private var db: OpaquePointer?
  /// Serialize all access — fixes arrive on the location delegate while the
  /// bridge reads/prunes from JS calls.
  private let queue = DispatchQueue(label: "nav.pelorus.trackdb")

  // SQLite wants this for transient text/blob binds; harmless to keep handy.
  private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

  init() {
    queue.sync { open() }
  }

  private func open() {
    let fm = FileManager.default
    guard
      let dir = try? fm.url(
        for: .applicationSupportDirectory, in: .userDomainMask,
        appropriateFor: nil, create: true)
    else { return }
    let url = dir.appendingPathComponent("pelorus-track.sqlite")
    if sqlite3_open(url.path, &db) != SQLITE_OK {
      db = nil
      return
    }
    // WAL improves durability/concurrency across suspension.
    exec("PRAGMA journal_mode=WAL;")
    exec(
      """
      CREATE TABLE IF NOT EXISTS points (
        timestamp INTEGER NOT NULL,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        speed REAL NOT NULL,
        course REAL NOT NULL,
        accuracy REAL NOT NULL
      );
      """)
    exec("CREATE INDEX IF NOT EXISTS idx_points_ts ON points(timestamp);")
  }

  private func exec(_ sql: String) {
    guard let db = db else { return }
    sqlite3_exec(db, sql, nil, nil, nil)
  }

  func insert(_ p: Point) {
    queue.sync {
      guard let db = db else { return }
      var stmt: OpaquePointer?
      let sql =
        "INSERT INTO points (timestamp,lat,lon,speed,course,accuracy) VALUES (?,?,?,?,?,?);"
      if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
        sqlite3_bind_int64(stmt, 1, p.timestamp)
        sqlite3_bind_double(stmt, 2, p.lat)
        sqlite3_bind_double(stmt, 3, p.lon)
        sqlite3_bind_double(stmt, 4, p.speed)
        sqlite3_bind_double(stmt, 5, p.course)
        sqlite3_bind_double(stmt, 6, p.accuracy)
        sqlite3_step(stmt)
      }
      sqlite3_finalize(stmt)
    }
  }

  /// Points strictly newer than `since`, ascending by timestamp.
  func getSince(_ since: Int64) -> [Point] {
    queue.sync {
      guard let db = db else { return [] }
      var stmt: OpaquePointer?
      var out: [Point] = []
      let sql =
        "SELECT timestamp,lat,lon,speed,course,accuracy FROM points WHERE timestamp > ? ORDER BY timestamp ASC;"
      if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
        sqlite3_bind_int64(stmt, 1, since)
        while sqlite3_step(stmt) == SQLITE_ROW {
          out.append(
            Point(
              timestamp: sqlite3_column_int64(stmt, 0),
              lat: sqlite3_column_double(stmt, 1),
              lon: sqlite3_column_double(stmt, 2),
              speed: sqlite3_column_double(stmt, 3),
              course: sqlite3_column_double(stmt, 4),
              accuracy: sqlite3_column_double(stmt, 5)
            ))
        }
      }
      sqlite3_finalize(stmt)
      return out
    }
  }

  /// Delete points with timestamp <= `before`. `before <= 0` clears the table.
  func pruneBefore(_ before: Int64) {
    queue.sync {
      guard let db = db else { return }
      var stmt: OpaquePointer?
      let sql =
        before <= 0
        ? "DELETE FROM points;"
        : "DELETE FROM points WHERE timestamp <= ?;"
      if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
        if before > 0 { sqlite3_bind_int64(stmt, 1, before) }
        sqlite3_step(stmt)
      }
      sqlite3_finalize(stmt)
    }
  }
}
