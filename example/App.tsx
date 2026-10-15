import {
  type NavigationRule,
  type WebViewProps,
  type WebViewErrorEvent,
  type WebViewSource,
  WebView,
  createBridge,
  type PermissionRequestEvent,
  type FileRequest,
  useWebViewState,
  createWebViewRef,
} from 'minimal-rn-webview';
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { isPageCounterEvent } from 'sample-extension';

import { SUITES, onDriverRequest, pollForSuites, type Harness } from './harness';

const PAGES = 'http://localhost:8090';
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
  httpErrors: [],
  gone: [],
  loads: [],
  navigations: [],
  downloads: [],
  downloadFailures: [],
  fullscreen: [],
  pageCounts: [],
  hookEvents: [],
  overlay: { error: false },
};
const pageEvents: unknown[] = [];

/** Remounts its children on `remount()`, without re-rendering App. */
function Remountable({ children }: { children: ReactNode }) {
  const [key, setKey] = useState(0);
  useEffect(() => {
    remount = () => setKey((k) => k + 1);
  }, []);
  return <Fragment key={key}>{children}</Fragment>;
}

export default function App() {
  const state = useWebViewState(ref);
  const [source, setSource] = useState<WebViewSource>({ uri: `${PAGES}/` });
  const [rules, setRules] = useState<NavigationRule[] | undefined>();
  const [extraProps, setProps] = useState<Partial<WebViewProps>>({});
  const [driverRequest, setDriverRequest] = useState('');
  const [error, setError] = useState<WebViewErrorEvent | null>(null);
  useEffect(() => {
    onDriverRequest(setDriverRequest);
  }, []);
  const askRef = useRef<WebViewProps['onNavigationRequest']>(undefined);
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

  const authRef = useRef<WebViewProps['onHttpAuthRequest']>(undefined);
  const permissionRef = useRef<((request: PermissionRequestEvent) => Promise<boolean>) | undefined>(
    undefined
  );
  const fileRequestRef = useRef<((request: FileRequest) => Promise<string[] | null>) | undefined>(
    undefined
  );
  const harness: Harness = {
    pages: PAGES,
    platform: `${Platform.OS} ${Platform.Version}`,
    ref,
    // Read live: the harness keeps one harness object per suite, so a closure over `state` would stay stale.
    state: () => ref.getState(),
    remount: () => remount(),
    load: (uri) => setSource({ uri }),
    loadSource: setSource,
    setAuth: (handler) => (authRef.current = handler),
    setRules,
    bridge,
    pageEvents,
    setFileRequest: (handler) => (fileRequestRef.current = handler),
    setPermission: (handler) => (permissionRef.current = handler),
    setProps,
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
      {/* The README's error screen recipe: an overlay the app owns, cleared when the next load starts. */}
      <View style={styles.webview}>
        <Remountable>
          <WebView
            ref={ref}
            source={source}
            style={styles.webview}
            navigationRules={rules}
            bridge={bridge}
            pullToRefresh
            sharedCookies
            nativeOptions={{ pageCounter: true }}
            onNativeEvent={(event) => {
              if (isPageCounterEvent(event) && event.name === 'pageCounter.pageLoaded')
                events.pageCounts.push(event.payload);
              else events.hookEvents.push(event.name);
            }}
            onNavigationRequest={(request) => askRef.current?.(request) ?? 'block'}
            onFileRequest={(request) => fileRequestRef.current?.(request) ?? null}
            onFullscreenChange={({ active }) => events.fullscreen.push(active)}
            onDownload={(result) =>
              'uri' in result ? events.downloads.push(result) : events.downloadFailures.push(result)
            }
            onHttpAuthRequest={(request) => authRef.current?.(request) ?? null}
            onPermissionRequest={(request) => permissionRef.current?.(request) ?? false}
            android={{
              webView: { acceptThirdPartyCookies: true },
              settings: {
                userAgentString: `${WebView.defaultUserAgent} MinimalWebViewExample/1.0`,
              },
            }}
            onError={(event) => {
              events.errors.push(event);
              setError(event);
            }}
            onHttpError={(event) => events.httpErrors.push(event)}
            onProcessGone={(event) => events.gone.push(event)}
            onNavigation={(event) => events.navigations.push(event)}
            onLoadStart={() => {
              events.loads.push('start');
              setError(null);
            }}
            onLoad={() => events.loads.push('load')}
            onLoadEnd={() => events.loads.push('end')}
            {...extraProps}
            ios={{ configuration: IOS_CONFIGURATION, ...extraProps.ios }}
          />
        </Remountable>
        {error ? <ErrorScreen error={error} onRetry={() => ref.reload()} /> : null}
      </View>
      <Text testID="harness-request" style={styles.state}>
        {driverRequest}
      </Text>
      <Text style={styles.state} numberOfLines={3}>
        {state.loading ? `loading ${Math.round(state.progress * 100)}%` : 'idle'} · {state.url}
        {state.pendingUrl ? ` → ${state.pendingUrl}` : ''}
      </Text>
      <ScrollView horizontal style={styles.buttons}>
        <Button title="back" onPress={() => ref.goBack()} />
        <Button title="home" onPress={() => setSource({ uri: `${PAGES}/?t=${Date.now()}` })} />
        {Object.keys(SUITES).map((name) => (
          <Button key={name} title={name} onPress={() => run(name)} />
        ))}
      </ScrollView>
    </View>
  );
}

/** The example's error screen; records whether it is mounted so the harness can check the recipe. */
function ErrorScreen(props: { error: WebViewErrorEvent; onRetry: () => void }) {
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
  state: { fontSize: 11, padding: 4 },
  buttons: { flexGrow: 0, paddingBottom: 30 },
});
