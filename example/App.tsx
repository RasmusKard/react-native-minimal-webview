import {
  type NavigationRule,
  type WebViewProps,
  type WebViewRef,
  type WebViewSource,
  WebView,
  createBridge,
  fileUpload,
  type FileRequest,
  pullToRefresh,
  useWebViewState,
} from 'minimal-rn-webview';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SUITES, pollForSuites, type Harness } from './harness';

const PAGES = 'http://localhost:8090';

export default function App() {
  const ref = useRef<WebViewRef>(null);
  const state = useWebViewState(ref);
  const [source, setSource] = useState<WebViewSource>({ uri: `${PAGES}/` });
  const [rules, setRules] = useState<NavigationRule[] | undefined>();
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

  const fileRequestRef = useRef<((request: FileRequest) => Promise<string[] | null>) | undefined>(undefined);
  const extensions = useMemo(
    () => [
      pullToRefresh(),
      fileUpload({ onFileRequest: (request) => fileRequestRef.current?.(request) ?? null }),
    ],
    []
  );

  const harness: Harness = {
    pages: PAGES,
    platform: `${Platform.OS} ${Platform.Version}`,
    ref,
    state: () => stateRef.current,
    load: (uri) => setSource({ uri }),
    setRules,
    bridge,
    pageEvents,
    setFileRequest: (handler) => (fileRequestRef.current = handler),
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
      />
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

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 50, backgroundColor: '#fff' },
  webview: { flex: 1 },
  state: { fontSize: 11, padding: 4 },
  buttons: { flexGrow: 0, paddingBottom: 30 },
});
