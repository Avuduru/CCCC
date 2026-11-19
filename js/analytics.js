// Anonymous visit counting (GoatCounter). Does nothing unless the site has it switched on
// (GOATCOUNTER_CODE, see index.php) and the visitor's browser loaded the counter.
// Only an event name leaves the page, never what was typed, picked or rated.
//   searched-<type>    first search of that type that returns, once per page view
//   no-results-<type>  a search that still shows "no results" 3 s later, once per page view
//   picked-<type>      a search result was chosen
//   share / post-x / copy-text   the share buttons after Export / Copy
const counted = new Set();

export function countEvent(name, { oncePerPage = false } = {}) {
    if (oncePerPage && counted.has(name)) return;
    const gc = window.goatcounter;
    if (typeof gc?.count !== 'function') return;
    counted.add(name);
    try { gc.count({ path: name, title: name, event: true }); } catch { /* counting must never break the site */ }
}
