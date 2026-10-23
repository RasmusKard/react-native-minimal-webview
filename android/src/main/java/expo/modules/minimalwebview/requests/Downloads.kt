package expo.modules.minimalwebview.requests

import android.net.Uri
import android.util.Base64
import android.util.Log
import androidx.webkit.URLUtilCompat
import com.facebook.react.modules.network.ForwardingCookieHandler
import expo.modules.minimalwebview.MinimalWebView
import expo.modules.minimalwebview.TAG
import okhttp3.JavaNetCookieJar
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener
import java.io.File
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

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
    save(name, download.url) { file ->
      val request = Request.Builder().url(download.url).header("User-Agent", download.userAgent).build()
      client.newCall(request).execute().use { response ->
        if (!response.isSuccessful) throw IOException("HTTP ${response.code}")
        val body = response.body ?: throw IOException("no response body")
        if (body.contentLength() > MAX_BYTES) throw IOException(TOO_LARGE)
        body.byteStream().use { input ->
          file.outputStream().use { output ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            var total = 0L
            while (true) {
              val read = input.read(buffer)
              if (read < 0) break
              total += read
              if (total > MAX_BYTES) throw IOException(TOO_LARGE)
              output.write(buffer, 0, read)
            }
          }
        }
        download.mimeType.ifEmpty { response.header("Content-Type")?.substringBefore(';') ?: "application/octet-stream" }
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
      owner.webView.post {
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

  private companion object {
    // The page picks the file: a blob: passes whole through the app's memory several times (a data: URL, then its
    // bytes), and an http(s) one fills the cache, so above this a download fails instead of the app being killed.
    const val MAX_BYTES = 100L * 1024 * 1024
    const val TOO_LARGE = "larger than 100 MB"

    /**
     * Follows redirects (http to https too); each hop reads the WebView's cookies for its own host and stores what the
     * server sets back into them, as React Native's fetch does. A redirect from https to http is refused, as Chrome
     * blocks an insecure download started from a secure one.
     */
    val client: OkHttpClient by lazy {
      OkHttpClient.Builder()
        .cookieJar(JavaNetCookieJar(ForwardingCookieHandler()))
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .addNetworkInterceptor { chain ->
          if (chain.call().request().isHttps && !chain.request().isHttps) throw IOException("refused a redirect from https to http")
          chain.proceed(chain.request())
        }
        .build()
    }
  }
}
