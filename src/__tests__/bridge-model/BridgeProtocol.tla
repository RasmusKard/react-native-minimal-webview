---------------------------- MODULE BridgeProtocol ----------------------------
EXTENDS Naturals, Sequences

CONSTANTS
  NumDocs,
  NumMsgs,
  MaxQueue,    \* createBridge.ts MAX_QUEUE
  MaxCrashes,
  MaxMounts

Docs == 1..NumDocs  \* a document's token (protocol.ts `doc`) is its number: tokens are unique
Msgs == 1..NumMsgs  \* RN call ids (endpoint.ts `n1`, `n2`, ...); an emit uses one too, as a name for the model
None == 0
NotQueued == NumDocs + 1

VARIABLES
  \* createBridge.ts
  attached,     \* `post` is set: a WebView is mounted with the bridge
  phase,
  doc,
  queue,        \* `queue`, as <<[kind, id, for]>>; `for` is a ghost, see ForPage
  unavailable,
  answering,    \* documents whose call RN's handler is still answering (endpoint.ts receive awaits it)
  \* endpoint.ts, RN's side
  pending,
  timers,
  nextMsg,
  \* native: ios/MinimalWebView.swift, MinimalWebView+Scripts.swift; android MinimalWebView.kt, MinimalWebViewScripts.kt
  capable,      \* the WebView has the bridge's features; if not, native reports `unavailable` at install
  current,
  canPost,      \* iOS `bridgeOrigin` / Android `replyProxy` is set, so bridgePost reaches the page
  nextDoc, crashes, mounts,
  toRN,         \* onBridge events on their way to createBridge's receive, in order
  toNative,     \* RN's bridgePost calls on their way to native, in order
  toPage,       \* posts native passed on, landing in whichever document is current when they arrive
  looper,       \* what waits on native's main thread, in order: a commit's document end and the page's posts
  \* pageClient.ts, per document
  allowed,      \* the document is in allowedOrigins, so the page client runs in it
  saidReady,
  pageCall,     \* the page's own nativeBridge.call: "none", "pending" or "done"
  running,      \* RN calls the page's handlers are running
  \* ghosts: what the properties read; the code has no such state
  posted,       \* calls RN handed to `post`
  navRejected,  \* calls rejectSent rejected
  settled,      \* times each call was settled (resolved or rejected)
  runs,         \* times a page ran each call
  rnSaw,        \* the document of the last `navigated` RN received: the page RN queues for
  wrongPage,    \* a page acted on a message RN meant for another page
  carriedOver   \* a page acted on a message RN queued for an earlier page

rnVars == <<attached, phase, doc, queue, unavailable, answering, pending, timers, nextMsg>>
nativeVars == <<capable, current, canPost, nextDoc, crashes, mounts, toRN, toNative, toPage, looper>>
pageVars == <<allowed, saidReady, pageCall, running>>
ghostVars == <<posted, navRejected, settled, runs, rnSaw, wrongPage, carriedOver>>
vars == <<rnVars, nativeVars, pageVars, ghostVars>>

Event(type, d, m) == [type |-> type, doc |-> d, id |-> m]
PageClient(d) == capable /\ allowed[d]
QueuedCalls == {queue[i].id : i \in {j \in DOMAIN queue : queue[j].kind = "call"}}
Count(s) == [m \in Msgs |-> IF m \in s THEN settled[m] + 1 ELSE settled[m]]

\* endpoint.ts rejectPending stops each call's timer (clearTimeout) as it rejects it
StopTimers(t, s) == t \ s
\* endpoint.ts rejectPending: rejects and deletes each pending call in s
Reject(s) == /\ pending' = pending \ s
             /\ timers' = StopTimers(timers, s)
             /\ settled' = Count(s)
\* createBridge.ts rejectSent: a pending call not in the queue was posted to a document
RejectSent == pending \ QueuedCalls
\* createBridge.ts receive, `if (phase === 'loading')`: the previous document never said `ready`
NeverSaidReady == phase = "loading"
\* Ghost: what was queued while no page was known is for the next page that commits
ForPage(q, d) == [i \in DOMAIN q |-> IF q[i].for = None THEN [q[i] EXCEPT !.for = d] ELSE q[i]]
\* pageClient.ts receive: `if (message.doc === doc)`
Accepts(d, msg) == msg.doc = d

TypeOK ==
  /\ phase \in {"idle", "loading", "ready"}
  /\ doc \in Docs \cup {None}
  /\ current \in Docs \cup {None}
  /\ pending \subseteq Msgs /\ timers \subseteq Msgs
  /\ Len(queue) <= MaxQueue

