package nav.pelorus.plugins.backgroundgps

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RecordingStoppedNoticeTest {
    @Test
    fun `generic devices get the base notice without a remedy`() {
        val notice = recordingStoppedNotice("Google")
        assertEquals("Track recording stopped", notice.title)
        assertEquals(
            "Android closed Pelorus Nav in the background. Open the app to resume recording.",
            notice.text,
        )
        assertNull(notice.detail)
    }

    @Test
    fun `samsung devices get the never-auto-sleeping remedy in any case`() {
        for (manufacturer in listOf("samsung", "Samsung", "SAMSUNG")) {
            val notice = recordingStoppedNotice(manufacturer)
            val detail = notice.detail!!
            assertTrue(detail.startsWith(notice.text))
            assertTrue(detail.contains("Never auto sleeping apps"))
        }
    }
}
