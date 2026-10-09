// A react-native-webview instance the parity suite drives like the minimal one: it records RNW's callbacks and can
// evaluate an expression in the page (RNW has no evaluate: injectJavaScript plus postMessage back).
import { type ComponentType, type ReactNode, type Ref, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView as RNWebViewClass } from 'react-native-webview';

type NativeEvent<T> = { nativeEvent: T };
type RNWHandle = { injectJavaScript(script: string): void; goBack(): void; reload(): void };
const RNWebView = RNWebViewClass as unknown as ComponentType<
  Record<string, unknown> & { ref?: Ref<RNWHandle> }
>;

export type RnwEvent = { name: string; at: number; data: Record<string, unknown> };

export type RnwDriver = {
  events: RnwEvent[];
  /** Evaluates an expression in the page and resolves with its JSON value (5 s timeout). */
  evaluate(expression: string): Promise<unknown>;
  goBack(): void;
  reload(): void;
};

export function RnwView(props: {
  source: { uri: string } | null;
  driver: Ref<RnwDriver>;
}): ReactNode {
  const native = useRef<RNWHandle>(null);
  const events = useRef<RnwEvent[]>([]).current;
  const waiting = useRef(new Map<string, (value: unknown) => void>()).current;
  let next = 0;

  useImperativeHandle(props.driver, () => ({
    events,
    evaluate: (expression) =>
      new Promise((resolve) => {
        const id = `e${++next}-${Date.now()}`;
        waiting.set(id, resolve);
        setTimeout(() => waiting.delete(id) && resolve(undefined), 5000);
        native.current?.injectJavaScript(
          `(() => { let v; try { v = (${expression}); } catch (e) { v = { error: String(e) }; }
            Promise.resolve(v).then((r) => window.ReactNativeWebView.postMessage(JSON.stringify({ __id: ${JSON.stringify(id)}, value: r === undefined ? null : r }))); })(); true;`
        );
      }),
    goBack: () => native.current?.goBack(),
    reload: () => native.current?.reload(),
  }));

  if (!props.source) return null;
  const record = (name: string) => (event: NativeEvent<Record<string, unknown>>) =>
    events.push({ name, at: Date.now(), data: { ...event.nativeEvent } });
  const onMessage = (event: NativeEvent<{ data: string }>) => {
    try {
      const parsed = JSON.parse(event.nativeEvent.data) as { __id?: string; value?: unknown };
      if (parsed.__id && waiting.has(parsed.__id)) {
        waiting.get(parsed.__id)?.(parsed.value);
        waiting.delete(parsed.__id);
        return;
      }
    } catch {
      // a page message that is not ours: record it below
    }
    events.push({ name: 'message', at: Date.now(), data: { data: event.nativeEvent.data } });
  };
  return (
    <View style={styles.cover}>
      <RNWebView
        ref={native}
        source={props.source}
        style={styles.fill}
        onLoadStart={record('loadStart')}
        onLoad={record('load')}
        onLoadEnd={record('loadEnd')}
        onError={record('error')}
        onHttpError={record('httpError')}
        onNavigationStateChange={(state: Record<string, unknown>) =>
          events.push({ name: 'navigationState', at: Date.now(), data: { ...state } })
        }
        onShouldStartLoadWithRequest={(request: Record<string, unknown>) => {
          events.push({ name: 'shouldStart', at: Date.now(), data: { ...request } });
          return true;
        }}
        onOpenWindow={record('openWindow')}
        onContentProcessDidTerminate={record('contentProcessDidTerminate')}
        onRenderProcessGone={record('renderProcessGone')}
        onFileDownload={record('fileDownload')}
        onMessage={onMessage}
        sharedCookiesEnabled
        setSupportMultipleWindows
        javaScriptCanOpenWindowsAutomatically
      />
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#fff' },
  fill: { flex: 1 },
});
