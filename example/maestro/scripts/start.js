// Queues a harness suite; the app polls the test server for it. None of its driver requests are done yet.
http.get(`${PAGES}/harness/run?platform=${PLATFORM}&suite=${SUITE}`);
output.n = 0;
output.action = '';
