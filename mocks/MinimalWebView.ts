// jest-expo's stand-in for the native module in an app's tests: it loads mocks/<native module name> by itself.
export const defaultUserAgent = 'Mozilla/5.0';
export function warmUp() {}
export async function preconnect(_url: string) {}
export async function setWebContentsDebuggingEnabled(_enabled: boolean) {}
