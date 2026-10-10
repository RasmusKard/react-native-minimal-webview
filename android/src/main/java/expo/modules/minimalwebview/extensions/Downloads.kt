package expo.modules.minimalwebview.extensions

import android.net.Uri
import android.util.Base64
import android.util.Log
import android.webkit.CookieManager
import androidx.webkit.URLUtilCompat
import expo.modules.minimalwebview.DownloadInfo
import expo.modules.minimalwebview.ExtensionHost
import expo.modules.minimalwebview.TAG
import expo.modules.minimalwebview.WebViewExtension
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Downloads: http(s) is fetched again with the page's cookies and user agent (WebView hands over only the URL), data:
 * is decoded, and blob: is read by the page. Each lands in its own app-cache directory and emits
 * `download {uri, filename, mimeType, url}`, as on iOS; a failed one emits `downloadFailed {filename, url, reason}`.
 * Nothing here may crash the app: the page controls the URL.
 */
class Downloads : WebViewExtension {
  private lateinit var host: ExtensionHost
  private val io = Executors.newCachedThreadPool()

  override fun onAttach(host: ExtensionHost, config: Map<String, Any?>) {
    this.host = host
  }

  override fun onDownloadStart(download: DownloadInfo): Boolean {
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
    // Read on the main thread: CookieManager belongs to the WebView's thread.
    val cookie = CookieManager.getInstance().getCookie(download.url)
    save(name, download.url) { file ->
      val connection = URL(download.url).openConnection() as HttpURLConnection
      try {
        connection.connectTimeout = TIMEOUT_MS
        connection.readTimeout = TIMEOUT_MS
        connection.setRequestProperty("User-Agent", download.userAgent)
        cookie?.let { connection.setRequestProperty("Cookie", it) }
        val status = connection.responseCode
        if (status !in 200..299) throw IOException("HTTP $status")
        connection.inputStream.use { input -> file.outputStream().use { input.copyTo(it) } }
        download.mimeType.ifEmpty { connection.contentType?.substringBefore(';') ?: "application/octet-stream" }
      } finally {
        connection.disconnect()
      }
    }
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
    val file = File(host.webView.context.cacheDir, "downloads/${System.nanoTime()}/$name")
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
      host.webView.post {
        when (result) {
          is String -> host.emit(
            "download",
            mapOf("uri" to Uri.fromFile(file).toString(), "filename" to name, "mimeType" to result, "url" to url.take(100))
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
        const reader = new FileReader(); reader.onload = () => ok(reader.result); reader.onerror = () => fail(reader.error);
        reader.readAsDataURL(b);
      }))
    """.trimIndent()
    host.evaluate(script) { result ->
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
    host.emit("downloadFailed", mapOf("filename" to name, "url" to url.take(100), "reason" to (error.message ?: error.toString())))
  }

  override fun onDetach() {
    io.shutdown()
  }

  private companion object {
    const val TIMEOUT_MS = 30_000
  }
}
