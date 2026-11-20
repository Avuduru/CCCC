// Anonymous visit counting (GoatCounter). Does nothing unless the site has it switched on
// (GOATCOUNTER_CODE, see index.php) and the visitor's browser loaded the counter.
// Only an event name leaves the page, never what was typed, picked or rated.
//   searched-<type>    first search of that type that returns, once per page view
//   no-results-<type>  a search that still shows "no results" 3 s later, once per page view
//   picked-<type>      a search result was chosen
//   share / post-x / copy-text   the share buttons after Export / Copy
//   save-failed / save-rejected-<code>   saving a rating failed (5xx or no connection) / was refused (4xx)
//   export-failed / copy-failed          making the card image failed
//   js-error-<file>-<line>                an uncaught error in this site's own scripts, once per page view
//                                         (only where it happened, e.g. js-error-export-278; never the message)
const counted = new Set();

export function countEvent(name, { oncePerPage = false } = {}) {
    if (oncePerPage && counted.has(name)) return;
    const gc = window.goatcounter;
    if (typeof gc?.count !== 'function') return;
    counted.add(name);
    try { gc.count({ path: name, title: name, event: true }); } catch { /* counting must never break the site */ }
}

// Uncaught errors, only from this site's own files (browser extensions and other sites' scripts are ignored).
// The event says which of our files and line it came from, nothing about the visitor or the error text.
const ours = (url) => typeof url === 'string' && url.startsWith(location.origin + '/');
const fileTag = (url) => (String(url).split(/[?#]/)[0].split('/').pop() || 'page').replace(/\.m?js$/, '').replace(/[^\w.-]/g, '').slice(0, 30) || 'page';
let errorCounted = false;
function countError(url, line) {
    if (errorCounted || typeof window.goatcounter?.count !== 'function') return;
    errorCounted = true;
    countEvent(`js-error-${fileTag(url)}-${Number(line) || 0}`);
}
window.addEventListener('error', (e) => { if (ours(e.filename)) countError(e.filename, e.lineno); });
window.addEventListener('unhandledrejection', (e) => {
    const stack = String(e.reason?.stack || '');
    const origin = location.origin + '/';
    // First stack frame from our own origin: ".../js/export.js?v=123:278:15"
    const at = stack.indexOf(origin);
    if (at < 0) return;
    const m = stack.slice(at + origin.length).match(/^(\S+?):(\d+)(?::\d+)?/);
    countError(m ? m[1] : '', m ? m[2] : 0);
});
