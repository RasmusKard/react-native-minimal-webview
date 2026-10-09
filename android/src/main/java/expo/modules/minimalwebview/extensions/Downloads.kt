package expo.modules.minimalwebview.extensions

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Environment
import android.util.Base64
import android.util.Log
import android.webkit.CookieManager
import androidx.core.content.ContextCompat
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
import java.util.concurrent.Executors

/**
 * Downloads: http(s) through DownloadManager with the page's cookies and user agent (system notification, the public
 * Downloads folder; no permission needed on API 29+); data: and blob: are written to the app cache. Each finished
 * download emits `download {uri, filename, mimeType, url}`; a failed one emits `downloadFailed {filename, url, reason}`.
 * Nothing here may crash the app: the page controls the URL and DownloadManager can be disabled.
 */
class Downloads : WebViewExtension {
  private lateinit var host: ExtensionHost
  private val pending = mutableMapOf<Long, Pair<String, String>>() // DownloadManager id -> filename, mimeType
  private var receiver: BroadcastReceiver? = null
  private val io = Executors.newSingleThreadExecutor()

  override fun onAttach(host: ExtensionHost, config: Map<String, Any?>) {
    this.host = host
  }

  override fun onDownloadStart(download: DownloadInfo): Boolean {
    val name = URLUtilCompat.guessFileName(download.url, download.contentDisposition.ifEmpty { null }, download.mimeType)
    when {
      download.url.startsWith("blob:") -> readBlob(download.url, name)
      download.url.startsWith("data:") -> saveData(name, download.url) { download.url }
      else -> enqueue(download, name)
    }
    return true
  }

  private fun enqueue(download: DownloadInfo, name: String) {
    val context = host.webView.context
    try {
      val manager = context.getSystemService(DownloadManager::class.java)
      val request = DownloadManager.Request(Uri.parse(download.url))
        .setTitle(name)
        .setMimeType(download.mimeType)
        .addRequestHeader("User-Agent", download.userAgent)
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
      CookieManager.getInstance().getCookie(download.url)?.let { request.addRequestHeader("Cookie", it) }
      listen(context)
      pending[manager.enqueue(request)] = name to download.mimeType
    } catch (e: IllegalArgumentException) {
      // Not an http(s) URL, or DownloadManager (the system app) is disabled.
      failed(name, download.url, e)
    } catch (e: IllegalStateException) {
      // The public Downloads directory is unavailable.
      failed(name, download.url, e)
    }
  }

  private fun listen(context: Context) {
    if (receiver != null) return
    receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
        val (name, mimeType) = pending.remove(id) ?: return
        val uri = context.getSystemService(DownloadManager::class.java).getUriForDownloadedFile(id)
        if (uri == null) {
          host.emit("downloadFailed", mapOf("filename" to name, "url" to null, "reason" to "DownloadManager reported a failure"))
        } else {
          host.emit("download", mapOf("uri" to uri.toString(), "filename" to name, "mimeType" to mimeType, "url" to null))
        }
      }
    }
    ContextCompat.registerReceiver(
      context, receiver, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), ContextCompat.RECEIVER_EXPORTED
    )
  }

  /**
   * Writes a data: URL, which [dataUrl] produces, to the cache. Unquoting, decoding and writing the payload (a blob can
   * be megabytes) run off the main thread; the event goes back on it. [url] is the download's own URL, for the event.
   */
  private fun saveData(name: String, url: String, dataUrl: () -> String) {
    val dir = File(host.webView.context.cacheDir, "downloads/${System.nanoTime()}")
    io.execute {
      val result = try {
        val data = dataUrl()
        val header = data.substringBefore(',')
        // The body may be percent-encoded even when base64 (encodeURIComponent of the base64 text).
        val body = data.substringAfter(',').let { if ('%' in it) Uri.decode(it) else it }
        val bytes = if (header.endsWith(";base64")) Base64.decode(body, Base64.DEFAULT) else body.toByteArray()
        // One directory per download: the same guessed name must not overwrite a file already handed to the app.
        dir.mkdirs()
        val mimeType = header.removePrefix("data:").substringBefore(';').ifEmpty { "application/octet-stream" }
        Saved(File(dir, name).apply { writeBytes(bytes) }, mimeType)
      } catch (e: IllegalArgumentException) {
        e // invalid base64
      } catch (e: IOException) {
        e
      } catch (e: JSONException) {
        e
      }
      host.webView.post {
        when (result) {
          is Saved -> host.emit(
            "download",
            mapOf("uri" to Uri.fromFile(result.file).toString(), "filename" to name, "mimeType" to result.mimeType, "url" to url.take(100))
          )
          is Exception -> failed(name, url, result)
        }
      }
    }
  }

  /** WebView cannot hand blob: URLs to DownloadManager: the page reads the blob and returns it as a data: URL. */
  private fun readBlob(url: String, name: String) {
    val script = """
      fetch(${JSONObject.quote(url)}).then((r) => r.blob()).then((b) => new Promise((ok, fail) => {
        const reader = new FileReader(); reader.onload = () => ok(reader.result); reader.onerror = () => fail(reader.error);
        reader.readAsDataURL(b);
      }))
    """.trimIndent()
    host.evaluate(script) { result ->
      result.fold(
        { json -> saveData(name, url) { JSONTokener(json).nextValue() as? String ?: throw IOException("could not read the blob") } },
        { error -> failed(name, url, IOException("could not read the blob: ${error.message}")) }
      )
    }
  }

  private fun failed(name: String, url: String, error: Exception) {
    Log.w(TAG, "download of $name failed", error)
    host.emit("downloadFailed", mapOf("filename" to name, "url" to url.take(100), "reason" to (error.message ?: error.toString())))
  }

  override fun onDetach() {
    receiver?.let { host.webView.context.unregisterReceiver(it) }
    receiver = null
    io.shutdown()
  }

  private class Saved(val file: File, val mimeType: String)
}
