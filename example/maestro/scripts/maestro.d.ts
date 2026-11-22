// Maestro runs plain JavaScript, so these scripts stay .js.
declare const http: { get(url: string): { status: number; body: string } };
declare function json(text: string): Record<string, unknown>;
declare const output: {
  launch?: boolean;
  requestsDone: number;
  action:
    | import('../../harness/driver').DriverAction['action']
    | import('../../harness/driver').Verdict['action']
    | '';
  fail?: import('../../harness/driver').Verdict['fail'] | 'no verdict';
};
declare const PAGES: string;
declare const PLATFORM: string;
declare const SUITE: string;
declare const SUITE_MS: string;
