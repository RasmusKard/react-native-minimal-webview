"""A2: physical lines and cognitive complexity per feature per platform (core-size.md's method, made repeatable).

Each file is cut into regions by anchors: (regex, feature[, back[, only]]); `only` 'old' or 'new' keeps an anchor to
one run (--old is the 806d16f calibration run). A region starts at the first line after the
previous anchor that matches, moved up over the doc comment or annotations right above it (and `back` more lines),
and ends where the next region starts. Lines before a file's first anchor go to its default feature. Physical lines:
comments, imports and blanks included. `src/platform.generated.ts` is excluded, as in core-size.md.

Cognitive complexity comes from feature-tree/out/metrics.tsv (sonarjs, detekt, swift-complexity; run
`feature-tree/run.sh` first) and counts a function in the feature of its first line; a Kotlin or Swift function
inside another one is skipped (the outer score has it), TS functions are all scored on their own.

Usage: A2-attribution.py REPO [--old] [--regions] [--tsv]   (REPO may be a `git archive` of an older commit: no cog then)
"""
import re
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(sys.argv[1]).resolve()
K = "android/src/main/java/expo/modules/minimalwebview/"

FEATURES = {
    "SC": "Shared cookies (iOS)",
    "PTR": "Pull-to-refresh",
    "DL": "Downloads",
    "FU": "File upload (Android)",
    "FS": "Fullscreen video (Android)",
    "PERM": "Permissions",
    "DLG": "JS dialogs",
    "CR": "Crash recovery (+3-in-60 s, recover())",
    "WU": "warmUp / preconnect (Android)",
    "BFC": "Back-forward cache (Android)",
    "NAV": "Navigation rules + ask (+ new windows, external)",
    "ASK": "Ask / requestHandlers plumbing (shared)",
    "NS": "Navigation state (+ load events, refs)",
    "BR": "Bridge + evaluate + injectedScripts",
    "PS": "Platform settings (apply)",
    "GC": "get / call",
    "HK": "Hooks mechanism",
    "DS": "DocumentScope",
    "GLUE": "Expo module glue",
    "OTH": "Other core (imports, source/load/reload, error reporting, configure defaults, lifecycle)",
}

