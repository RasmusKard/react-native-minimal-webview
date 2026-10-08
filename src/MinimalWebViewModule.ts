import { NativeModule, requireNativeModule } from 'expo';

declare class MinimalWebViewModule extends NativeModule<{}> {
  setValueAsync(value: string): Promise<void>;
}

export default requireNativeModule<MinimalWebViewModule>('MinimalWebView');
