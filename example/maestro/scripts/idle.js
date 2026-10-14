// Whether the app needs a fresh launch: not while it is up and polling with its last suite passed (the test server knows).
output.launch =
  http.get(`http://localhost:8090/harness/idle?platform=${PLATFORM}&ms=5000`).body !== 'yes';
