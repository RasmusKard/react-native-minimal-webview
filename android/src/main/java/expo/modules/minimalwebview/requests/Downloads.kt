package expo.modules.minimalwebview.requests

import android.net.Uri
import android.util.Log
import android.webkit.CookieManager
import androidx.webkit.URLUtilCompat
import expo.modules.minimalwebview.MinimalWebView
import expo.modules.minimalwebview.TAG
import expo.modules.minimalwebview.profileOf
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Base64
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** The server answered [code], not 2xx. */
internal class HttpStatus(val code: Int) : IOException("HTTP $code")

/** The file is above [Downloads.MAX_BYTES]. */
internal class TooLarge : IOException(Downloads.TOO_LARGE)

/** What WebView's DownloadListener reports. */
internal data class DownloadInfo(
  val url: String,
  val userAgent: String,
  val contentDisposition: String,
  val mimeType: String
)

/**
 * The `onDownload` prop. WebView hands over only the URL, so http(s) is fetched again, through `HttpURLConnection` and
 * the WebView profile's `CookieManager` rather than React Native's OkHttp, so the package builds without
 * `react-android`. Nothing here may crash the app: the page controls the URL.
 */
internal class Downloads(private val owner: MinimalWebView) {
  private val io = Executors.newSingleThreadExecutor()

  /** Returns true when the app's prop takes the download. */
  fun onDownloadStart(download: DownloadInfo): Boolean {
    if ("onDownload" !in owner.requestHandlers) return false
    val name = safeName(URLUtilCompat.guessFileName(download.url, download.contentDisposition.ifEmpty { null }, download.mimeType))
    when {
      download.url.startsWith("blob:") -> readBlob(download.url, name)
      download.url.startsWith("data:") -> save(name, download.url) { file -> append(file, decodeDataUrl(download.url)) }
      download.url.startsWith("http:") || download.url.startsWith("https:") -> fetch(download, name)
      else -> failed(name, download.url, IOException("unsupported URL scheme"))
    }
    return true
  }

  private fun fetch(download: DownloadInfo, name: String) {
    val cookies = profileOf(owner.webView)?.cookieManager ?: CookieManager.getInstance()
    save(name, download.url) { file -> fetchTo(download, file, cookies::getCookie, cookies::setCookie) }
  }

  /** Appends a decoded data: URL's bytes to [file], creating it, and returns its MIME type. */
  private fun append(file: File, data: Pair<ByteArray, String>): String {
    file.appendBytes(data.first)
    return data.second
  }

  /**
   * Runs [write] off the main thread (a download can be megabytes); it fills the file and returns its MIME type. One
   * directory per download, so the same guessed name never overwrites a file already handed to the app. The event goes
   * back on the main thread. [url] is the download's own URL, for the event.
   */
  private fun save(name: String, url: String, write: (File) -> String) {
    val file = File(owner.webView.context.cacheDir, "downloads/${System.nanoTime()}/$name")
    io.execute {
      val result = try {
        file.parentFile?.mkdirs()
        write(file)
      } catch (e: Exception) {
        // a malformed data: URL or forged JSON from the page: no failure may reach the io thread
        e
      }
      if (result is Exception) file.parentFile?.deleteRecursively() // no partial file stays in the cache
      owner.mainHandler.post {
        when (result) {
          is String -> owner.emit(
            "core", "onDownload",
            mapOf("ok" to true, "uri" to Uri.fromFile(file).toString(), "filename" to name, "mimeType" to result, "url" to serverUrl(url))
          )
          is Exception -> failed(name, url, result)
        }
      }
    }
  }

  /**
   * WebView cannot fetch a blob: URL for us: the page reads it and returns it as data: URLs, [CHUNK_BYTES] at a time,
   * each awaited on the io thread. A reply crosses as one Java string and is parsed twice, so a blob returned whole
   * fills the heap several times over.
   */
  private fun readBlob(url: String, name: String) = save(name, url) { file ->
    var offset = 0L
    var type: String
    do {
      val (size, data) = readChunk(url, offset)
      type = append(file, decodeChunk(data))
      offset += CHUNK_BYTES
      if (offset > MAX_BYTES) throw TooLarge() // the page's own size check can be forged
    } while (offset < size)
    type
  }

