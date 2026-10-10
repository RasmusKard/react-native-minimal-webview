// Load-time comparison with react-native-webview: mounts one WebView at a time and measures mount -> first onLoadEnd.
import { WebView as Minimal } from 'react-native-minimal-webview';
import { type ComponentType, type ReactNode, type Ref, useEffect, useRef } from 'react';
import type { WebViewRef } from 'react-native-minimal-webview';
import { StyleSheet, View } from 'react-native';
import { WebView as RNWebViewClass } from 'react-native-webview';

// react-native-webview's class component types do not resolve under React 19.3's types; the few props used here.
type RNWebViewHandle = { injectJavaScript(script: string): void };
type NativeEvent<T> = { nativeEvent: T };
const RNWebView = RNWebViewClass as unknown as ComponentType<{
  ref?: Ref<RNWebViewHandle>;
  source: { uri: string };
  style: object;
  onLoadEnd: (event: NativeEvent<{ url: string }>) => void;
  onMessage: (event: NativeEvent<{ data: string }>) => void;
}>;

/** `readyState`: the page's document.readyState when onLoadEnd fired (what the event really marks). */
export type PerfRun = {
  kind: 'minimal' | 'rnw';
  uri: string;
  key: number;
  /** performance.now() when the run was requested, so the time includes mounting the native view. */
  startedAt: number;
  done: (ms: number, readyState: string) => void;
};

/** Renders the run's WebView over the screen and reports how long the first load took. */
export function PerfView({ run }: { run: PerfRun | null }): ReactNode {
  const reported = useRef(false);
  const minimalRef = useRef<WebViewRef>(null);
  const rnwRef = useRef<RNWebViewHandle>(null);
  const elapsed = useRef(0);
  useEffect(() => {
    reported.current = false;
  }, [run?.key]);
  if (!run) return null;
  // Only the load of the requested page counts (not about:blank or an intermediate document).
  const host = run.uri.split('/')[2] ?? '';
  const onLoadEnd = (url: string) => {
    if (reported.current || !url.includes(host)) return;
    reported.current = true;
    elapsed.current = performance.now() - run.startedAt;
    if (run.kind === 'minimal') {
      void minimalRef.current?.evaluate('document.readyState').then((state) => run.done(elapsed.current, String(state)));
    } else {
      rnwRef.current?.injectJavaScript('window.ReactNativeWebView.postMessage(document.readyState); true;');
    }
  };
  return (
    <View style={styles.cover} key={run.key}>
      {run.kind === 'minimal' ? (
        <Minimal
          ref={minimalRef}
          source={{ uri: run.uri }}
          style={styles.fill}
          onLoadEnd={(state) => onLoadEnd(state.url)}
        />
      ) : (
        <RNWebView
          source={{ uri: run.uri }}
          style={styles.fill}
          ref={rnwRef}
          onLoadEnd={(event) => onLoadEnd(event.nativeEvent.url)}
          onMessage={(event) => run.done(elapsed.current, event.nativeEvent.data)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#fff' },
  fill: { flex: 1 },
});
