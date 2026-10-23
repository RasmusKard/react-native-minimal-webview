package expo.modules.minimalwebview.requests

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException

/** The download cap on the streamed body, which holds whatever Content-Length the server sent. */
class DownloadsTest {
  private val body = ByteArray(3 * DEFAULT_BUFFER_SIZE + 1) { it.toByte() } // more than one read

  @Test
  fun copiesABodyUpToTheCap() {
    val output = ByteArrayOutputStream()
    Downloads.copyCapped(ByteArrayInputStream(body), output, body.size.toLong())
    assertArrayEquals(body, output.toByteArray())
  }

  @Test
  fun failsABodyOverTheCap() {
    assertThrows(IOException::class.java) {
      Downloads.copyCapped(ByteArrayInputStream(body), ByteArrayOutputStream(), body.size - 1L)
    }
  }
}