Init ==
  /\ attached = FALSE /\ phase = "idle" /\ doc = None /\ queue = <<>> /\ unavailable = FALSE /\ answering = {}
  /\ pending = {} /\ timers = {} /\ nextMsg = 1
  /\ capable \in BOOLEAN /\ current = None /\ canPost = FALSE /\ nextDoc = 1 /\ crashes = 0 /\ mounts = 0
  /\ toRN = <<>> /\ toNative = <<>> /\ toPage = <<>> /\ looper = <<>>
  /\ allowed = [d \in Docs |-> FALSE] /\ saidReady = [d \in Docs |-> FALSE]
  /\ pageCall = [d \in Docs |-> "none"] /\ running = [d \in Docs |-> {}]
  /\ posted = {} /\ navRejected = {} /\ settled = [m \in Msgs |-> 0] /\ runs = [m \in Msgs |-> 0]
  /\ rnSaw = None /\ wrongPage = FALSE /\ carriedOver = FALSE

-----------------------------------------------------------------------------

\* WebView.tsx mounts a WebView with the bridge: connection.attach. Native installs the bridge, or reports it can't.
Attach ==
  /\ ~attached /\ mounts < MaxMounts
  /\ attached' = TRUE /\ mounts' = mounts + 1
  /\ toRN' = IF capable THEN <<>> ELSE <<Event("unavailable", None, 0)>>
  /\ UNCHANGED <<phase, doc, queue, unavailable, answering, pending, timers, nextMsg>>
  /\ UNCHANGED <<capable, current, canPost, nextDoc, crashes, toNative, toPage, looper>>
  /\ UNCHANGED <<pageVars, ghostVars>>

\* The WebView unmounts: connection.detach. Its document and the messages in flight go with it.
Detach ==
  /\ attached
  /\ attached' = FALSE /\ phase' = "idle" /\ queue' = <<>>
  /\ Reject(pending)
  /\ navRejected' = navRejected \cup RejectSent \* rejectSent, then the queued ones with `unavailable`
  /\ answering' = {}
  /\ current' = None /\ canPost' = FALSE /\ toRN' = <<>> /\ toNative' = <<>> /\ toPage' = <<>> /\ looper' = <<>>
  /\ rnSaw' = None
  /\ UNCHANGED <<doc, unavailable, nextMsg, capable, nextDoc, crashes, mounts>>
  /\ UNCHANGED <<pageVars, posted, runs, wrongPage, carriedOver>>

\* bridge.call or bridge.emit: endpoint.ts call/emit and createBridge's send
AppSend(kind) ==
  LET m == nextMsg
      added == IF kind = "call" THEN {m} ELSE {}
  IN
  /\ m <= NumMsgs
  /\ nextMsg' = m + 1
  /\ IF kind = "call" /\ unavailable
     THEN \* createBridge.ts call: rejects at once, never pending
          /\ settled' = Count({m})
          /\ UNCHANGED <<pending, timers, queue, toNative, posted>>
     ELSE IF attached /\ phase = "ready"
     THEN \* deliver: posted with `doc`
          /\ toNative' = Append(toNative, [kind |-> kind, id |-> m, doc |-> doc, to |-> doc, for |-> NotQueued])
          /\ posted' = posted \cup added
          /\ pending' = pending \cup added
          /\ timers' = timers \cup added
          /\ UNCHANGED <<queue, settled>>
     ELSE \* queue.push; past MAX_QUEUE the oldest is shifted out, and a call among them rejects
          LET q == Append(queue, [kind |-> kind, id |-> m, for |-> rnSaw])
              over == Len(q) > MaxQueue
              dropped == IF over /\ q[1].kind = "call" THEN {q[1].id} \cap (pending \cup added) ELSE {}
          IN /\ queue' = IF over THEN Tail(q) ELSE q
             /\ pending' = (pending \cup added) \ dropped
             /\ timers' = StopTimers(timers \cup added, dropped)
             /\ settled' = Count(dropped)
             /\ UNCHANGED <<toNative, posted>>
  /\ UNCHANGED <<attached, phase, doc, unavailable, answering>>
  /\ UNCHANGED <<capable, current, canPost, nextDoc, crashes, mounts, toRN, toPage, looper>>
  /\ UNCHANGED <<pageVars, navRejected, runs, rnSaw, wrongPage, carriedOver>>

