// Kills the page's renderer through the test server (Maestro has no shell).
http.get(`${PAGES}/driver/kill?platform=${PLATFORM}`);