# file -> [(default feature)] + anchors in file order
SPEC = {
    K + "MinimalWebView.kt": ("OTH", [
        ('^class MinimalWebView', 'OTH'), ('val onNavigationState by', 'NS'), ('val onBridge by', 'BR'),
        ('val onHookEvent by', 'HK', 0, 'new'), ('val onNativeEvent by', 'HK', 0, 'old'), ('val onError by', 'NS'),
        ('val onProcessGone by', 'CR'), ('val onNavigation by', 'NAV'),
        ('val hasNavigationListener', 'NS', 0, 'new'), ('Declared before webView', 'NS', 0, 'old'),
        ('val document = DocumentScope', 'DS'), ('val navigation = MinimalWebViewNavigation', 'NAV'),
        ('val scripts = MinimalWebViewScripts', 'BR'), ('private var current: WebView', 'OTH', 0, 'new'),
        ('Replaced when the render process dies', 'OTH', 0, 'old'), ('var navigationRules', 'NAV'),
        ('var bridgeScript', 'BR'), ('The `hookOptions` prop: each hook', 'HK', 0, 'new'),
        ('The `nativeOptions` prop, for the hooks', 'HK', 0, 'old'), ('var injectedScripts', 'BR'),
        ('The `android` prop: WebSettings', 'PS'), ('var pullToRefresh', 'PTR'),
        ('The page requests JS has a prop for', 'ASK'), ('private var loadedSource', 'OTH'),
        ("The hooks' clients \\(WebViewContext\\)", 'HK'), ('val fileUpload', 'FU'), ('val fullscreen', 'FS'),
        ('val permissions', 'PERM'), ('val downloads', 'DL'),
        ('The `hookOptions` keys the first WebView', 'HK', 0, 'new'),
        ('What the attach hooks returned', 'HK', 0, 'old'), ('Every `ask` \\(a page request', 'ASK'),
        ("The page's open file chooser", 'FU'), ('Navigation state\\. Native owns', 'NS'),
        ('From a render process death until', 'CR', 0, 'new'), ('private var destroyed', 'OTH', 0, 'new'),
        ("The core's deferred work", 'OTH', 0, 'new'), ('^  init \\{', 'PTR', 0, 'new'),
        ('What belongs to the Document', 'DS', 0, 'new'), ('private val crashTimes', 'CR', 0, 'old'),
        ('^  init \\{', 'DS', 0, 'old'), ('private fun createWebView', 'OTH'),
        ('Back and forward restore the page', 'BFC'), ('No favicon requests: nothing shows', 'OTH'),
        ('Called once per prop batch', 'OTH'), ('The `android` settings, applied from each prop batch', 'PS'),
        ("A warning for the app's developer", 'OTH'), ('private fun attachHooks', 'HK'),
        ('Puts the WebView inside the pull-to-refresh layout', 'PTR', 0, 'old'),
        ('override fun emit', 'HK', 0, 'old'), ("\\[ask\\], returning the ask's id", 'ASK'),
        ("Wraps the file chooser's", 'FU'), ('A new main-frame document: what belonged', 'DS'),
        ('internal fun pageFinished', 'PTR'), ('Cancels every pending ask', 'ASK', 0, 'new'),
        ('internal fun bridgePost', 'BR', 0, 'new'), ('The render process died\\. The WebView', 'CR', 0, 'new'),
        ('internal fun destroy', 'OTH', 0, 'new'), ('Answers every pending ask with null', 'ASK', 0, 'old'),
        ('fun bridgePost', 'BR', 0, 'old'), ('The render process died: a WebView cannot', 'CR', 0, 'old'),
        ('^  fun destroy', 'OTH', 0, 'old'), ('internal fun reportError', 'NS'),
        ('internal companion object', 'CR', 0, 'new'), ('^internal const val TAG', 'OTH'),
        ('Whether the committed \\[url\\] is the \\[source\\]', 'OTH', 0, 'new'),
        ('Records a render process death', 'CR', 0, 'new'),
        ('^private const val MAX_CRASHES_PER_WINDOW', 'CR', 0, 'old'),
    ]),
    K + "MinimalWebViewModule.kt": ("GLUE", [
        (r"private var fileChooser", "FU"), (r"override fun definition", "GLUE"),
        (r"The fallback runs when the result", "FU"), (r"Cookies live in memory until flushed", "OTH"),
        (r"A WebView whose renderer died in the background", "CR"), (r"Starts WebView \(loading its code", "WU"),
        (r"The platform's default user agent", "GLUE"), (r"Prop\(\"navigationRules\"", "NAV"),
        (r"Prop\(\"bridgeScript\"", "BR"), (r"Prop\(\"(hookOptions|nativeOptions)\"", "HK"),
        (r"JSON, so a null \(reset this key\)", "PS"), (r"Prop\(\"pullToRefresh\"", "PTR"),
        (r"Prop\(\"injectedScripts\"", "BR"), (r"Prop\(\"requestHandlers\"", "ASK"),
        (r"OnViewDidUpdateProps", "GLUE"), (r"AsyncFunction\(\"navigate\"\)", "NS"),
        (r"AsyncFunction\(\"(get|native)\"\)", "GC"), (r"AsyncFunction\(\"bridgePost\"\)", "BR"),
        (r"AsyncFunction\(\"answer\"\)", "ASK"), (r"A hook's `context.handle` handler", "HK"),
        (r"Resolves with the JSON-encoded result of the expression", "BR"),
        (r"Resolves with \[body\]'s JSON", "GLUE"), (r"The `settings` prop's JSON", "PS"),
        (r"The chooser's intent", "FU"), (r"Data classes, so the skip checks", "GLUE"),
    ]),
    K + "MinimalWebViewNavigation.kt": ("NAV", [
        (r"A download nothing handled", "DL"), (r"Opens a URL outside the WebView", "NAV"),
    ]),
    K + "MinimalWebViewScripts.kt": ("BR", []),
    K + "MinimalWebViewClients.kt": ("OTH", [
        (r"WebView's callbacks\. A new set", "HK"), (r"^internal class Listener", "NS"),
        (r"Pages that fired their load event", "BFC"), (r"override fun onNavigationStarted", "NS"),
        (r"^internal class Client\(", "HK"),
        (r"override fun shouldOverrideUrlLoading", "NAV"), (r"Without NavigationListener \(WebView older than 146\)", "NS"),
        (r"override fun onLoadResource", "HK"), (r"Main frame only: subresource failures", "NS"),
        (r"override fun onFormResubmission", "HK"), (r"Best-effort URL tracking when WebView updates", "NS"),
        (r"override fun onReceivedClientCertRequest", "HK"), (r"override fun onRenderProcessGone", "CR"),
        (r"override fun onSafeBrowsingHit", "HK"), (r"^internal class ChromeClient", "HK"),
        (r"override fun onCreateWindow", "NAV"), (r"A hook client, else the app's prop \(onFileRequest\)", "FU"),
        (r"Without a hook client or the app's prop: deny", "PERM"),
        (r"override fun onShowCustomView", "FS"), (r"override fun onReceivedTitle", "NS"),
        (r"override fun onReceivedIcon", "HK"), (r"override fun onJsAlert", "DLG"),
        (r"override fun onGeolocationPermissionsHidePrompt", "PERM"), (r"override fun onConsoleMessage", "HK"),
    ]),
    K + "Hooks.kt": ("HK", []),
    K + "PlatformSettings.kt": ("PS", [
        (r"`root\.key`: the getter's value", "GC"), (r"The targets of `root\.key` and the key", "PS"),
        (r"The method's arguments for \[values\]", "GC"), (r"\[value\] as the parameter \[type\] takes it", "PS"),
        (r"Invokes, unwrapping the target's own exception", "GC"), (r"private fun problem", "PS"),
        (r"A getter's or method's result as JSON", "GC"), (r"private fun jsonable", "GC"),
    ]),
    K + "NavigationRules.kt": ("NAV", []),
    K + "PullToRefresh.kt": ("PTR", []),
    K + "DocumentScope.kt": ("DS", []),
    K + "requests/Downloads.kt": ("DL", []),
    K + "requests/FileUpload.kt": ("FU", []),
    K + "requests/FullscreenVideo.kt": ("FS", []),
    K + "requests/Permissions.kt": ("PERM", []),
    "ios/MinimalWebView.swift": ("OTH", [
        ('^class MinimalWebView', 'OTH'), ('let onNavigationState', 'NS'), ('let onBridge', 'BR'),
        ('let onHookEvent', 'HK', 0, 'new'), ('let onNativeEvent', 'HK', 0, 'old'), ('let onError', 'NS'),
        ('let onProcessGone', 'CR'), ('let onNavigation ', 'NAV'), ('Props, applied together in applyProps', 'OTH'),
        ('var bridgeScript', 'BR'), ('The `hookOptions` prop: each hook', 'HK', 0, 'new'),
        ('The `nativeOptions` prop, for the hooks', 'HK', 0, 'old'), ('The `ios` prop: WebKit', 'PS'),
        ('var pullToRefresh', 'PTR'), ('var sharedCookies', 'SC'), ('var navigationRules', 'NAV'),
        ('var injectedScripts', 'BR'), ('The page requests JS has a prop for', 'ASK'),
        ('private var loadedSource', 'OTH'), ('Created once, from the first props', 'OTH'),
        ('The page requests the core answers', 'HK'), ('lazy var downloads', 'DL'), ('private lazy var proxy', 'HK'),
        ('What the attach hooks returned', 'HK'), ('Navigation state, derived from WebKit', 'NS'),
        ('Every `ask` \\(navigation and extension\\)', 'ASK'), ('let document = DocumentScope', 'DS'),
        ("The enabled hooks' contexts", 'HK'), ('var nextAskId', 'ASK'),
        ('URLs an `ask` allowed in this Document', 'NAV', 0, 'new'), ('var askedAndAllowed', 'NAV', 0, 'old'),
        ('A `source` load is being prepared', 'SC'), ('After a failed main-frame load', 'NS'),
        ('private var crashTimes', 'CR'), ('`evaluate` calls waiting for their result', 'BR'),
        ('The origin of the document whose page client', 'BR'), ('The JS dialog on screen', 'DLG'),
        ('required init\\(appContext', 'DS'), ('The spinner belongs to a load', 'PTR', 0, 'new'),
        ("The hooks' own handlers, on their contexts", 'DS', 0, 'new'), ('Called once per prop batch', 'OTH'),
        ('Runs the shared-cookie copy', 'SC'), ('private func load\\(_ source', 'OTH'),
        ('Settings keys that could not be applied', 'PS'), ('Loads a request the app started', 'OTH'),
        ('React Native calls `invalidate`', 'OTH', 0, 'new'),
        ('The page on screen: the back-forward list', 'NS', 0, 'new'), ('The `evaluate` ref method', 'BR', 0, 'old'),
        ('^  func reload', 'OTH', 0, 'old'), ("The bridge's page client first", 'BR', 0, 'old'),
        ('private func tearDown', 'OTH', 0, 'old'),
        ("WebKit's `url` KVO fires before the delegate callbacks", 'NS', 0, 'old'),
        ('An observation callback the core implements', 'HK'), ('Main-frame failures only', 'NS'),
        ('MARK: WKNavigationDelegate', 'NAV'), ('decidePolicyFor navigationResponse', 'DL', 2),
        ('navigationAction: WKNavigationAction, didBecome download', 'DL', 1), ('didCommit navigation', 'NS', 1),
        ('The web content process died', 'CR'), ('ponytail: fixed crash-loop guard', 'CR'),
        ('What the hooks see of this view', 'HK'),
    ]),
    "ios/MinimalWebView+Navigation.swift": ("NAV", [
        (r"A download no hook takes", "DL"), (r"window\.open and target=_blank", "NAV"),
        (r"func register\(_ onAnswer", "ASK"), (r"Equal URLs, treating an empty path", "OTH"),
        (r"private let askTimeout", "NAV"),
    ]),
    "ios/MinimalWebView+Dialogs.swift": ("DLG", [
        (r"Camera and microphone, main frame only", "PERM"), (r"Dismisses the dialog on screen", "DLG"),
    ]),
    "ios/MinimalWebView+Scripts.swift": ("BR", []),
    "ios/MinimalWebViewModule.swift": ("GLUE", [
        (r"Prop\(\"bridgeScript\"", "BR"), (r"Prop\(\"(hookOptions|nativeOptions)\"", "HK"),
        (r"JSON, so a null \(reset this key\)", "PS"), (r"Prop\(\"pullToRefresh\"", "PTR"),
        (r"Prop\(\"sharedCookies\"", "SC"), (r"Prop\(\"navigationRules\"", "NAV"),
        (r"Prop\(\"injectedScripts\"", "BR"), (r"Prop\(\"requestHandlers\"", "ASK"),
        (r"OnViewDidUpdateProps", "GLUE"), (r"AsyncFunction\(\"navigate\"\)", "NS"),
        (r"AsyncFunction\(\"(get|native)\"\)", "GC"), (r"AsyncFunction\(\"bridgePost\"\)", "BR"),
        (r"JS's answer to an `ask`", "ASK"), (r"A hook's `context.handle` handler", "HK"),
        (r"Resolves with the JSON-encoded value", "BR"), (r"Runs `body` with the view's WKWebView", "GLUE"),
        (r"A prop that fails to convert is dropped whole", "GLUE"),
    ]),
    "ios/Hooks.swift": ("HK", []),
    "ios/DelegateProxy.swift": ("HK", []),
    "ios/PlatformSettings.swift": ("PS", [
        (r"^final class PlatformSettings", "PS"),
        (r"`root\.key` through KVC, as JSON", "GC"), (r"private func root\(", "PS"),
    ]),
    "ios/NavigationRules.swift": ("NAV", []),
    "ios/OriginRules.swift": ("BR", []),
    "ios/DocumentScope.swift": ("DS", []),
    "ios/Downloads.swift": ("DL", []),
    "ios/SharedCookies.swift": ("SC", []),
    "ios/MRWInvoke.m": ("GC", []), "ios/MRWInvoke.h": ("GC", []),
    "ios/MRWExceptions.m": ("GC", []), "ios/MRWExceptions.h": ("GC", []),
    # files of 806d16f only (calibration run)
    "ios/PullToRefresh.swift": ("PTR", []), "ios/Permissions.swift": ("PERM", []),
    "ios/MinimalWebView+Bridge.swift": ("BR", []),
    "src/index.ts": ("OTH", []),
    "src/WebView.tsx": ("OTH", [
        ('^const keysOf', 'NS', 0, 'new'), ('^const NAVIGATION_KEYS', 'NAV', 0, 'new'),
        ('^const PROCESS_GONE_KEYS', 'CR', 0, 'new'), ('Native reports every main-frame error as one event', 'NS'),
        ("A page's message comes with its origin", 'BR', 0, 'new'), ('^type BridgeEvent', 'BR', 0, 'old'),
        ('`askId` is set when native waits', 'ASK'), ('^const REQUESTS', 'ASK'), ("The core's own events", 'ASK'),
        ('Every prop that is not a `ViewProps` one', 'OTH'), ('^type NativeSettings', 'PS', 0, 'new'),
        ('`WKAudiovisualMediaTypeAudio', 'PS', 0, 'old'), ('^type NativeProps', 'GLUE'),
        ('^type NativeMethods', 'GLUE'), ('^const NativeWebView', 'GLUE'), ('^const INITIAL_STATE', 'NS'),
        ('Runs a JS handler that native waits on', 'ASK'), ('^export function WebView\\(', 'OTH'),
        ('A handle can outlive its native view', 'NS', 0, 'new'),
        ('The same string while nothing in it changed', 'PS', 0, 'new'),
        ('^  const \\[handle\\] = useState', 'NS', 0, 'old'),
        ('^  const settings = JSON\\.stringify', 'PS', 0, 'old'), ('^  const connection =', 'BR'),
        ('^  const answer = ', 'ASK'), ('^  const requestHandlers = useRequestHandlers', 'ASK'),
        ('One per ask in flight', 'ASK', 0, 'new'), ('^  const onHookEvent = async', 'ASK', 0, 'new'),
        ('^  const onNativeEvent = async', 'ASK', 0, 'old'), ('^  const onNavigation = ', 'NAV'),
        ('^  return \\($', 'GLUE'), ('^function useAttach', 'NS'), ('The page requests with a prop set', 'ASK'),
        ('Bridges by identity, for the creation key', 'OTH'), ('`style`, `testID`, the accessibility props', 'OTH'),
        ("The platform's settings for native", 'PS', 0, 'new'),
        ('Load events: onLoadStart and onLoadEnd', 'NS', 0, 'new'), ('^function platformSettings', 'PS', 0, 'old'),
        ('Load events\\. The current load', 'NS', 0, 'old'), ('^export declare namespace WebView', 'OTH'),
        ('^WebView\\.warmUp', 'WU'), ('^export function useWebViewState', 'NS'),
    ]),
    "src/types.ts": ("OTH", [
        ('^export type WebViewSource', 'OTH'), ('^export type NavigationAction', 'NAV'),
        ('^export type NavigationState', 'NS'), ('^export type LoadErrorEvent', 'NS', 0, 'new'),
        ('^export type WebViewErrorEvent', 'NS', 0, 'old'), ('^export type ProcessGoneEvent', 'CR'),
        ('^export type InjectedScript', 'BR'), ('^export type BridgeSender', 'BR', 0, 'new'),
        ('^export type BridgeHandler', 'BR', 0, 'old'), ('^export type FileRequest', 'FU'),
        ('^export type PermissionResource', 'PERM'), ('^export type Download = ', 'DL'),
        ('^export type SettingValue', 'PS'), ('^export type HookEvent', 'HK', 0, 'new'),
        ('^export type FullscreenChangeEvent', 'FS', 0, 'new'), ('^export type WebViewErrorCode', 'OTH', 0, 'new'),
        ('^export interface WebViewProps', 'OTH', 0, 'new'), ('^export type NativeEvent', 'HK', 0, 'old'),
        ('^  source: WebViewSource', 'OTH', 0, 'old'), ('^  ios\\?: IOSSettings', 'PS'),
        ('^  injectedScripts\\?', 'BR'), ('^  navigationRules\\?', 'NAV'), ('^  bridge\\?: Bridge', 'BR'),
        ('^  hookOptions\\?', 'HK', 0, 'new'), ('^  nativeOptions\\?', 'HK', 0, 'old'),
        ('^  pullToRefresh\\?', 'PTR'), ('^  sharedCookies\\?', 'SC'),
        ('Page requests: each works without its prop', 'ASK'), ('^  onFileRequest\\?', 'FU'),
        ('^  onFullscreenChange\\?', 'FS'), ('^  onPermissionRequest\\?', 'PERM'), ('^  onDownload\\?', 'DL'),
        ('^  onNavigation\\?: ', 'NAV'), ('^  onNavigationStateChange\\?', 'NS'),
        ('^export type WebViewRef = ', 'NS', 0, 'new'), ('^export type WebViewProps = ', 'NS', 0, 'old'),
    ]),
    "src/bridge/createBridge.ts": ("BR", []), "src/bridge/endpoint.ts": ("BR", []),
    "src/bridge/protocol.ts": ("BR", []), "src/bridge/pageClient.ts": ("BR", []),
    "src/bridge/pageClient.generated.ts": ("BR", []),
}


