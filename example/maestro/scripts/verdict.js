// Waits up to ~280 s for SUITE's verdict through the test server: output.verdict is its text.
let verdict = '';
for (let i = 0; i < 56 && !verdict; i++) {
  verdict = http.get(`${PAGES}/harness/verdict?platform=${PLATFORM}&suite=${SUITE}&ms=5000`).body;
}
output.verdict = verdict;
