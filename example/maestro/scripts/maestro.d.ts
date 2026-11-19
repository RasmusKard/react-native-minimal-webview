// What Maestro gives a runScript script (it runs plain JavaScript, so these scripts stay .js): its HTTP client and JSON
// parser, the flow's shared `output` object, and the flow's env (run.sh's -e values and each runFlow's env) as globals.
declare const http: { get(url: string): { status: number; body: string } };
declare function json(text: string): Record<string, unknown>;
declare const output: {
  launch?: boolean;
  /** How many of the suite's driver requests are done. */
  n: number;
  /** The current request's `action` (harness/runner.ts's `DriverAction`; its other fields are here too), or `done`. */
  action: string;
  /** With `done`: the suite's failed checks. */
  fail?: number | string;
};
/** The test pages server's origin. */
declare const PAGES: string;
declare const PLATFORM: string;
declare const SUITE: string;
