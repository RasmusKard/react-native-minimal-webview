/**
 * What a suite asks the outside driver (maestro/suite.yaml) to do on the device. A `point` is Maestro's: `x, y` in
 * screen pixels (points on iOS), or in percent of the screen (`50%, 49%`).
 */
export type DriverAction =
  | { action: 'tap'; point: string }
  /** A tap that opens something over the app (the system file chooser), then back once it covers the app. */
  | { action: 'tapThenBack'; point: string }
  | { action: 'longPress'; point: string }
  /** A native button by its text (a dialog's, a menu item's), once it shows. */
  | { action: 'press'; text: string }
  | { action: 'back' }
  /** A pull down the page: from its top (`full`), a little (`short`), or from the top of an inner scroller. */
  | { action: 'swipe'; kind: 'full' | 'short' | 'inner' }
  /** Kills the page's renderer process. */
  | { action: 'kill' }
  /** The same with the app in the background: home, the kill, and the app again 5 s later. */
  | { action: 'killInBackground' }
  | { action: 'setGpsFix' };

/** The driver's last message for a suite: its counts, after which the flow ends. */
export type Verdict = { action: 'done'; pass: number; fail: number; skip: number };
