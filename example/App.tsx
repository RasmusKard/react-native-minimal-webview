import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  type HostInstance,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  type NavigationRule,
  type WebViewProps,
  type LoadErrorEvent,
  type WebViewSource,
  AndroidWebView,
  WebView,
  createBridge,
  type PermissionRequest,
  type FileRequest,
  type HookEvent,
  type HookExtension,
  useWebViewState,
  createWebViewRef,
} from 'react-native-minimal-webview';
import { type PageCounterEvent, pageCounter } from 'sample-extension';

import {
  SUITES,
  launchMarks,
  onDriverRequest,
  pollForSuites,
  type Harness,
  type HarnessProps,
} from './harness';

const PAGES = 'http://localhost:8090';
/** What the error screen shows: a load that failed. An HTTP error status shows the site's own page. */
type LoadFailure = Exclude<LoadErrorEvent, { kind: 'http' }>;
/**
 * The example's creation-time settings. A suite's extra `ios` keeps them unless it sets its own `configuration`:
 * dropping them would recreate the WebView, and with it start the crash-loop guard over.
 */
const IOS_CONFIGURATION = { applicationNameForUserAgent: 'MinimalWebViewExample/1.0' };
const ref = createWebViewRef();
let remount = () => {};
// Event logs the harness reads and clears. They live outside React: nothing renders them.
const events: Harness['events'] = {
  errors: [],
  gone: [],
  loads: [],
  outcomes: [],
  navigations: [],
  downloads: [],
  downloadFailures: [],
  fullscreen: [],
  pageCounts: [],
  documentEnds: [],
  hookEvents: [],
  overlay: { error: false },
};
const pageEvents: unknown[] = [];
const webViewOffset: Harness['webViewOffset'] = { x: 0, y: 0 };

/** The page counter's events, into the logs. */
function onPageCounterEvent(event: PageCounterEvent) {
  if (event.name === 'pageLoaded') events.pageCounts.push(event.payload);
  else if (event.name === 'documentEnd') events.documentEnds.push(event.payload);
  // The hook's ask: the return value is its answer.
  else if (event.name === 'label') return `page ${event.payload.count}`;
  else events.hookEvents.push(`sample.pageCounter.${event.name}`);
  return undefined;
}

const EXTENSIONS_KEY = '@react-native-minimal-webview/extensions';
/**
 * Owns the extensions package's key prefix, with no hook (`options: null`): an event of one of its hooks that no
 * extension of the WebView owns, a hook that stayed on after its extension left, comes here. The longest key wins, so the
 * extensions in use never reach it.
 */
const strayEvents: HookExtension = {
  key: EXTENSIONS_KEY,
  options: null,
  onEvent: ({ name }) => void events.hookEvents.push(`${EXTENSIONS_KEY}.${name}`),
};

/** Remounts its children on `remount()`, without re-rendering App. */
function Remountable({ children }: { children: ReactNode }) {
  const [key, setKey] = useState(0);
  useEffect(() => {
    remount = () => setKey((k) => k + 1);
  }, []);
  return <Fragment key={key}>{children}</Fragment>;
}

