import {
  type NavigationRule,
  type WebViewProps,
  type WebViewErrorEvent,
  type WebViewRef,
  type WebViewSource,
  WebView,
  createBridge,
  downloads,
  type Download,
  fullscreenVideo,
  httpAuth,
  permissions,
  type PermissionRequestEvent,
  sharedCookies,
  fileUpload,
  type FileRequest,
  pullToRefresh,
  useWebViewState,
} from 'react-native-minimal-webview';
import { useEffect, useMemo, useRef, useState } from 'react';
import { pageCounter } from 'sample-extension';
import { Button, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SUITES, onDriverRequest, pollForSuites, type Harness } from './harness';

const PAGES = 'http://localhost:8090';

export default function App() {
  const ref = useRef<WebViewRef>(null);
  const state = useWebViewState(ref);
  const [source, setSource] = useState<WebViewSource>({ uri: `${PAGES}/` });
  const [rules, setRules] = useState<NavigationRule[] | undefined>();
  const [extraProps, setProps] = useState<Partial<WebViewProps>>({});
  const [driverRequest, setDriverRequest] = useState('');
  useEffect(() => {
    onDriverRequest(setDriverRequest);
  }, []);
  const events = useRef<Harness['events']>({
    errors: [],
    httpErrors: [],
    gone: [],
    loads: [],
    navigations: [],
    downloads: [],
    downloadFailures: [],
    fullscreen: [],
    pageCounts: [],
    overlay: { error: false },
  }).current;
  const askRef = useRef<WebViewProps['onNavigationRequest']>(undefined);
  const pageEvents = useRef<unknown[]>([]).current;
  const bridge = useMemo(() => {
    const b = createBridge({ allowedOrigins: [PAGES], timeoutMs: 3000 });
    b.handle('echo', (params) => params);
    b.handle('fail', () => {
      throw new Error('handler failed on purpose');
    });
    b.handle('slow', () => new Promise((resolve) => setTimeout(() => resolve('too late'), 5000)));
    b.on('pageEvent', (payload) => pageEvents.push(payload));
    return b;
  }, [pageEvents]);
  const stateRef = useRef(state);
  stateRef.current = state;

  const authRef = useRef<((request: { host: string; realm: string }) => { username: string; password: string } | null) | undefined>(undefined);
  const permissionRef = useRef<((request: PermissionRequestEvent) => Promise<boolean>) | undefined>(undefined);
  const fileRequestRef = useRef<((request: FileRequest) => Promise<string[] | null>) | undefined>(undefined);
  const extensions = useMemo(
    () => [
      pullToRefresh(),
      fileUpload({ onFileRequest: (request) => fileRequestRef.current?.(request) ?? null }),
      fullscreenVideo({ onChange: (active) => events.fullscreen.push(active) }),
      downloads({
        onDownload: (download) => events.downloads.push(download),
        onError: (failure) => events.downloadFailures.push(failure),
      }),
      httpAuth({ onAuthRequest: (request) => authRef.current?.(request) ?? null }),
      permissions({
        origins: [PAGES],
        onPermissionRequest: (request) => permissionRef.current?.(request) ?? false,
      }),
      sharedCookies(),
      pageCounter({ onPageLoaded: (url, count) => events.pageCounts.push({ url, count }) }),
    ],
    []
  );

  const harness: Harness = {
    pages: PAGES,
    platform: `${Platform.OS} ${Platform.Version}`,
    ref,
    state: () => stateRef.current,
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
  harnessRef.current = harness;

  const run = (name: string) => {
    void fetch(`${PAGES}/harness/run?platform=${Platform.OS}&suite=${name}`);
  };

  useEffect(() => pollForSuites(() => harnessRef.current), []);

  return (
    <View style={styles.container}>
      <WebView
        ref={ref}
        source={source}
        style={styles.webview}
        navigationRules={rules}
        bridge={bridge}
        extensions={extensions}
        onNavigationRequest={(request) => askRef.current?.(request) ?? 'block'}
        applicationNameForUserAgent="MinimalWebViewExample/1.0"
        thirdPartyCookies
        onError={(event) => events.errors.push(event)}
        onHttpError={(event) => events.httpErrors.push(event)}
        onProcessGone={(event) => events.gone.push(event)}
        onNavigation={(event) => events.navigations.push(event)}
        onLoadStart={() => events.loads.push('start')}
        onLoad={() => events.loads.push('load')}
        onLoadEnd={() => events.loads.push('end')}
        renderError={(error) => (
          <ErrorScreen error={error} onRetry={() => ref.current?.reload()} mounted={events.overlay} />
        )}
        {...extraProps}
      />
      <Text testID="harness-request" style={styles.state}>
        {driverRequest}
      </Text>
      <Text style={styles.state} numberOfLines={3}>
        {state.loading ? `loading ${Math.round(state.progress * 100)}%` : 'idle'} · {state.url}
        {state.pendingUrl ? ` → ${state.pendingUrl}` : ''}
      </Text>
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

/** The example's error screen; records whether it is mounted so the harness can check renderError. */
function ErrorScreen(props: { error: WebViewErrorEvent; onRetry: () => void; mounted: { error: boolean } }) {
  useEffect(() => {
    props.mounted.error = true;
    return () => {
      props.mounted.error = false;
    };
  }, [props.mounted]);
  return (
    <View style={styles.overlay}>
      <Text>
        {props.error.kind} error {props.error.code}: {props.error.description}
      </Text>
      <Button title="retry" onPress={props.onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fee' },
  container: { flex: 1, paddingTop: 50, backgroundColor: '#fff' },
  webview: { flex: 1 },
  state: { fontSize: 11, padding: 4 },
  buttons: { flexGrow: 0, paddingBottom: 30 },
});
