# Get started

In this tutorial, you build an Expo app that shows a web page, and then a page that calls the app over the bridge. The
app runs on the iOS simulator.

You need a Mac set up for Expo development builds on the iOS simulator.
[Expo's environment setup](https://docs.expo.dev/get-started/set-up-your-environment/?platform=ios&device=simulated&mode=development-build&buildEnv=local)
lists what to install.

## Create the app

Create an Expo app from the blank TypeScript template, and go to its folder:

```sh
npx create-expo-app@latest my-app --template blank-typescript
cd my-app
```

## Install the package

Install the package, and expo-build-properties to set the iOS and Android versions it needs:

```sh
npx expo install react-native-minimal-webview expo-build-properties
```

The install adds `"expo-build-properties"` to the `plugins` in `app.json`. Replace that entry with one that sets the
[minimum versions](../README.md#requirements):

```json
"plugins": [
  [
    "expo-build-properties",
    { "ios": { "deploymentTarget": "17.0" }, "android": { "minSdkVersion": 29 } }
  ]
]
```

## Show a web page

Replace the contents of `App.tsx` with a `WebView` that fills the screen:

```tsx
import { WebView } from 'react-native-minimal-webview';

export default function App() {
  return <WebView source={{ uri: 'https://example.com' }} style={{ flex: 1 }} />;
}
```

Build the app and run it on the simulator:

```sh
npx expo run:ios
```

If the command asks for an iOS bundle identifier, enter `com.example.myapp`.

The first build takes several minutes. Then the simulator opens the app, and you see the page at `https://example.com`.

Leave the command running. It runs Metro, which reloads the app when you save a file.

## Call the app from the page

Replace the contents of `App.tsx` with a page that asks the app for a greeting over the bridge:

```tsx
import { WebView, createBridge } from 'react-native-minimal-webview';

type AppBridge = {
  reactNative: { getGreeting: { result: string } };
  page: {};
  events: {};
};

// Outside the component: a new bridge recreates the WebView
const bridge = createBridge<AppBridge>({ allowedOrigins: ['https://example.com'] });
bridge.handle('getGreeting', () => 'Hello from React Native');

const html = `
<meta name="viewport" content="width=device-width">
<h1 id="greeting">Waiting for the app</h1>
<script>
  window.nativeBridge.call('getGreeting').then((greeting) => {
    document.getElementById('greeting').textContent = greeting;
  });
</script>`;

export default function App() {
  return (
    <WebView
      bridge={bridge}
      source={{ html, baseUrl: 'https://example.com' }}
      style={{ flex: 1 }}
    />
  );
}
```

Save the file. The app reloads, and the page shows **Hello from React Native**. The page called `getGreeting`, and
the app answered.

`window.nativeBridge` exists only in pages on the bridge's `allowedOrigins`. The `baseUrl` puts this page on
`https://example.com`, so the page gets the bridge.

## Next steps

- [Examples](examples.md): the navigation state, loading screens, navigation rules, the rest of the bridge and more.
- [How it works](how-it-works.md): what runs where.
- [API reference](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/):
  every prop, method and type.
