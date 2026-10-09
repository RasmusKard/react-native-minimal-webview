// Queues a harness suite; the app polls the test server for it.
http.get(`http://localhost:8090/harness/run?platform=${PLATFORM}&suite=${SUITE}`);
