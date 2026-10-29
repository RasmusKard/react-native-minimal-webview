import Foundation

/// The read root of a `file:` load the app starts, from `source.readAccessRoot`.
enum ReadAccess {
  /// `root` when it is a `file:` URL that contains `file`, else `file`'s directory and a warning that says why `root`
  /// didn't apply. Always a file URL: loadFileURL raises an exception (a crash) for any other.
  static func root(for file: URL, _ root: String?) -> (root: URL, warning: String?) {
    let directory = file.deletingLastPathComponent()
    guard let root else { return (directory, nil) }
    guard let url = URL(string: root), url.isFileURL else {
      return (directory, "source.readAccessRoot \(root) is not a file: URL, so the file's directory applies")
    }
    // Components, not a string prefix: `..` is resolved, and /a/site2 isn't inside /a/site.
    guard file.standardizedFileURL.pathComponents.starts(with: url.standardizedFileURL.pathComponents) else {
      return (directory, "source.readAccessRoot \(root) doesn't contain \(file.absoluteString), so the file's directory applies")
    }
    return (url, nil)
  }
}
