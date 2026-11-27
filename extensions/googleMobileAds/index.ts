import type { HookEvent, HookExtension } from 'react-native-minimal-webview';

/**
 * Registers the WebView with the Google Mobile Ads SDK, so that AdSense and Ad Manager ads on the page get the app's
 * signals. Google's WebView API for Ads page has the setup for
 * [Android](https://developers.google.com/admob/android/browser/webview/api-for-ads) and
 * [iOS](https://developers.google.com/admob/ios/browser/webview/api-for-ads).
 *
 * This package doesn't include the SDK. Add it to the app, for example with react-native-google-mobile-ads, and set it
 * up as Google's page says. Without the SDK, the WebView isn't registered and this logs a `console.error`.
 *
 * Turn it on when the WebView is created, because Google requires the WebView to be registered before it loads
 * anything. Turned on later, it does nothing and the core warns.
 *
 * Google also asks for video autoplay without a tap, which is off by default. To allow it, set
 * [`android.settings.mediaPlaybackRequiresUserGesture`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/AndroidSettings/#settings)
 * to `false` and
 * [`ios.configuration.mediaTypesRequiringUserActionForPlayback`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/IOSSettings/#configuration)
 * to `IOSConstants.AudiovisualMediaTypes.none`.
 * @group Extensions
 */
export const googleMobileAds = (): HookExtension<
  HookEvent<'sdkMissing', Record<string, never>>
> => ({
  key: '@react-native-minimal-webview/extensions.googleMobileAds',
  onEvent: () =>
    console.error(
      '[@react-native-minimal-webview/extensions] googleMobileAds: the app has no Google Mobile Ads SDK that registers WebViews, so this WebView is not registered. Add the SDK to the app and rebuild it.'
    ),
});
