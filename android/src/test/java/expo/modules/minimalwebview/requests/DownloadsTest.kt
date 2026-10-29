package expo.modules.minimalwebview.requests

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.URL
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.concurrent.thread

/** The http(s) download fetch against a local server, with a fake cookie store, and the cap on the streamed body. */
class DownloadsTest {
  private val body = ByteArray(3 * DEFAULT_BUFFER_SIZE + 1) { it.toByte() } // more than one read
  private val file = File.createTempFile("download", null)
  private val received = CopyOnWriteArrayList<String>() // each request's path, Cookie and User-Agent
  private val stored = mutableListOf<String>() // each Set-Cookie, with the URL it came from

  // The JDK's HttpServer isn't on the classpath of Android's unit tests: a server that answers each path with a fixed head.
  private val routes = mapOf(
    "/start" to "302 Found\r\nLocation: next?hop=2\r\nSet-Cookie: hop=1", // a relative Location
    "/next" to "200 OK\r\nContent-Type: text/plain; charset=utf-8",
    "/missing" to "404 Not Found",
    "/loop" to "302 Found\r\nLocation: /loop",
    "/ftp" to "302 Found\r\nLocation: ftp://127.0.0.1/file"
  )
  private val server = ServerSocket(0, 0, InetAddress.getByName("127.0.0.1"))
  private val origin = "http://127.0.0.1:${server.localPort}"

  init {
    thread(isDaemon = true) {
      while (true) (try { server.accept() } catch (_: SocketException) { break }).use(::serve)
    }
  }

  @After
  fun stop() {
    server.close()
    file.delete()
  }

  @Test
  fun followsARedirectWithEachHopsCookies() {
    assertEquals("text/plain", fetch("/start"))
    assertEquals("done", file.readText())
    assertEquals(listOf("/start for=/start agent", "/next?hop=2 for=/next agent"), received)
    assertEquals(listOf("$origin/start hop=1"), stored)
    assertEquals("the page's type wins", "application/pdf", fetch("/next", "application/pdf"))
  }

  @Test
  fun failsAnErrorStatusARedirectLoopAndARedirectOffHttp() {
    for ((path, reason) in listOf("/missing" to "HTTP 404", "/loop" to "more than 20 redirects", "/ftp" to "refused a redirect from http to ftp")) {
      assertEquals(path, reason, assertThrows(IOException::class.java) { fetch(path) }.message)
    }
    assertEquals("the first request and 20 redirects", 21, received.count { it.startsWith("/loop") })
    assertEquals(404, assertThrows(HttpStatus::class.java) { fetch("/missing") }.code)
  }

  @Test
  fun kindsAFailureByWhatFailed() {
    assertEquals("network", Downloads.kind(IOException("timeout"), fetched = true))
    assertEquals("data", Downloads.kind(TooLarge(), fetched = true))
    assertEquals("data", Downloads.kind(IOException("could not read the blob"), fetched = false))
    assertEquals("data", Downloads.kind(IllegalArgumentException("bad base-64"), fetched = false))
  }

  @Test
  fun replacesANameThatIsADirectoryOrEmpty() {
    for (name in listOf(".", "..", "")) assertEquals(name, "download", Downloads.safeName(name))
    assertEquals("...", Downloads.safeName("..."))
    assertEquals("a.txt", Downloads.safeName("a.txt"))
  }

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

  private fun fetch(path: String, mimeType: String = "") = Downloads.fetchTo(
    DownloadInfo("$origin$path", "agent", "", mimeType),
    file,
    { url -> "for=${URL(url).path}" },
    { url, cookie -> stored += "$url $cookie" }
  )

  private fun serve(socket: Socket) {
    val head = socket.getInputStream().bufferedReader().lineSequence().takeWhile { it.isNotEmpty() }.toList()
    fun header(name: String) = head.firstOrNull { it.startsWith("$name: ", ignoreCase = true) }?.substringAfter(": ")
    val path = head.first().split(' ')[1]
    received += "$path ${header("Cookie")} ${header("User-Agent")}"
    val response = "HTTP/1.1 ${routes.getValue(path.substringBefore('?'))}\r\nContent-Length: 4\r\nConnection: close\r\n\r\ndone"
    socket.getOutputStream().write(response.toByteArray())
  }
}
