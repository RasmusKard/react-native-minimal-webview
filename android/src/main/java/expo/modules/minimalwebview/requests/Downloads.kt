package expo.modules.minimalwebview.requests

import android.net.Uri
import android.util.Base64
import android.util.Log
import android.webkit.CookieManager
import androidx.webkit.URLUtilCompat
import expo.modules.minimalwebview.MinimalWebView
import expo.modules.minimalwebview.TAG
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** What WebView's DownloadListener reports. */
internal data class DownloadInfo(
  val url: String,
  val userAgent: String,
  val contentDisposition: String,
  val mimeType: String
)

/**
 * Downloads, with the app's `onDownload`: http(s) is fetched again with the WebView's cookies and the page's user agent
 * (WebView hands over only the URL), data: is decoded, and blob: is read by the page. Each lands in its own app-cache
 * directory and emits `download {ok: true, uri, filename, mimeType, url}`, as on iOS; a failed one emits
 * `download {ok: false, filename, url, reason}`. `url` is the full http(s) URL, or null for data: and blob: (the page
 * made the file itself). Without the prop the core opens it externally. Nothing here may crash the app: the page
 * controls the URL.
 */
internal class Downloads(private val owner: MinimalWebView) {
  private val io = Executors.newSingleThreadExecutor()

  /** Returns true when the app's prop takes the download. */
  fun onDownloadStart(download: DownloadInfo): Boolean {
    if ("download" !in owner.requestHandlers) return false
    val name = URLUtilCompat.guessFileName(download.url, download.contentDisposition.ifEmpty { null }, download.mimeType)
    when {
      download.url.startsWith("blob:") -> readBlob(download.url, name)
      download.url.startsWith("data:") -> save(name, download.url) { file -> writeDataUrl(file, download.url) }
      download.url.startsWith("http:") || download.url.startsWith("https:") -> fetch(download, name)
      else -> failed(name, download.url, IOException("unsupported URL scheme"))
    }
    return true
  }

  private fun fetch(download: DownloadInfo, name: String) {
    val cookies = CookieManager.getInstance()
    save(name, download.url) { file -> fetchTo(download, file, cookies::getCookie, cookies::setCookie) }
  }

  /** Writes [data] (a data: URL) to [file] and returns its MIME type. */
  private fun writeDataUrl(file: File, data: String): String {
    val header = data.substringBefore(',')
    // The body may be percent-encoded even when base64 (encodeURIComponent of the base64 text).
    val body = data.substringAfter(',').let { if ('%' in it) Uri.decode(it) else it }
    file.writeBytes(if (header.endsWith(";base64")) Base64.decode(body, Base64.DEFAULT) else body.toByteArray())
    return header.removePrefix("data:").substringBefore(';').ifEmpty { "application/octet-stream" }
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
      } catch (e: IllegalArgumentException) {
        e // invalid base64
      } catch (e: IOException) {
        e
      } catch (e: JSONException) {
        e
      }
      if (result is Exception) file.parentFile?.deleteRecursively() // no partial file stays in the cache
      owner.mainHandler.post {
        when (result) {
          is String -> owner.emit(
            "core.download",
            mapOf("ok" to true, "uri" to Uri.fromFile(file).toString(), "filename" to name, "mimeType" to result, "url" to serverUrl(url))
          )
          is Exception -> failed(name, url, result)
        }
      }
    }
  }

  /** WebView cannot fetch a blob: URL for us: the page reads the blob and returns it as a data: URL. */
  private fun readBlob(url: String, name: String) {
    val script = """
      fetch(${JSONObject.quote(url)}).then((r) => r.blob()).then((b) => new Promise((ok, fail) => {
        if (b.size > $MAX_BYTES) return fail(new Error(${JSONObject.quote(TOO_LARGE)}));
        const reader = new FileReader(); reader.onload = () => ok(reader.result); reader.onerror = () => fail(reader.error);
        reader.readAsDataURL(b);
      }))
    """.trimIndent()
    owner.evaluate(script) { result ->
      result.fold(
        { json ->
          save(name, url) { file ->
            writeDataUrl(file, JSONTokener(json).nextValue() as? String ?: throw IOException("could not read the blob"))
          }
        },
        { error -> failed(name, url, IOException("could not read the blob: ${error.message}")) }
      )
    }
  }

  private fun failed(name: String, url: String, error: Exception) {
    Log.w(TAG, "download of $name failed", error)
    owner.emit("core.download", mapOf("ok" to false, "filename" to name, "url" to serverUrl(url), "reason" to (error.message ?: error.toString())))
  }

  /** The download's server URL for the events; null when the page generated the file (data:, blob:). */
  private fun serverUrl(url: String) = url.takeIf { it.startsWith("http:") || it.startsWith("https:") }

  fun detach() {
    io.shutdown()
  }

  internal companion object {
    // The page picks the file: a blob: passes whole through the app's memory several times (a data: URL, then its
    // bytes), and an http(s) one fills the cache, so above this a download fails instead of the app being killed.
    const val MAX_BYTES = 100L * 1024 * 1024
    const val TOO_LARGE = "larger than 100 MB"
    const val MAX_REDIRECTS = 20 // OkHttp's, which React Native's fetch uses
    const val TIMEOUT_MS = 30_000

    /** Copies [input] to [output] and fails once more than [max] bytes came: the Content-Length can be missing or wrong. */
    fun copyCapped(input: InputStream, output: OutputStream, max: Long) {
      val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
      var total = 0L
      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        total += read
        if (total > max) throw IOException(TOO_LARGE)
        output.write(buffer, 0, read)
      }
    }

    /** Fetches [download] into [file] and returns its MIME type. [cookie] and [setCookie] are the WebView's cookie store. */
    fun fetchTo(download: DownloadInfo, file: File, cookie: (String) -> String?, setCookie: (String, String) -> Unit): String {
      val connection = connect(URL(download.url), download.userAgent, cookie, setCookie)
      try {
        if (connection.responseCode !in 200..299) throw IOException("HTTP ${connection.responseCode}")
        if (connection.contentLengthLong > MAX_BYTES) throw IOException(TOO_LARGE)
        connection.inputStream.use { input -> file.outputStream().use { output -> copyCapped(input, output, MAX_BYTES) } }
        return download.mimeType.ifEmpty { connection.contentType?.substringBefore(';') ?: "application/octet-stream" }
      } finally {
        connection.disconnect()
      }
    }

    /**
     * Opens [url] and follows its redirects (http to https too) by hand: each hop sends the cookies for its own URL and
     * stores what the server sets back, as React Native's fetch does. A hop goes only to https, or from http to http:
     * Chrome blocks an insecure download started from a secure one.
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
        if (next.protocol != "https" && (next.protocol != "http" || current.protocol != "http")) {
          throw IOException("refused a redirect from ${current.protocol} to ${next.protocol}")
        }
        current = next
      }
      throw IOException("more than $MAX_REDIRECTS redirects")
    }
  }
}
