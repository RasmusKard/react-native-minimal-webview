// Whether the app needs a fresh launch: anything but yes from the test server's /harness/idle.
output.launch = http.get(`${PAGES}/harness/idle?platform=${PLATFORM}&ms=5000`).body !== 'yes';
