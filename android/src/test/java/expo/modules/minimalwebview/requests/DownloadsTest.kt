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

  // The JDK's HttpServer isn't on the classpath of Android's unit tests: a server that answers each path with a fixed
  // head, and the body "done", with its Content-Length unless the head has one.
  private val routes = mapOf(
    "/start" to "302 Found\r\nLocation: next?hop=2\r\nSet-Cookie: hop=1", // a relative Location
    "/next" to "200 OK\r\nContent-Type: text/plain; charset=utf-8",
    "/untyped" to "200 OK",
    "/huge" to "200 OK\r\nContent-Length: ${Downloads.MAX_BYTES + 1}",
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
  fun followsARedirectOnlyToHttpsOrFromHttpToHttp() {
    for ((from, to, allowed) in listOf(
      Triple("http", "https", true),
      Triple("https", "https", true),
      Triple("http", "http", true),
      Triple("https", "http", false),
      Triple("http", "ftp", false),
      Triple("https", "file", false)
    )) {
      assertEquals("$from to $to", allowed, Downloads.redirectAllowed(URL("$from://a.test/"), URL("$to://b.test/")))
    }
  }

  @Test
  fun failsAContentLengthOverTheCapBeforeReading() {
    assertThrows(TooLarge::class.java) { fetch("/huge") }
    assertEquals(0L, file.length())
  }

  @Test
  fun typesAnUntypedResponseAsOctetStream() {
    assertEquals("application/octet-stream", fetch("/untyped"))
    assertEquals("done", file.readText())
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
  fun decodesADataUrlAsABrowserDoes() {
    val latin1 = byteArrayOf('c'.code.toByte(), 'a'.code.toByte(), 'f'.code.toByte(), 0xE9.toByte())
    for ((url, bytes, type) in listOf(
      Triple("data:text/plain,hi there", "hi there".toByteArray(), "text/plain"),
      Triple("data:text/plain,a%20b%2C%e2%82%ac 100%", "a b,€ 100%".toByteArray(), "text/plain"),
      Triple("data:text/plain;charset=iso-8859-1,caf%E9", latin1, "text/plain"), // not UTF-8: the bytes as they are
      Triple("data:image/png;base64,SGVsbG8=", "Hello".toByteArray(), "image/png"),
      Triple("data:application/pdf;base64,%2B%2F8%3D", byteArrayOf(0xFB.toByte(), 0xFF.toByte()), "application/pdf"),
      Triple("data:text/csv;charset=utf-8;base64,YSxi", "a,b".toByteArray(), "text/csv"),
      Triple("data:text/plain;BASE64,SGVs%20bG8", "Hello".toByteArray(), "text/plain"),
      Triple("data:;base64,SGk=", "Hi".toByteArray(), "application/octet-stream"),
      Triple("data:,", ByteArray(0), "application/octet-stream")
    )) {
      val (decodedBytes, decodedType) = Downloads.decodeDataUrl(url)
      assertArrayEquals(url, bytes, decodedBytes)
      assertEquals(url, type, decodedType)
    }
  }

  @Test
  fun failsAMalformedDataUrl() {
    for (url in listOf("data:text/plain;base64,SGVsb", "data:;base64,SGk=SGk=", "data:text/plain", "data:")) {
      assertThrows(url, IllegalArgumentException::class.java) { Downloads.decodeDataUrl(url) }
    }
  }

  @Test
  fun readsABlobChunkAndAnEmptyBlobsBareDataUrl() {
    val (bytes, type) = Downloads.decodeChunk("data:image/png;base64,SGVsbG8=")
    assertArrayEquals("Hello".toByteArray(), bytes)
    assertEquals("image/png", type)
    val (empty, emptyType) = Downloads.decodeChunk("data:") // FileReader.readAsDataURL of an empty blob in Chromium
    assertArrayEquals(ByteArray(0), empty)
    assertEquals("application/octet-stream", emptyType)
    assertThrows(IllegalArgumentException::class.java) { Downloads.decodeChunk("data:text/plain") }
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
    val route = routes.getValue(path.substringBefore('?'))
    val length = if ("Content-Length" in route) "" else "\r\nContent-Length: 4"
    val response = "HTTP/1.1 $route$length\r\nConnection: close\r\n\r\ndone"
    socket.getOutputStream().write(response.toByteArray())
  }
}
