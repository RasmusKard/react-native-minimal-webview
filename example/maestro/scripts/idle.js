output.launch = http.get(`${PAGES}/harness/idle?platform=${PLATFORM}&ms=5000`).body !== 'yes';
