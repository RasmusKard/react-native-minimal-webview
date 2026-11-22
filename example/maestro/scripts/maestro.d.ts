// Maestro runs plain JavaScript, so these scripts stay .js.
declare const http: { get(url: string): { status: number; body: string } };
declare function json(text: string): Record<string, unknown>;
declare const output: {
  launch?: boolean;
  n: number;
  action: string;
  fail?: number | string;
};
declare const PAGES: string;
declare const PLATFORM: string;
declare const SUITE: string;