  /** Asks the page, from the io thread, for the blob's size and the data: URL of its [CHUNK_BYTES] at [offset]. */
  private fun readChunk(url: String, offset: Long): Pair<Long, String> {
    val script = """
      fetch(${JSONObject.quote(url)}).then((r) => r.blob()).then((b) => new Promise((ok, fail) => {
        if (b.size > $MAX_BYTES) return fail(new Error(${JSONObject.quote(TOO_LARGE)}));
        const reader = new FileReader(); reader.onload = () => ok([b.size, reader.result]); reader.onerror = () => fail(reader.error);
        reader.readAsDataURL(b.slice($offset, $offset + $CHUNK_BYTES, b.type));
      }))
    """.trimIndent()
    val reply = ArrayBlockingQueue<Result<String>>(1)
    owner.mainHandler.post { owner.evaluate(script) { reply.offer(it) } }
    val result = reply.poll(TIMEOUT_MS.toLong(), TimeUnit.MILLISECONDS) ?: throw IOException("the page did not read the blob in time")
    val json = result.getOrElse { throw IOException("could not read the blob: ${it.message}") }
    // A reply far longer than a chunk's data: URL is forged: refuse it before it is copied twice more.
    if (json.length > CHUNK_BYTES / 3 * 4 + 1024) throw TooLarge()
    val chunk = JSONTokener(json).nextValue() as? JSONArray ?: throw IOException("could not read the blob")
    return chunk.getLong(0) to chunk.getString(1)
  }

  private fun failed(name: String, url: String, error: Exception) {
    Log.w(TAG, "download of $name failed", error)
    if (error is HttpStatus) {
      return owner.emit("core", "onDownload", mapOf("ok" to false, "kind" to "http", "filename" to name, "url" to url, "statusCode" to error.code))
    }
    owner.emit(
      "core", "onDownload",
      mapOf("ok" to false, "kind" to kind(error, serverUrl(url) != null), "filename" to name, "url" to serverUrl(url), "description" to (error.message ?: error.toString()))
    )
  }

  private fun serverUrl(url: String) = url.takeIf { it.startsWith("http:") || it.startsWith("https:") }

  fun detach() {
    io.shutdown()
  }

  internal companion object {
    // The page picks the file, and an http(s) one fills the cache: above this a download fails instead.
    const val MAX_BYTES = 100L * 1024 * 1024
    const val TOO_LARGE = "larger than 100 MB"
    const val CHUNK_BYTES = 4L * 1024 * 1024
    const val MAX_REDIRECTS = 20 // OkHttp's, which React Native's fetch uses
    const val TIMEOUT_MS = 30_000
    private val PERCENT_ESCAPE = Regex("%[0-9A-Fa-f]{2}")

    /**
     * A failed download's `kind` other than `http`: everything but a [fetched] (http(s)) download's own IOException is
     * the content's.
     */
    fun kind(error: Exception, fetched: Boolean) =
      // shortcut: a disk error while an http(s) body streams reads as network; tell them apart if apps need to.
      if (fetched && error is IOException && error !is TooLarge) "network" else "data"

    /**
     * A data: URL's bytes and its MIME type, application/octet-stream when it names none. As in a browser, the body is
     * percent-decoded to bytes, even when base64 (encodeURIComponent of the base64 text), and `;base64` is in any case.
     * Throws IllegalArgumentException for a URL without a comma or with bad base64.
     */
    fun decodeDataUrl(url: String): Pair<ByteArray, String> {
      val comma = url.indexOf(',')
      require(comma >= 0) { "a data: URL without a comma" }
      val header = url.substring(0, comma).removePrefix("data:")
      val body = percentDecode(url.substring(comma + 1))
      // The MIME decoder skips what isn't base64 (whitespace above all), as android.util.Base64 does.
      val bytes = if (header.endsWith(";base64", ignoreCase = true)) Base64.getMimeDecoder().decode(body) else body
      return bytes to header.substringBefore(';').ifEmpty { "application/octet-stream" }
    }

    /**
     * A blob chunk's bytes and MIME type, from FileReader's data: URL. Chromium reads an empty blob as a bare `data:`,
     * which [decodeDataUrl] refuses (a page's own data: URL without a comma is malformed): that is no bytes.
     */
    fun decodeChunk(data: String): Pair<ByteArray, String> =
      if (data == "data:") ByteArray(0) to "application/octet-stream" else decodeDataUrl(data)

    /** [text]'s UTF-8 bytes, each `%` and two hex digits made the byte they name: not decoded as UTF-8 again. */
    private fun percentDecode(text: String): ByteArray {
      if ('%' !in text) return text.toByteArray() // a blob's chunks: spares two copies of megabytes
      // Latin-1 maps each byte to one char and back, so the escapes are replaced in a string.
      val latin1 = String(text.toByteArray(), Charsets.ISO_8859_1)
      return PERCENT_ESCAPE.replace(latin1) { it.value.substring(1).toInt(16).toChar().toString() }.toByteArray(Charsets.ISO_8859_1)
    }

    /** `guessFileName` keeps a page's `.` or `..` (a directory: the save fails with EISDIR) and can be empty. */
    fun safeName(name: String) = if (name.isEmpty() || name == "." || name == "..") "download" else name

    /** Copies [input] to [output] and fails once more than [max] bytes came: the Content-Length can be missing or wrong. */
    fun copyCapped(input: InputStream, output: OutputStream, max: Long) {
      val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
      var total = 0L
      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        total += read
        if (total > max) throw TooLarge()
        output.write(buffer, 0, read)
      }
    }

