// Kills the page's renderer through the test server (Maestro has no shell).
http.get(`http://localhost:8090/driver/kill?platform=${PLATFORM}&device=${DEVICE}`);
