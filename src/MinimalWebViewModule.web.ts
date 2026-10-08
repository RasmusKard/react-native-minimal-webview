import { registerWebModule, NativeModule } from 'expo';

// MinimalWebViewModule is not available on the web platform.
class MinimalWebViewModule extends NativeModule<{}> {}

export default registerWebModule(MinimalWebViewModule, 'MinimalWebViewModule');
