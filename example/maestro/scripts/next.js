let body = '';
for (let i = 0; i < 56 && !body; i++) {
  body = http.get(
    `${PAGES}/harness/step?platform=${PLATFORM}&suite=${SUITE}&after=${output.n}&ms=5000`
  ).body;
}
output.n += 1;
Object.assign(output, body ? json(body) : { action: 'done', fail: 'no verdict' });