\* endpoint.ts call's timer fires: `pending.delete(id)` and reject with `timeout`
Timeout ==
  \E m \in timers:
    /\ timers' = timers \ {m} /\ pending' = pending \ {m} /\ settled' = Count({m})
    /\ UNCHANGED <<attached, phase, doc, queue, unavailable, answering, nextMsg>>
    /\ UNCHANGED <<nativeVars, pageVars>>
    /\ UNCHANGED <<posted, navRejected, runs, rnSaw, wrongPage, carriedOver>>

\* createBridge.ts receive({ navigated }) and receive({ crashed })
OnNavigated(e) ==
  LET sent == RejectSent
      stale == IF NeverSaidReady THEN pending \ sent ELSE {}
  IN /\ Reject(sent \cup stale)
     /\ navRejected' = navRejected \cup sent
     /\ queue' = IF NeverSaidReady THEN <<>> ELSE ForPage(queue, e.doc)
     /\ phase' = IF e.type = "crashed" THEN "idle" ELSE "loading"
     /\ rnSaw' = e.doc
     /\ UNCHANGED <<attached, doc, unavailable, answering, nextMsg>>
     /\ UNCHANGED <<capable, current, canPost, nextDoc, crashes, mounts, toNative, toPage, looper>>
     /\ UNCHANGED <<pageVars, posted, runs, wrongPage, carriedOver>>

\* createBridge.ts receive({ unavailable })
OnUnavailable ==
  /\ unavailable' = TRUE /\ queue' = <<>>
  /\ Reject(pending)
  /\ UNCHANGED <<attached, phase, doc, answering, nextMsg>>
  /\ UNCHANGED <<capable, current, canPost, nextDoc, crashes, mounts, toNative, toPage, looper>>
  /\ UNCHANGED <<pageVars, posted, navRejected, runs, rnSaw, wrongPage, carriedOver>>

\* createBridge.ts receiveMessage, `ready`: reject what was posted, take the page's token, flush the queue
OnReady(e) ==
  LET sent == RejectSent
      \* a queued call that already timed out is not sent
      flush == SelectSeq(queue, LAMBDA q: q.kind # "call" \/ q.id \in pending \ sent)
  IN /\ Reject(sent)
     /\ navRejected' = navRejected \cup sent
     /\ phase' = "ready" /\ doc' = e.doc
     /\ queue' = <<>> \* const flushing = queue; queue = []
     /\ toNative' = toNative \o [i \in DOMAIN flush |->
          [kind |-> flush[i].kind, id |-> flush[i].id, doc |-> e.doc, to |-> e.doc, for |-> flush[i].for]]
     /\ posted' = posted \cup {flush[i].id : i \in {j \in DOMAIN flush : flush[j].kind = "call"}}
     /\ UNCHANGED <<attached, unavailable, answering, nextMsg>>
     /\ UNCHANGED <<capable, current, canPost, nextDoc, crashes, mounts, toPage, looper>>
     /\ UNCHANGED <<pageVars, runs, rnSaw, wrongPage, carriedOver>>

\* createBridge.ts receiveMessage, a page's call: endpoint.ts receive runs the handler, which answers later (RNAnswer)
OnPageCall(e) ==
  /\ answering' = answering \cup {e.doc}
  /\ UNCHANGED <<attached, phase, doc, queue, unavailable, pending, timers, nextMsg>>
  /\ UNCHANGED <<capable, current, canPost, nextDoc, crashes, mounts, toNative, toPage, looper>>
  /\ UNCHANGED <<pageVars, ghostVars>>

\* endpoint.ts receive, `result` / `error`: settles the call if it is still pending
OnResult(e) ==
  /\ IF e.id \in pending
     THEN pending' = pending \ {e.id} /\ timers' = timers \ {e.id} /\ settled' = Count({e.id})
     ELSE UNCHANGED <<pending, timers, settled>>
  /\ UNCHANGED <<attached, phase, doc, queue, unavailable, answering, nextMsg>>
  /\ UNCHANGED <<capable, current, canPost, nextDoc, crashes, mounts, toNative, toPage, looper>>
  /\ UNCHANGED <<pageVars, posted, navRejected, runs, rnSaw, wrongPage, carriedOver>>

\* connection.receive takes the next onBridge event
RNReceive ==
  /\ toRN # <<>>
  /\ toRN' = Tail(toRN)
  /\ LET e == Head(toRN) IN
     CASE e.type \in {"navigated", "crashed"} -> OnNavigated(e)
       [] e.type = "unavailable" -> OnUnavailable
       [] e.type = "ready" -> OnReady(e)
       [] e.type = "call" -> OnPageCall(e)
       [] e.type = "result" -> OnResult(e)

