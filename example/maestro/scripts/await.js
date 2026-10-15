// Waits up to 60 s for the harness's request number N of SUITE (or its verdict, when it ended first) through the test
// server, which is much cheaper than reading the screen. output.request is its text: `<suite>#<n> <REQUEST> <detail>`.
let request = '';
for (let i = 0; i < 12 && !request; i++) {
  request = http.get(
    `http://localhost:8090/harness/await?platform=${PLATFORM}&suite=${SUITE}&n=${N}&ms=5000`
  ).body;
}
output.request = request;
