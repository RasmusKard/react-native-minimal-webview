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
      download.url.startsWith("data:") -> saveData(download.url, name)
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

  private fun saveData(url: String, name: String) {
    val header = url.substringBefore(',')
    val body = url.substringAfter(',')
    val mimeType = header.removePrefix("data:").substringBefore(';').ifEmpty { "application/octet-stream" }
    val dir = File(host.webView.context.cacheDir, "downloads/${System.nanoTime()}")
    // Decoding and writing happen off the main thread; the event goes back on it.
    io.execute {
      val result = try {
        // The body may be percent-encoded even when base64 (encodeURIComponent of the base64 text).
        val bytes = if (header.endsWith(";base64")) Base64.decode(Uri.decode(body), Base64.DEFAULT) else Uri.decode(body).toByteArray()
        // One directory per download: the same guessed name must not overwrite a file already handed to the app.
        dir.mkdirs()
        File(dir, name).apply { writeBytes(bytes) }
      } catch (e: IllegalArgumentException) {
        e // invalid base64
      } catch (e: IOException) {
        e
      }
      host.webView.post {
        when (result) {
          is File -> host.emit(
            "download",
            mapOf("uri" to Uri.fromFile(result).toString(), "filename" to name, "mimeType" to mimeType, "url" to url.take(100))
          )
          is Exception -> failed(name, url, result)
        }
      }
    }
  }

  /** WebView cannot hand blob: URLs to DownloadManager: the page reads the blob and posts it back as a data: URL. */
  private fun readBlob(url: String, name: String) {
    val key = "__mwvBlob" + System.nanoTime()
    host.webView.evaluateJavascript(
      """
      fetch(${quote(url)}).then((r) => r.blob()).then((b) => new Promise((ok) => {
        const reader = new FileReader(); reader.onload = () => ok(reader.result); reader.readAsDataURL(b);
      })).then((data) => { window.${key} = data; }, () => { window.${key} = ''; });
      """.trimIndent(),
      null
    )
    poll(key, url, name, attempts = 50)
  }

  private fun poll(key: String, url: String, name: String, attempts: Int) {
    host.webView.postDelayed({
      host.webView.evaluateJavascript("(() => { const v = window.$key; if (v !== undefined) delete window.$key; return v; })()") { json ->
        val data = json?.takeIf { it != "null" }?.let { org.json.JSONTokener(it).nextValue() as? String }
        when {
          data == null && attempts > 0 -> poll(key, url, name, attempts - 1)
          !data.isNullOrEmpty() -> saveData(data, name)
          else -> failed(name, url, IOException("could not read the blob"))
        }
      }
    }, BLOB_POLL_MS)
  }

  private fun failed(name: String, url: String, error: Exception) {
    Log.w(TAG, "download of $name failed", error)
    host.emit("downloadFailed", mapOf("filename" to name, "url" to url.take(100), "reason" to (error.message ?: error.toString())))
  }

  private fun quote(value: String) = org.json.JSONObject.quote(value)

  override fun onDetach() {
    receiver?.let { host.webView.context.unregisterReceiver(it) }
    receiver = null
    io.shutdown()
  }
}

private const val BLOB_POLL_MS = 100L