export default function App() {
  launchMarks.render ??= performance.now();
  const [extraWebViews, setExtraWebViews] = useState(0);
  const [source, setSource] = useState<WebViewSource>({ uri: `${PAGES}/` });
  const [rules, setRules] = useState<NavigationRule[] | undefined>();
  const [extraProps, setProps] = useState<HarnessProps>({});
  const [driverRequest, setDriverRequest] = useState('');
  const [error, setError] = useState<LoadFailure | null>(null);
  useEffect(() => {
    onDriverRequest(setDriverRequest);
  }, []);
  const askRef = useRef<WebViewProps['onNavigationRequest']>(undefined);
  const webViewBox = useRef<HostInstance>(null);
  const bridge = useMemo(() => {
    const b = createBridge({ allowedOrigins: [PAGES], timeoutMs: 3000 });
    b.handle('echo', (params) => params);
    b.handle('fail', () => {
      throw new Error('handler failed on purpose');
    });
    b.handle('slow', () => new Promise((resolve) => setTimeout(() => resolve('too late'), 5000)));
    b.on('pageEvent', (payload) => pageEvents.push(payload));
    return b;
  }, []);

  const permissionRef = useRef<((request: PermissionRequest) => Promise<boolean>) | undefined>(
    undefined
  );
  const fileRequestRef = useRef<((request: FileRequest) => Promise<string[] | null>) | undefined>(
    undefined
  );
  // The page counter, then a suite's `extensions`, unless it asks `withoutPageCounter`. An extension without `onEvent`
  // logs its events.
  const { extensions = [], withoutPageCounter, ...props } = extraProps;
  const logged = [
    ...(withoutPageCounter ? [] : [pageCounter(true, onPageCounterEvent)]),
    ...extensions,
  ].map(
    (extension) =>
      extension && {
        ...extension,
        onEvent:
          extension.onEvent ??
          (({ name }: HookEvent) => void events.hookEvents.push(`${extension.key}.${name}`)),
      }
  );
  const harness: Harness = {
    pages: PAGES,
    platform: `${Platform.OS} ${Platform.Version}`,
    ref,
    webViewOffset,
    // Read live: the harness keeps one harness object per suite, so a closure over `state` would stay stale.
    state: () => ref.getState(),
    remount: () => remount(),
    load: (uri) => setSource({ uri }),
    loadSource: setSource,
    setRules,
    bridge,
    pageEvents,
    setFileRequest: (handler) => (fileRequestRef.current = handler),
    setPermission: (handler) => (permissionRef.current = handler),
    setProps,
    setExtraWebViews,
    events,
    setAsk: (ask) => (askRef.current = ask),
  };
  const harnessRef = useRef(harness);
  useEffect(() => {
    harnessRef.current = harness;
  });

  const run = (name: string) => {
    void fetch(`${PAGES}/harness/run?platform=${Platform.OS}&suite=${name}`);
  };

  useEffect(() => pollForSuites(() => harnessRef.current), []);

  return (
    <View style={styles.container}>
      {/* The error screen is an overlay the app owns, cleared when the next load starts: the recipe in
          guides/migrating-from-react-native-webview.md#loading-and-error-screens. */}
      <View
        ref={webViewBox}
        style={styles.webview}
        onLayout={() =>
          webViewBox.current?.measureInWindow((x, y) => Object.assign(webViewOffset, { x, y }))
        }>
        <Remountable>
          <WebView
            ref={ref}
            source={source}
            style={styles.webview}
            navigationRules={rules}
            bridge={bridge}
            pullToRefresh
            sharedCookies
            extensions={[...logged, strayEvents]}
            onNavigationRequest={(request, signal) => askRef.current?.(request, signal) ?? 'block'}
            onFileRequest={(request) => fileRequestRef.current?.(request) ?? null}
            onFullscreenChange={({ active }) => events.fullscreen.push(active)}
            onDownload={(result) =>
              result.ok ? events.downloads.push(result) : events.downloadFailures.push(result)
            }
            onPermissionRequest={(request) => permissionRef.current?.(request) ?? false}
            android={{
              webView: { acceptThirdPartyCookies: true },
              settings: {
                userAgentString: `${AndroidWebView.defaultUserAgent} MinimalWebViewExample/1.0`,
              },
            }}
            onError={(event) => {
              events.errors.push(event);
              if (event.kind !== 'http') setError(event);
            }}
            onProcessGone={(event) => events.gone.push(event)}
            onNavigation={(event) => events.navigations.push(event)}
            onLoadStart={() => {
              events.loads.push('start');
              setError(null);
            }}
            onLoadEnd={({ outcome }) => {
              launchMarks.loadEnd ??= performance.now();
              events.loads.push('end');
              events.outcomes.push(outcome);
            }}
            {...props}
            ios={{ configuration: IOS_CONFIGURATION, ...props.ios }}
          />
        </Remountable>
        {error ? <ErrorScreen error={error} onRetry={() => ref.current?.reload()} /> : null}
      </View>
      {extraWebViews > 0 ? (
        <View style={styles.extras}>
          {Array.from({ length: extraWebViews }, (_, k) => (
            <WebView key={k} source={{ uri: `${PAGES}/?extra=${k}` }} style={styles.webview} />
          ))}
        </View>
      ) : null}
      <Text testID="harness-request" style={styles.state}>
        {driverRequest}
      </Text>
      <StateLine />
      <ScrollView horizontal style={styles.buttons}>
        <Button title="back" onPress={() => ref.current?.goBack()} />
        <Button title="home" onPress={() => setSource({ uri: `${PAGES}/?t=${Date.now()}` })} />
        {Object.keys(SUITES).map((name) => (
          <Button key={name} title={name} onPress={() => run(name)} />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * The state line. Its own component, so a navigation state event re-renders only it: App re-rendering the WebView on
 * each one would put the example's render work inside the perf numbers.
 */
function StateLine() {
  const state = useWebViewState(ref);
  return (
    <Text style={styles.state} numberOfLines={3}>
      {state.loading ? `loading ${Math.round(state.progress * 100)}%` : 'idle'} · {state.url}
      {state.pendingUrl ? ` → ${state.pendingUrl}` : ''}
    </Text>
  );
}

/** The example's error screen; records whether it is mounted so the errors suite can check it. */
function ErrorScreen(props: { error: LoadFailure; onRetry: () => void }) {
  useEffect(() => {
    events.overlay.error = true;
    return () => {
      events.overlay.error = false;
    };
  }, []);
  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay]}>
      <Text>
        {props.error.kind} error {props.error.code}: {props.error.description}
      </Text>
      <Button title="retry" onPress={props.onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { justifyContent: 'center', alignItems: 'center', backgroundColor: '#fee' },
  container: { flex: 1, paddingTop: 50, backgroundColor: '#fff' },
  webview: { flex: 1 },
  extras: { flexDirection: 'row', height: 80 },
  state: { fontSize: 11, padding: 4 },
  buttons: { flexGrow: 0, paddingBottom: 30 },
});