\* The handler settles: the answer is posted with the caller's token (`{ ...answer, doc: message.doc }`), unqueued
RNAnswer ==
  \E d \in answering:
    /\ answering' = answering \ {d}
    /\ toNative' = Append(toNative, [kind |-> "result", id |-> 0, doc |-> d, to |-> d, for |-> NotQueued])
    /\ UNCHANGED <<attached, phase, doc, queue, unavailable, pending, timers, nextMsg>>
    /\ UNCHANGED <<capable, current, canPost, nextDoc, crashes, mounts, toRN, toPage, looper>>
    /\ UNCHANGED <<pageVars, ghostVars>>

-----------------------------------------------------------------------------

\* A main-frame navigation commits a new document. The page client runs in it only if it is in allowedOrigins.
\* Native hears of the commit one main-thread hop later: WebView posts onPageStarted, or the NavigationListener runs on
\* the main executor (MinimalWebViewClients.kt); iOS's didCommit is in the same order as the page's posts.
Commit ==
  /\ attached /\ nextDoc <= NumDocs
  /\ \E inAllowedOrigins \in BOOLEAN: allowed' = [allowed EXCEPT ![nextDoc] = inAllowedOrigins]
  /\ current' = nextDoc /\ nextDoc' = nextDoc + 1
  /\ looper' = Append(looper, Event("navigated", nextDoc, 0))
  /\ UNCHANGED <<rnVars, capable, canPost, crashes, mounts, toRN, toNative, toPage>>
  /\ UNCHANGED <<saidReady, pageCall, running, ghostVars>>

\* Native's main thread runs what waits there. A document end: endDocument(.committed) / documentEnded(COMMITTED)
\* clears bridgeOrigin / replyProxy and emits `navigated`. A page's post: bridgeReceive / the web message listener's
\* posted delivery sets bridgeOrigin / replyProxy and emits onBridge.
NativeRun ==
  /\ looper # <<>>
  /\ looper' = Tail(looper)
  /\ canPost' = (Head(looper).type # "navigated")
  /\ toRN' = Append(toRN, Head(looper))
  /\ UNCHANGED <<rnVars, capable, current, nextDoc, crashes, mounts, toNative, toPage>>
  /\ UNCHANGED <<pageVars, ghostVars>>

