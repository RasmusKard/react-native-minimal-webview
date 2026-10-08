// Reexport the native module. On web, it will be resolved to MinimalWebViewModule.web.ts
// and on native platforms to MinimalWebViewModule.ts
export { default } from './MinimalWebViewModule';
export { default as MinimalWebView } from './MinimalWebView';
export * from './MinimalWebView.types';
export * from './types';
