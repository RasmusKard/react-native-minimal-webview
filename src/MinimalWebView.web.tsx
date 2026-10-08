import { MinimalWebViewProps } from './MinimalWebView.types';

// MinimalWebView is not available on the web platform.
export default function MinimalWebView(_props: MinimalWebViewProps) {
  throw new Error('MinimalWebView is not available on the web platform.');
}
