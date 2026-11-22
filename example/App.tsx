import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  type HostInstance,
  Modal,
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
  type HookEvent,
  type HookExtension,
  useWebViewState,
  createWebViewRef,
} from 'react-native-minimal-webview';
import { type PageCounterEvent, pageCounter } from 'sample-extension';

import {
  launchMarks,
  onDriverRequest,
  pollForSuites,
  type Harness,
  type HarnessProps,
} from './harness/runner';
import { PAGES } from './pages';
import { ON_DEMAND, SUITES } from './suites/index';

type LoadFailure = Exclude<LoadErrorEvent, { kind: 'http' }>;
const IOS_CONFIGURATION = { applicationNameForUserAgent: 'MinimalWebViewExample/1.0' };
const ref = createWebViewRef();
let remount = () => {};
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
const webViewOffset: Harness['webViewOffset'] = { x: 0, y: 0, height: 0 };

function onPageCounterEvent(event: PageCounterEvent) {
  if (event.name === 'pageLoaded') events.pageCounts.push(event.payload);
  else if (event.name === 'documentEnd') events.documentEnds.push(event.payload);
  else if (event.name === 'label') return `page ${event.payload.count}`;
  else events.hookEvents.push(`sample.pageCounter.${event.name}`);
  return undefined;
}

const EXTENSIONS_KEY = '@react-native-minimal-webview/extensions';
const strayEvents: HookExtension = {
  key: `${EXTENSIONS_KEY}.onScroll`,
  options: null,
  onEvent: ({ name }) => void events.hookEvents.push(`${EXTENSIONS_KEY}.onScroll.${name}`),
};

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
  const [covered, setCovered] = useState(false);
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

  const permissionRef = useRef<WebViewProps['onPermissionRequest']>(undefined);
  const fileRequestRef = useRef<WebViewProps['onFileRequest']>(undefined);
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
    setCovered,
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

  useEffect(() => pollForSuites(() => harnessRef.current, { ...SUITES, ...ON_DEMAND }), []);

  return (
    <View style={styles.container}>
      <View
        ref={webViewBox}
        style={styles.webview}
        onLayout={() =>
          webViewBox.current?.measureInWindow((x, y, _width, height) =>
            Object.assign(webViewOffset, { x, y, height })
          )
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
            extensions={[
              ...logged,
              ...(logged.some((e) => e && e.key === strayEvents.key) ? [] : [strayEvents]),
            ]}
            onNavigationRequest={(request, signal) => askRef.current?.(request, signal) ?? 'block'}
            onFileRequest={(request, signal) => fileRequestRef.current?.(request, signal) ?? null}
            onFullscreenChange={({ active }) => events.fullscreen.push(active)}
            onDownload={(result) =>
              result.ok ? events.downloads.push(result) : events.downloadFailures.push(result)
            }
            onPermissionRequest={(request, signal) =>
              permissionRef.current?.(request, signal) ?? false
            }
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
      {/* Full screen: iOS takes the views under it out of the window. */}
      <Modal visible={covered} animationType="none" presentationStyle="fullScreen">
        <View />
      </Modal>
      <Text testID="harness-request" style={styles.state}>
        {driverRequest}
      </Text>
      <StateLine />
      <ScrollView horizontal style={styles.buttons}>
        <Button title="back" onPress={() => ref.current?.goBack()} />
        <Button title="home" onPress={() => ref.current?.load(`${PAGES}/`)} />
        {Object.keys(SUITES).map((name) => (
          <Button key={name} title={name} onPress={() => run(name)} />
        ))}
      </ScrollView>
    </View>
  );
}

function StateLine() {
  const state = useWebViewState(ref);
  return (
    <Text style={styles.state} numberOfLines={3}>
      {state.loading ? `loading ${Math.round(state.progress * 100)}%` : 'idle'} · {state.url}
      {state.pendingUrl ? ` → ${state.pendingUrl}` : ''}
    </Text>
  );
}

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
