import WebKit

/// The `onDownload` prop, through WKDownload. Without the prop, `openDownload` takes the URL.
final class Downloads: NSObject, WKDownloadDelegate {
  private weak var view: MinimalWebView?
  private var files: [ObjectIdentifier: (url: URL, mimeType: String)] = [:]

  init(view: MinimalWebView) {
    self.view = view
  }

  /// A main-frame response that is a file, not a page.
  static func isDownload(_ response: WKNavigationResponse) -> Bool {
    let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
    return response.isForMainFrame && (disposition.lowercased().hasPrefix("attachment") || !response.canShowMIMEType)
  }

  func download(
    _ download: WKDownload,
    decideDestinationUsing response: URLResponse,
    suggestedFilename: String,
    completionHandler: @escaping @MainActor (URL?) -> Void
  ) {
    // The server or the page names the file: only its last path component is kept, so it stays in its directory.
    let name = (suggestedFilename as NSString).lastPathComponent
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let file = dir.appendingPathComponent(name.isEmpty ? "download" : name)
    files[ObjectIdentifier(download)] = (file, response.mimeType ?? "application/octet-stream")
    completionHandler(file)
  }

  func downloadDidFinish(_ download: WKDownload) {
    guard let file = files.removeValue(forKey: ObjectIdentifier(download)) else { return }
    view?.emit("core", "onDownload", [
      "ok": true, "uri": file.url.absoluteString, "filename": file.url.lastPathComponent, "mimeType": file.mimeType,
      "url": serverUrl(download)
    ])
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    let file = files.removeValue(forKey: ObjectIdentifier(download))
    view?.emit("core", "onDownload", [
      "ok": false, "kind": (error as NSError).domain == NSURLErrorDomain ? "network" : "data",
      "filename": file?.url.lastPathComponent ?? "", "url": serverUrl(download), "description": error.localizedDescription
    ])
  }

  private func serverUrl(_ download: WKDownload) -> Any {
    guard let url = download.originalRequest?.url, ["http", "https"].contains(url.scheme?.lowercased()) else { return NSNull() }
    return url.absoluteString
  }
}
