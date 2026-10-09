package expo.modules.minimalwebview.extensions

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Environment
import android.util.Base64
import android.webkit.CookieManager
import androidx.core.content.ContextCompat
import androidx.webkit.URLUtilCompat
import expo.modules.minimalwebview.DownloadInfo
import expo.modules.minimalwebview.ExtensionHost
import expo.modules.minimalwebview.WebViewExtension
import java.io.File

/**
 * Downloads: http(s) through DownloadManager with the page's cookies and user agent (system notification, the public
 * Downloads folder; no permission needed on API 29+); data: and blob: are written to the app cache. Each finished
 * download emits `download {uri, filename, mimeType, url}` for the app to share or move.
 */
class Downloads : WebViewExtension {
  private lateinit var host: ExtensionHost
  private val pending = mutableMapOf<Long, Pair<String, String>>() // DownloadManager id -> filename, mimeType
  private var receiver: BroadcastReceiver? = null

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
    val manager = context.getSystemService(DownloadManager::class.java)
    val request = DownloadManager.Request(Uri.parse(download.url))
      .setMimeType(download.mimeType)
      .addRequestHeader("User-Agent", download.userAgent)
      .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
      .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
    CookieManager.getInstance().getCookie(download.url)?.let { request.addRequestHeader("Cookie", it) }
    listen(context)
    pending[manager.enqueue(request)] = name to download.mimeType
  }

  private fun listen(context: Context) {
    if (receiver != null) return
    receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
        val (name, mimeType) = pending.remove(id) ?: return
        val uri = context.getSystemService(DownloadManager::class.java).getUriForDownloadedFile(id)
        host.emit("download", mapOf("uri" to uri?.toString(), "filename" to name, "mimeType" to mimeType, "url" to null))
      }
    }
    ContextCompat.registerReceiver(
      context, receiver, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), ContextCompat.RECEIVER_EXPORTED
    )
  }

  private fun saveData(url: String, name: String) {
    val header = url.substringBefore(',')
    val body = url.substringAfter(',')
    // The body may be percent-encoded even when base64 (encodeURIComponent of the base64 text).
    val bytes = if (header.endsWith(";base64")) Base64.decode(Uri.decode(body), Base64.DEFAULT) else Uri.decode(body).toByteArray()
    save(bytes, name, header.removePrefix("data:").substringBefore(';').ifEmpty { "application/octet-stream" }, url)
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
    poll(key, name, attempts = 50)
  }

  private fun poll(key: String, name: String, attempts: Int) {
    host.webView.postDelayed({
      host.webView.evaluateJavascript("(() => { const v = window.$key; if (v !== undefined) delete window.$key; return v; })()") { json ->
        val data = json?.takeIf { it != "null" }?.let { org.json.JSONTokener(it).nextValue() as? String }
        when {
          data == null && attempts > 0 -> poll(key, name, attempts - 1)
          !data.isNullOrEmpty() -> saveData(data, name)
        }
      }
    }, BLOB_POLL_MS)
  }

  private fun save(bytes: ByteArray, name: String, mimeType: String, url: String) {
    // One directory per download: the same guessed name must not overwrite a file already handed to the app.
    val dir = File(host.webView.context.cacheDir, "downloads/${System.nanoTime()}").apply { mkdirs() }
    val file = File(dir, name)
    file.writeBytes(bytes)
    host.emit("download", mapOf("uri" to Uri.fromFile(file).toString(), "filename" to name, "mimeType" to mimeType, "url" to url.take(100)))
  }

  private fun quote(value: String) = org.json.JSONObject.quote(value)

  override fun onDetach() {
    receiver?.let { host.webView.context.unregisterReceiver(it) }
    receiver = null
  }
}

private const val BLOB_POLL_MS = 100L
