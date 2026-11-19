import { config } from './config.js';
import { state } from './state.js';
import { t } from './i18n.js';
import { showSearchResults } from './ui.js';
import { countEvent } from './analytics.js';

export async function handleSearch() {
    const searchQuery = document.getElementById('search-query');
    const searchResults = document.getElementById('search-results');

    const query = searchQuery.value.trim();
    // One character is just the start of typing: wait for more (saves the sources' rate limits)
    if ([...query].length < 2) {
        searchResults.classList.add('hidden');
        return;
    }

    const type = state.type;

    // Drop answers that arrive after the user switched type or changed the query
    const stale = () => state.type !== type || searchQuery.value.trim() !== query;
    try {
        const resp = await fetch(`${config.WORKER_URL}?query=${encodeURIComponent(query)}&type=${type}`);
        if (stale()) return;
        // Decide by status, not body: the CDN's own 429/403 pages are HTML, not JSON
        if (!resp.ok) {
            showSearchMessage(resp.status === 429 ? t('search.busy') : t('search.failed'));
            return;
        }
        const data = await resp.json();
        if (stale()) return;
        if (data) {
            showSearchResults(data, type);
            countEvent(`searched-${type}`, { oncePerPage: true });
        }
    } catch (err) {
        console.error('Search Error:', err);
        if (!stale()) showSearchMessage(navigator.onLine === false ? t('search.offline') : t('search.failed'));
    }
}

// One line in the results box instead of results (busy / failed / offline)
function showSearchMessage(text) {
    const box = document.getElementById('search-results');
    box.innerHTML = '';
    const line = document.createElement('div');
    line.className = 'search-result-item search-msg';
    line.textContent = text;
    box.appendChild(line);
    box.classList.remove('hidden');
}