OLD = "--old" in sys.argv
COMMENT = re.compile(r"\s*(//|/\*|\*|@)")
CODE_MODIFIER = re.compile(r"^\s*(@Volatile|override|internal|private)")


def spec_for(path):
    """(default feature, anchors that apply to the commit being scanned); an anchor's 4th item is 'old' or 'new'."""
    default, anchors = SPEC[path]
    mode = "old" if OLD else "new"
    return default, [a for a in anchors if not a[3:] or a[3] == mode]


def start_of(lines, i, floor, back=0):
    """Line index where the region anchored at line i begins: over its doc comment, then `back` more lines."""
    s = i
    while s - 1 >= floor and COMMENT.match(lines[s - 1]) and not CODE_MODIFIER.match(lines[s - 1]):
        s -= 1
    return max(floor, s - back)


def regions(path, lines):
    """Returns (feature per line, [(start, feature, regex)], regexes with no match)."""
    default, anchors = spec_for(path)
    starts, missing, cursor = [], [], 0
    for a in anchors:
        i = next((j for j in range(cursor, len(lines)) if re.search(a[0], lines[j])), None)
        if i is None:
            missing.append(a[0])
            continue
        cursor = i + 1
        floor = starts[-1][0] + 1 if starts else 0
        starts.append((start_of(lines, i, floor, *a[2:3]), a[1], a[0]))
    owner = [default] * len(lines)
    ends = [s for s, _, _ in starts[1:]] + [len(lines)] if starts else []
    for (s, feat, _), e in zip(starts, ends, strict=True):
        owner[s:e] = [feat] * (e - s)
    return owner, starts, missing


