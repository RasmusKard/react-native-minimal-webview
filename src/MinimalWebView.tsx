import { requireNativeView } from 'expo';
import * as React from 'react';

import { MinimalWebViewProps } from './MinimalWebView.types';

const NativeView: React.ComponentType<MinimalWebViewProps> = requireNativeView('MinimalWebView');

export default function MinimalWebView(props: MinimalWebViewProps) {
  return <NativeView {...props} />;
}
