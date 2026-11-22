const VERDICT_MARGIN_MS = 10000;
const deadline = Date.now() + Number(SUITE_MS) + VERDICT_MARGIN_MS;
let body = '';
while (!body && Date.now() < deadline) {
  body = http.get(
    `${PAGES}/harness/step?platform=${PLATFORM}&suite=${SUITE}&after=${output.n}&ms=5000`
  ).body;
}
output.n += 1;
Object.assign(output, body ? json(body) : { action: 'done', fail: 'no verdict' });
