// Shared by every test page: shows location.href live and a log the harness can read back (window.testLog).
window.testLog = [];
window.log = (...args) => {
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  window.testLog.push(line);
  const el = document.getElementById('log');
  if (el) el.textContent = window.testLog.join('\n');
};
const showHref = () => {
  const el = document.getElementById('href');
  if (el) el.textContent = location.href;
};
for (const name of ['pushState', 'replaceState']) {
  const original = history[name].bind(history);
  history[name] = (...args) => {
    original(...args);
    showHref();
  };
}
addEventListener('hashchange', showHref);
addEventListener('popstate', showHref);
addEventListener('DOMContentLoaded', () => {
  document.body.insertAdjacentHTML('afterbegin', '<p><a href="/">home</a> · <code id="href"></code></p>');
  document.body.insertAdjacentHTML('beforeend', '<h3>log</h3><pre id="log"></pre>');
  showHref();
});
