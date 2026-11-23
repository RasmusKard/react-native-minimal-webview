import WebKit

@objc(GADMobileAds)
final class MobileAdsStandIn: NSObject {
  @objc static let sharedInstance = MobileAdsStandIn()
  private(set) var registeredAt: [String] = []

  @objc(registerWebView:)
  func register(_ webView: WKWebView) {
    registeredAt.append(webView.url?.absoluteString ?? "")
  }
}
