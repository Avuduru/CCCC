import { config } from './config.js';
import { state } from './state.js';
import { showSearchResults } from './ui.js';

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

    try {
        const resp = await fetch(`${config.WORKER_URL}?query=${encodeURIComponent(query)}&type=${type}`);
        const data = await resp.json();

        // Drop responses that arrive after the user switched type or changed the query
        if (state.type !== type || searchQuery.value.trim() !== query) return;

        if (data) showSearchResults(data, type);
    } catch (err) {
        console.error('Search Error:', err);
    }
}
