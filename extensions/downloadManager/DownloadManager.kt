package expo.modules.minimalwebviewextensions

import android.app.DownloadManager as SystemDownloadManager
import android.net.Uri
import android.os.Environment
import android.util.Log
import android.webkit.CookieManager
import android.widget.Toast
import androidx.webkit.URLUtilCompat
import expo.modules.minimalwebview.MinimalWebViewHooks

/**
 * The hook behind `downloadManager()`, react-native-webview's default Android downloads: each http(s) download goes to
 * the system Download Manager, into the public Downloads folder, which needs no permission since API 29. Its value may
 * have `downloadingMessage`.
 */
internal object DownloadManager {
  const val KEY = "@react-native-minimal-webview/extensions.downloadManager"
  /** react-native-webview's: characters a file name can't have. */
  private val INVALID = Regex("[\\\\/%\"]")

  fun register() = MinimalWebViewHooks.register(KEY) { webView, context ->
    context.onDownloadStart { url, userAgent, contentDisposition, mimeType, _ ->
      // blob: and data: URLs are the page's own: the Download Manager can't fetch them.
      if (!url.startsWith("http:") && !url.startsWith("https:")) return@onDownloadStart false
      val name = URLUtilCompat.guessFileName(url, contentDisposition.ifEmpty { null }, mimeType).replace(INVALID, "_")
      try {
        val request = SystemDownloadManager.Request(Uri.parse(url))
          .setTitle(name)
          .setNotificationVisibility(SystemDownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
          .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
          .addRequestHeader("User-Agent", userAgent)
        if (mimeType.isNotEmpty()) request.setMimeType(mimeType)
        CookieManager.getInstance().getCookie(url)?.let { request.addRequestHeader("Cookie", it) }
        webView.context.getSystemService(SystemDownloadManager::class.java).enqueue(request)
      } catch (e: RuntimeException) {
        // A disabled Download Manager fails in setDestinationInExternalPublicDir (a NullPointerException) or enqueue.
        Log.w("MinimalWebViewExtensions", "downloadManager: the Download Manager refused the download", e)
        return@onDownloadStart false
      }
      val message = (context.options as? Map<*, *>)?.get("downloadingMessage") as? String
      Toast.makeText(webView.context, message ?: "Downloading", Toast.LENGTH_LONG).show()
      true
    }
  }
}