    /** Fetches [download] into [file] and returns its MIME type. [cookie] and [setCookie] are the WebView's cookie store. */
    fun fetchTo(download: DownloadInfo, file: File, cookie: (String) -> String?, setCookie: (String, String) -> Unit): String {
      val connection = connect(URL(download.url), download.userAgent, cookie, setCookie)
      try {
        if (connection.responseCode !in 200..299) throw HttpStatus(connection.responseCode)
        if (connection.contentLengthLong > MAX_BYTES) throw TooLarge()
        connection.inputStream.use { input -> file.outputStream().use { output -> copyCapped(input, output, MAX_BYTES) } }
        return download.mimeType.ifEmpty { connection.contentType?.substringBefore(';') ?: "application/octet-stream" }
      } finally {
        connection.disconnect()
      }
    }

    /** Whether a download follows a redirect [from] one URL [to] another: only to https, or from http to http. */
    fun redirectAllowed(from: URL, to: URL) = to.protocol == "https" || (to.protocol == "http" && from.protocol == "http")

    /**
     * Opens [url] and follows its redirects (http to https too) by hand: each hop sends the cookies for its own URL and
     * stores what the server sets back, as React Native's fetch does. A hop must be [redirectAllowed]: Chrome blocks an
     * insecure download started from a secure one.
     */
    private fun connect(url: URL, userAgent: String, cookie: (String) -> String?, setCookie: (String, String) -> Unit): HttpURLConnection {
      var current = url
      repeat(MAX_REDIRECTS + 1) {
        val at = current.toString()
        val connection = current.openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = false
        connection.connectTimeout = TIMEOUT_MS
        connection.readTimeout = TIMEOUT_MS
        connection.setRequestProperty("User-Agent", userAgent)
        cookie(at)?.let { connection.setRequestProperty("Cookie", it) }
        val code = connection.responseCode
        // Header names come in any case (HTTP/2 lowercases them), and headerFields' keys keep it.
        for ((key, values) in connection.headerFields) if (key.equals("Set-Cookie", ignoreCase = true)) values.forEach { setCookie(at, it) }
        val location = connection.getHeaderField("Location")
        if (code !in 300..399 || location == null) return connection
        connection.disconnect()
        val next = URL(current, location)
        if (!redirectAllowed(current, next)) throw IOException("refused a redirect from ${current.protocol} to ${next.protocol}")
        current = next
      }
      throw IOException("more than $MAX_REDIRECTS redirects")
    }
  }
}
