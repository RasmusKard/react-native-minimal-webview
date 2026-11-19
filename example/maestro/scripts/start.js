// Queues a harness suite; the app polls the test server for it.
http.get(`${PAGES}/harness/run?platform=${PLATFORM}&suite=${SUITE}`);
