// What Maestro gives a runScript script (it runs plain JavaScript, so these scripts stay .js): its HTTP client, the
// flow's shared `output` object, and the flow's env (run.sh's -e values and each runFlow's env) as globals.
declare const http: { get(url: string): { status: number; body: string } };
declare const output: {
  launch?: boolean;
  request?: string;
  verdict?: string;
  x?: string;
  y?: string;
  n?: number;
};
declare const PLATFORM: string;
declare const DEVICE: string;
declare const SUITE: string;
declare const N: string;