\* The renderer dies: endDocument(.crashed) / tearDown(CRASHED) emits `crashed` and drops the dead page's posts still
\* waiting (documentEnded's removeCallbacksAndMessages); a reload commits later
Crash ==
  /\ attached /\ crashes < MaxCrashes
  /\ current' = None /\ canPost' = FALSE /\ crashes' = crashes + 1
  /\ toRN' = Append(toRN, Event("crashed", None, 0))
  /\ looper' = SelectSeq(looper, LAMBDA e: e.type = "navigated")
  /\ UNCHANGED <<rnVars, capable, nextDoc, mounts, toNative, toPage>>
  /\ UNCHANGED <<pageVars, ghostVars>>

\* bridgePost: native passes RN's message on only while bridgeOrigin / replyProxy is set, else drops it
NativePost ==
  /\ toNative # <<>>
  /\ toNative' = Tail(toNative)
  /\ toPage' = IF canPost THEN Append(toPage, Head(toNative)) ELSE toPage
  /\ UNCHANGED <<rnVars, capable, current, canPost, nextDoc, crashes, mounts, toRN, looper>>
  /\ UNCHANGED <<pageVars, ghostVars>>

-----------------------------------------------------------------------------
\* The page client in the current document. Its posts wait on native's main thread behind its commit's document end:
\* Android's web message listener posts its delivery there, as WebView before 119 calls it ahead of that end.

PagePost(e) == looper' = Append(looper, e) /\ UNCHANGED <<canPost, toRN>>

\* `ready` at DOMContentLoaded
PageReady ==
  /\ current # None /\ PageClient(current) /\ ~saidReady[current]
  /\ saidReady' = [saidReady EXCEPT ![current] = TRUE]
  /\ PagePost(Event("ready", current, 0))
  /\ UNCHANGED <<rnVars, capable, current, nextDoc, crashes, mounts, toNative, toPage>>
  /\ UNCHANGED <<allowed, pageCall, running, ghostVars>>

\* The page's own call, before or after `ready` (a module script may call before DOMContentLoaded)
PageCall ==
  /\ current # None /\ PageClient(current) /\ pageCall[current] = "none"
  /\ pageCall' = [pageCall EXCEPT ![current] = "pending"]
  /\ PagePost(Event("call", current, 0))
  /\ UNCHANGED <<rnVars, capable, current, nextDoc, crashes, mounts, toNative, toPage>>
  /\ UNCHANGED <<allowed, saidReady, running, ghostVars>>

\* A page handler finishes RN's call, and the page answers it
PageAnswer ==
  /\ current # None
  /\ \E m \in running[current]:
       /\ running' = [running EXCEPT ![current] = @ \ {m}]
       /\ PagePost(Event("result", current, m))
  /\ UNCHANGED <<rnVars, capable, current, nextDoc, crashes, mounts, toNative, toPage>>
  /\ UNCHANGED <<allowed, saidReady, pageCall, ghostVars>>

\* A message from RN lands in the current document: its page client acts on it only if Accepts
Act(d, msg) ==
  IF msg.kind = "result"
  THEN \* an answer to the page's call
       /\ pageCall' = IF pageCall[d] = "pending" THEN [pageCall EXCEPT ![d] = "done"] ELSE pageCall
       /\ wrongPage' = (wrongPage \/ (pageCall[d] = "pending" /\ msg.to # d))
       /\ UNCHANGED <<running, runs, carriedOver>>
  ELSE \* RN's call or event: its handler or listeners run
       /\ running' = IF msg.kind = "call" THEN [running EXCEPT ![d] = @ \cup {msg.id}] ELSE running
       /\ runs' = IF msg.kind = "call" THEN [runs EXCEPT ![msg.id] = @ + 1] ELSE runs
       /\ wrongPage' = (wrongPage \/ msg.to # d)
       /\ carriedOver' = (carriedOver \/ msg.for \notin {NotQueued, d})
       /\ UNCHANGED pageCall

PageReceive ==
  /\ toPage # <<>>
  /\ toPage' = Tail(toPage)
  /\ IF current # None /\ PageClient(current) /\ Accepts(current, Head(toPage))
     THEN Act(current, Head(toPage))
     ELSE UNCHANGED <<running, pageCall, runs, wrongPage, carriedOver>>
  /\ UNCHANGED <<rnVars, capable, current, canPost, nextDoc, crashes, mounts, toRN, toNative, looper>>
  /\ UNCHANGED <<allowed, saidReady, posted, navRejected, settled, rnSaw>>

-----------------------------------------------------------------------------

Next ==
  \/ Attach \/ Detach \/ AppSend("call") \/ AppSend("event") \/ Timeout \/ RNReceive \/ RNAnswer
  \/ Commit \/ NativeRun \/ Crash \/ NativePost
  \/ PageReady \/ PageCall \/ PageAnswer \/ PageReceive

\* Native and the page keep going; the app, the user (navigation, unmount) and the timers need not.
Fairness ==
  /\ WF_vars(RNReceive) /\ WF_vars(RNAnswer) /\ WF_vars(NativeRun) /\ WF_vars(NativePost) /\ WF_vars(PageReceive)
  /\ WF_vars(PageReady) /\ WF_vars(PageAnswer)

Spec == Init /\ [][Next]_vars /\ Fairness

-----------------------------------------------------------------------------

\* 1. Every pending call is either queued or posted to a page, never both and never neither.
QueuedOrPosted == \A m \in pending : (m \in QueuedCalls) # (m \in posted)
\* 1. So a navigation fails only calls RN posted: a call queued for the loading page reaches it instead.
NavigatedOnlyIfPosted == navRejected \subseteq posted

\* 2. A call settles at most once, and a page runs it at most once.
SettledOnce == \A m \in Msgs : settled[m] <= 1
RunOnce == \A m \in Msgs : runs[m] <= 1

\* A page that says or said `ready` is on screen in a mounted WebView.
ReadyPageShown == attached /\ current # None /\ PageClient(current)
\* 2. Every call settles, even with no timeout, unless it waits in the queue while no page that says `ready` is shown.
EverySettles == \A m \in Msgs : (m \in pending) ~> (m \notin pending \/ (m \in QueuedCalls /\ ~ReadyPageShown))

\* 3. A page acts only on a message RN meant for it: one carrying its token, or the answer to its own call.
RightPage == ~wrongPage

\* 4. What RN queued for a page that never said `ready` does not reach the next page.
NotCarriedOver == ~carriedOver

\* 5. A page's own call is answered while the page is shown.
PageCallAnswered == \A d \in Docs : (pageCall[d] = "pending") ~> (pageCall[d] = "done" \/ current # d)
=============================================================================
