import WebKit

/// Downloads through WKDownload (the page's session and cookies): `Content-Disposition: attachment`, types WebKit
/// cannot show, `<a download>` and blob: URLs. Files land in the app's temporary directory; each finished download
/// emits `download {uri, filename, mimeType, url}` for the app to share or move (expo-sharing, expo-file-system).
final class Downloads: NSObject, WebViewExtension, WKDownloadDelegate {
  // Strong: nothing else retains the host, and it holds the view weakly.
  private var host: ExtensionHost?
  private var files: [ObjectIdentifier: (url: URL, mimeType: String, source: String)] = [:]

  func attach(host: ExtensionHost, config: [String: Any]) {
    self.host = host
  }

  func decidePolicy(for response: WKNavigationResponse) -> WKNavigationResponsePolicy? {
    let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
    let attachment = disposition.lowercased().hasPrefix("attachment")
    return response.isForMainFrame && (attachment || !response.canShowMIMEType) ? .download : nil
  }

  func wantsDownload(_ action: WKNavigationAction) -> Bool {
    action.shouldPerformDownload
  }

  func didBecome(_ download: WKDownload) {
    download.delegate = self
  }

  func download(
    _ download: WKDownload,
    decideDestinationUsing response: URLResponse,
    suggestedFilename: String,
    completionHandler: @escaping @MainActor (URL?) -> Void
  ) {
    // The filename comes from the server or page: keep only its last path component.
    let name = (suggestedFilename as NSString).lastPathComponent
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let file = dir.appendingPathComponent(name.isEmpty ? "download" : name)
    files[ObjectIdentifier(download)] = (file, response.mimeType ?? "application/octet-stream", download.originalRequest?.url?.absoluteString ?? "")
    completionHandler(file)
  }

  func downloadDidFinish(_ download: WKDownload) {
    guard let file = files.removeValue(forKey: ObjectIdentifier(download)) else { return }
    host?.emit("download", [
      "uri": file.url.absoluteString, "filename": file.url.lastPathComponent, "mimeType": file.mimeType,
      "url": String(file.source.prefix(100))
    ])
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    let file = files.removeValue(forKey: ObjectIdentifier(download))
    host?.emit("downloadFailed", [
      "filename": file?.url.lastPathComponent ?? "", "url": String((file?.source ?? "").prefix(100)),
      "reason": error.localizedDescription
    ])
  }
}
