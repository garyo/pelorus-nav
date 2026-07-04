package nav.pelorus.plugins.backgroundgps

/**
 * Exponential backoff for fruitless watchdog kicks. A kick that ends without
 * an accepted fix means GPS can't currently work (phone in a locker, below
 * decks) — re-kicking every 90 s burns a 40% duty cycle of max-power GPS
 * forever, exactly when it's useless. Delays stretch 90 s → 5 min → 10 min →
 * 15 min (cap); any accepted fix resets to the base.
 */
class WatchdogBackoff(
    private val delaysMs: LongArray = longArrayOf(90_000L, 300_000L, 600_000L, 900_000L),
) {
    private var fruitlessKicks = 0

    fun nextDelayMs(): Long = delaysMs[fruitlessKicks.coerceAtMost(delaysMs.size - 1)]

    fun onKickFruitless() {
        fruitlessKicks++
    }

    fun reset() {
        fruitlessKicks = 0
    }
}
