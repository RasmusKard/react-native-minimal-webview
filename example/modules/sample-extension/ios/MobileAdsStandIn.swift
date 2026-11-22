import WebKit

/// A stand-in under the Google Mobile Ads SDK's Objective-C class name, for the extensions suite's googleMobileAds()
/// check.
@objc(GADMobileAds)
final class MobileAdsStandIn: NSObject {
  @objc static let sharedInstance = MobileAdsStandIn()
  private(set) var registeredAt: [String] = []

  @objc(registerWebView:)
  func register(_ webView: WKWebView) {
    registeredAt.append(webView.url?.absoluteString ?? "")
  }
}
