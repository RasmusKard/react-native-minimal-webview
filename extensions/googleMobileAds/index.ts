import type { HookEvent, HookExtension } from 'react-native-minimal-webview';

/**
 * Registers the WebView with the Google Mobile Ads SDK, Google's WebView API for Ads
 * ([Android](https://developers.google.com/admob/android/browser/webview/api-for-ads),
 * [iOS](https://developers.google.com/admob/ios/browser/webview/api-for-ads)), so that AdSense and Ad Manager ads on
 * the page get the app's signals.
 *
 * This package doesn't include the SDK: add it to the app, for example with react-native-google-mobile-ads, and set it
 * up as Google's page says. Without it, the WebView isn't registered and this logs a `console.error`.
 *
 * Turn it on when the WebView is created: Google requires the WebView to be registered before it loads anything, so
 * the hook registers it then. Turned on later, the core warns and it does nothing.
 *
 * Google also asks for video autoplay without a tap, which is off by default: set
 * [`android.settings.mediaPlaybackRequiresUserGesture`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/AndroidSettings/#settings)
 * to `false`, and
 * [`ios.configuration.mediaTypesRequiringUserActionForPlayback`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/IOSSettings/#configuration)
 * to `IOSConstants.AudiovisualMediaTypes.none`. The other settings it lists are on by default.
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
