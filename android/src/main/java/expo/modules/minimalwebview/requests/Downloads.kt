package expo.modules.minimalwebview.requests

import android.net.Uri
import android.util.Log
import android.webkit.CookieManager
import androidx.webkit.URLUtilCompat
import expo.modules.minimalwebview.MinimalWebView
import expo.modules.minimalwebview.TAG
import expo.modules.minimalwebview.mainHandler
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

internal class HttpStatus(val code: Int) : IOException("HTTP $code")

internal class TooLarge : IOException(Downloads.TOO_LARGE)

internal data class DownloadInfo(
  val url: String,
  val userAgent: String,
  val contentDisposition: String,
  val mimeType: String
)

// WebView hands over only the URL.
internal class Downloads(private val owner: MinimalWebView) {
  private val io = Executors.newSingleThreadExecutor()

  fun onDownloadStart(download: DownloadInfo): Boolean {
    if ("onDownload" !in owner.requestHandlers) return false
    val name = safeName(URLUtilCompat.guessFileName(download.url, download.contentDisposition.ifEmpty { null }, download.mimeType))
    when {
      download.url.startsWith("blob:") -> readBlob(download.url, name)
      download.url.startsWith("data:") -> save(name, download.url) { file -> append(file, decodeDataUrl(download.url)) }
      download.url.startsWith("http:") || download.url.startsWith("https:") -> {
        val cookies = profileOf(owner.webView)?.cookieManager ?: CookieManager.getInstance()
        save(name, download.url) { file -> fetchTo(download, file, cookies::getCookie, cookies::setCookie) }
      }
      else -> failed(name, download.url, IOException("unsupported URL scheme"))
    }
    return true
  }

  private fun append(file: File, data: Pair<ByteArray, String>): String {
    file.appendBytes(data.first)
    return data.second
  }

  private fun save(name: String, url: String, write: (File) -> String) {
    val file = File(owner.webView.context.cacheDir, "downloads/${System.nanoTime()}/$name")
    io.execute {
      val result = try {
        file.parentFile?.mkdirs()
        write(file)
      } catch (e: Exception) {
        e
      }
      if (result is Exception) file.parentFile?.deleteRecursively()
      mainHandler.post {
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

  // WebView cannot fetch a blob: URL for us. A reply crosses as one Java string and is parsed twice, so a blob returned
  // whole fills the heap several times over.
  private fun readBlob(url: String, name: String) = save(name, url) { file ->
    var offset = 0L
    var type: String
    do {
      val (size, data) = readChunk(url, offset)
      type = append(file, decodeChunk(data))
      offset += CHUNK_BYTES
      if (offset > MAX_BYTES) throw TooLarge()
    } while (offset < size)
    type
  }

  private fun readChunk(url: String, offset: Long): Pair<Long, String> {
    val script = """
      fetch(${JSONObject.quote(url)}).then((r) => r.blob()).then((b) => new Promise((ok, fail) => {
        if (b.size > $MAX_BYTES) return fail(new Error(${JSONObject.quote(TOO_LARGE)}));
        const reader = new FileReader(); reader.onload = () => ok([b.size, reader.result]); reader.onerror = () => fail(reader.error);
        reader.readAsDataURL(b.slice($offset, $offset + $CHUNK_BYTES, b.type));
      }))
    """.trimIndent()
    val reply = ArrayBlockingQueue<Result<String>>(1)
    mainHandler.post { owner.evaluate(script) { reply.offer(it) } }
    val result = reply.poll(TIMEOUT_MS.toLong(), TimeUnit.MILLISECONDS) ?: throw IOException("the page did not read the blob in time")
    val json = result.getOrElse { throw IOException("could not read the blob: ${it.message}") }
    if (json.length > MAX_CHUNK_REPLY_CHARS) throw TooLarge()
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
    private const val MAX_MIB = 100L
    const val MAX_BYTES = MAX_MIB * 1024 * 1024
    const val TOO_LARGE = "larger than $MAX_MIB MiB"
    const val CHUNK_BYTES = 4L * 1024 * 1024
    private const val MAX_CHUNK_REPLY_CHARS = CHUNK_BYTES / 3 * 4 + 1024
    const val MAX_REDIRECTS = 20 // OkHttp's limit, which React Native's fetch uses
    const val TIMEOUT_MS = 30_000
    private val PERCENT_ESCAPE = Regex("%[0-9A-Fa-f]{2}")

    fun kind(error: Exception, fetched: Boolean) =
      if (fetched && error is IOException && error !is TooLarge) "network" else "data"

    // As in a browser, the body is percent-decoded to bytes, base64 bodies too (encodeURIComponent of the base64 text),
    // and `;base64` matches in any case.
    fun decodeDataUrl(url: String): Pair<ByteArray, String> {
      val comma = url.indexOf(',')
      require(comma >= 0) { "a data: URL without a comma" }
      val header = url.substring(0, comma).removePrefix("data:")
      val body = percentDecode(url.substring(comma + 1))
      // The MIME decoder skips what isn't base64 (whitespace above all), as android.util.Base64 does.
      val bytes = if (header.endsWith(";base64", ignoreCase = true)) Base64.getMimeDecoder().decode(body) else body
      return bytes to header.substringBefore(';').ifEmpty { "application/octet-stream" }
    }

    // Chromium reads an empty blob as a bare `data:`.
    fun decodeChunk(data: String): Pair<ByteArray, String> =
      if (data == "data:") ByteArray(0) to "application/octet-stream" else decodeDataUrl(data)

    private fun percentDecode(text: String): ByteArray {
      if ('%' !in text) return text.toByteArray()
      val latin1 = String(text.toByteArray(), Charsets.ISO_8859_1)
      return PERCENT_ESCAPE.replace(latin1) { it.value.substring(1).toInt(16).toChar().toString() }.toByteArray(Charsets.ISO_8859_1)
    }

    /** `guessFileName` keeps a page's `.` or `..` (a directory: the save fails with EISDIR) and can be empty. */
    fun safeName(name: String) = if (name.isEmpty() || name == "." || name == "..") "download" else name

    // The Content-Length can be missing or wrong.
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

    // Chrome blocks an insecure download started from a secure one.
    fun redirectAllowed(from: URL, to: URL) = to.protocol == "https" || (to.protocol == "http" && from.protocol == "http")

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
