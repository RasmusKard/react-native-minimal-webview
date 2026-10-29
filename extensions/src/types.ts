import type { WebViewProps as CoreWebViewProps } from 'minimal-rn-webview';

/**
 * A user name and password, for {@link ExtensionProps.basicAuthCredential}.
 * @group Props
 */
export type BasicAuthCredential = { username: string; password: string };

/**
 * An item of the text selection menu, for {@link ExtensionProps.menuItems}.
 * @group Props
 */
export type MenuItem = {
  /** What the menu shows. */
  label: string;
  /** What {@link ExtensionProps.onCustomMenuSelection} gets when it is chosen. */
  key: string;
};

/**
 * A system item of the text selection menu, by react-native-webview's name, for
 * {@link ExtensionProps.suppressMenuItems}.
 * @ios
 * @group Props
 */
export type SuppressMenuItem =
  | 'cut'
  | 'copy'
  | 'paste'
  | 'replace'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'select'
  | 'selectAll'
  | 'translate'
  | 'lookup'
  | 'share';

/**
 * A layer type of Android's `View.setLayerType`, for {@link ExtensionProps.androidLayerType}.
 * @android
 * @group Props
 */
export type AndroidLayerType = 'none' | 'software' | 'hardware';

/**
 * An item chosen from the text selection menu, for {@link ExtensionProps.onCustomMenuSelection}.
 * @group Events
 */
export type CustomMenuSelectionEvent = {
  nativeEvent: {
    label: string;
    key: string;
    /** The main frame's selected text (`window.getSelection()`). */
    selectedText: string;
  };
};

/**
 * A scroll, for {@link ExtensionProps.onScroll}: react-native-webview's event, in points (iOS) or dp (Android).
 * @group Events
 */
export type ScrollEvent = {
  nativeEvent: {
    contentOffset: { x: number; y: number };
    /** All 0 on Android. */
    contentInset: { top: number; left: number; bottom: number; right: number };
    contentSize: { width: number; height: number };
    /** The WebView's own size. */
    layoutMeasurement: { width: number; height: number };
    /** @ios */
    zoomScale?: number;
  };
};

/**
 * A page's `alert`, `confirm` or `prompt`, for {@link ExtensionProps.onDialog}.
 * @group Events
 */
export type Dialog = {
  type: 'alert' | 'confirm' | 'prompt';
  message: string;
  /** A prompt's default text; null for an alert or a confirm. */
  defaultValue: string | null;
  /** The URL of the page (iOS: of the frame) that opened it. */
  url: string;
  /**
   * Whether the main frame opened it.
   * @ios
   */
  isTopFrame?: boolean;
};

/**
 * The react-native-webview props this package brings back, each by a native hook of its own.
 *
 * Setting a prop turns its hook on, and a change reaches the hook live, without recreating the WebView. A hook attaches
 * only to a WebView that has set its prop, so a prop never set costs nothing. A prop marked for one platform does
 * nothing on the other.
 * @group WebView
 */
export interface ExtensionProps {
  /**
   * The credential the WebView answers HTTP auth challenges with, on every host.
   *
   * iOS answers HTTP basic challenges, and doesn't send a credential again once the site has rejected it; Android
   * answers every HTTP auth request. A change applies from the next challenge. Without it, and for the challenges it
   * doesn't answer, the core's handling applies: the challenge is declined and the site's 401 page shows.
   */
  basicAuthCredential?: BasicAuthCredential;
  /**
   * Answers the page's `alert`, `confirm` and `prompt` instead of the native dialogs; the page waits for the answer.
   *
   * The return value (a promise is awaited) is the answer: `true` accepts a confirm, a string is a prompt's text, and
   * anything else, a throw too, dismisses the dialog (confirm false, prompt null). An alert's answer doesn't matter.
   * There is no timeout: `signal` aborts when the page goes away first (a crash, an unmount), and the dialog is then
   * dismissed. Without it, the core's dialogs show. Not a react-native-webview prop, whose dialogs are native.
   */
  onDialog?: (dialog: Dialog, signal: AbortSignal) => unknown;
  /**
   * Items that replace the system's in the text selection menu; {@link onCustomMenuSelection} gets the one chosen.
   *
   * Set it, or on iOS {@link suppressMenuItems}, when the WebView is created: a WebView created without either gets no
   * menu from them until it is created again, and the core warns. Once it has, a change, removal included, applies to the
   * next menu. Its hook makes the WebView from a class of its own, so when another hook's `webViewClass` or
   * `webViewFactory`, registered earlier, makes it instead, there is no menu and the core warns. On iOS the items are
   * added to WebKit's own selection menu.
   */
  menuItems?: readonly MenuItem[];
  /**
   * The system items to hide from the text selection menu.
   *
   * Set it when the WebView is created, as {@link menuItems}.
   * @ios
   */
  suppressMenuItems?: readonly SuppressMenuItem[];
  /** The {@link menuItems} item chosen, with the selected text. */
  onCustomMenuSelection?: (event: CustomMenuSelectionEvent) => void;
  /**
   * Each change of the scroll offset, with no throttling.
   *
   * On iOS, the offsets include the content inset adjustment unless `ios.scrollView.contentInsetAdjustmentBehavior` is
   * `never`, react-native-webview's default.
   */
  onScroll?: (event: ScrollEvent) => void;
  /**
   * Hides the bar above the keyboard (previous, next, done) for the page's inputs.
   *
   * It changes a private WebKit view, as react-native-webview does, so a WebKit update can stop it working.
   * @ios
   */
  hideKeyboardAccessoryView?: boolean;
  /**
   * Keeps a swipe that starts on the page for the page, inside a scrolling parent such as a `ScrollView`.
   *
   * `android.webView.nestedScrollingEnabled` doesn't do this: the parent still takes the swipe.
   * @android
   */
  nestedScrollEnabled?: boolean;
  /**
   * The WebView's layer type, kept on the WebView that replaces one whose renderer crashed.
   * @default `'none'`
   * @android
   */
  androidLayerType?: AndroidLayerType;
}

/**
 * The props of this package's {@link WebView}: the core's `WebViewProps` and the {@link ExtensionProps}.
 * @group WebView
 */
export type WebViewProps = CoreWebViewProps & ExtensionProps;
