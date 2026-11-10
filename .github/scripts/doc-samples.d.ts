// The modules the docs' samples import that aren't installed here, for check-doc-samples.mts: their shapes as far as a
// sample uses them, or `any`.
declare module 'expo-asset';
declare module 'expo-camera';
declare module 'expo-file-system';
declare module 'expo-screen-orientation';
declare module 'expo-document-picker' {
  export function getDocumentAsync(options?: {
    type?: string | string[];
    multiple?: boolean;
  }): Promise<{ canceled: false; assets: { uri: string }[] } | { canceled: true; assets: null }>;
}
declare module 'expo-image-picker' {
  export function launchCameraAsync(): Promise<
    { canceled: false; assets: { uri: string }[] } | { canceled: true; assets: null }
  >;
}