def load_metrics():
    by_path = defaultdict(list)
    mt = REPO / "feature-tree/out/metrics.tsv"
    for row in mt.read_text().splitlines() if mt.exists() and not OLD else []:
        p, s, e, _, cog = row.split("\t")
        by_path[p].append((int(s), int(e), cog))
    return by_path


def top_level_cogs(plat, rows, owner):
    """(feature, cog) of each scored function; Kotlin and Swift functions nested in another are the outer one's."""
    for s, _, cog in rows:
        nested = plat != "ts" and any(s2 < s <= e2 for s2, e2, _ in rows)
        if cog and s <= len(owner) and not nested:
            yield owner[s - 1], int(cog)


def print_regions(path, n, starts):
    print(f"== {path} ({n})")
    marks = [(0, spec_for(path)[0], "(default)")] + starts
    for (s, feat, rx), nxt in zip(marks, marks[1:] + [(n, "", "")], strict=True):
        if nxt[0] > s:
            print(f"  {s + 1:4d}-{nxt[0]:4d} {nxt[0] - s:4d} {feat:5s} {rx[:60]}")


def print_tsv(lines_by, cog_sum, cog_max):
    print("feature\tkt_lines\tsw_lines\tts_lines\ttotal\tkt_cog\tsw_cog\tts_cog\tkt_max\tsw_max\tts_max")
    for feat in FEATURES:
        L, C, M = lines_by[feat], cog_sum[feat], cog_max[feat]
        print(f"{feat}\t{L['kt']}\t{L['sw']}\t{L['ts']}\t{L['kt'] + L['sw'] + L['ts']}\t"
              f"{C['kt']}\t{C['sw']}\t{C['ts']}\t{M['kt']}\t{M['sw']}\t{M['ts']}")
    tot = {p: sum(lines_by[f][p] for f in FEATURES) for p in ("kt", "sw", "ts")}
    print(f"TOTAL\t{tot['kt']}\t{tot['sw']}\t{tot['ts']}\t{sum(tot.values())}")


def scan(path, metrics, totals):
    """Adds one file's lines and cognitive complexity to totals; returns the anchors that matched nothing."""
    lines_by, cog_sum, cog_max = totals
    lines = (REPO / path).read_text(errors="replace").splitlines()
    plat = "kt" if path.endswith(".kt") else "ts" if path.startswith("src/") else "sw"
    owner, starts, missing = regions(path, lines)
    for feat in owner:
        lines_by[feat][plat] += 1
    if "--regions" in sys.argv:
        print_regions(path, len(lines), starts)
    for feat, cog in top_level_cogs(plat, sorted(metrics.get(path, [])), owner):
        cog_sum[feat][plat] += cog
        cog_max[feat][plat] = max(cog_max[feat][plat], cog)
    return [f"{path}: anchor not found: {m}" for m in missing]


def main():
    totals = tuple(defaultdict(lambda: defaultdict(int)) for _ in range(3))
    metrics, problems = load_metrics(), []
    for path in (p for p in SPEC if (REPO / p).exists()):
        problems += scan(path, metrics, totals)
    if "--tsv" in sys.argv:
        print_tsv(*totals)
    print(*problems, sep="\n", file=sys.stderr)


main()
