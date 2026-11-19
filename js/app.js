import { initUI, updatePreview, renderControls, updateDisplayedInfo, reAdjustLayout, preloadStickers, syncManualForm } from './ui.js';
import { initPhone, syncTypeChips } from './phone.js';
import { handleSearch } from './api.js';
import { handleExport, handleCopyToClipboard } from './export.js';
import { debounce } from './utils.js';

// RAWG's credit link under the search box: only while the Games tab is selected
function syncDataCredit() {
    const credit = document.getElementById('data-credit');
    if (credit) credit.hidden = state.type !== 'game';
}
import { state } from './state.js';
import { config } from './config.js';
import { setDragState } from './interact.js';
import { t } from './i18n.js';

function updateFooterDimensions() {
    const el = document.getElementById('footer-dim');
    if (el) el.textContent = state.orientation === 'vertical' ? '1200 × 1500 · JPG' : '1920 × 1080 · JPG';
    const ratio = document.getElementById('ratio-meta');
    if (ratio) ratio.textContent = t('preview.ready', { ratio: state.orientation === 'vertical' ? '4:5' : '16:9' });
    const bar = document.getElementById('preview-bar-meta');   // phones
    if (bar) bar.textContent = state.orientation === 'vertical' ? '4:5 · 1200 × 1500' : '16:9 · 1920 × 1080';
}

function init() {
    updateFooterDimensions();
    setupDesignSettings();
    initUI();
    setupEventListeners();
    initPhone();
    syncDataCredit();
    // Silently preload stickers in the background to prevent click delay
    setTimeout(preloadStickers, 500);
}

function setupDesignSettings() {
    const root = document.documentElement;
    const d = config.DESIGN;
    if (!d) return;

    if (d.horizontal) {
        if (d.horizontal.titleSize) root.style.setProperty('--canvas-title-size', d.horizontal.titleSize);
        if (d.horizontal.genreSize) root.style.setProperty('--canvas-genre-size', d.horizontal.genreSize);
    }

    if (d.vertical) {
        if (d.vertical.titleSize) root.style.setProperty('--canvas-v-title-size', d.vertical.titleSize);
    }
}

function setupEventListeners() {
    // DOM Elements - re-querying or using from UI if exposed, but simple to just query for listeners
    const el = {
        typeButtons: document.querySelectorAll('.type-btn'),
        searchQuery: document.getElementById('search-query'),
        searchResults: document.getElementById('search-results'),
        exportBtn: document.getElementById('export-btn'),
        copyBtn: document.getElementById('copy-btn'),
        synopsisText: document.getElementById('synopsis-text')
    };

    // Type Selectors
    // Custom Dropdown Logic
    const dropdown = document.getElementById('type-dropdown');
    const currentTypeBtn = document.getElementById('current-type');
    const dropdownMenu = dropdown.querySelector('.dropdown-menu');
    const dropdownItems = dropdown.querySelectorAll('.dropdown-item');

    // Toggle Menu
    currentTypeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownMenu.classList.toggle('show');
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target)) {
            dropdownMenu.classList.remove('show');
        }
    });

    // Handle Selection
    dropdownItems.forEach(item => {
        item.addEventListener('click', () => {
            // Update Active State
            dropdownItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            // Update Button Text
            const labelSpan = currentTypeBtn.querySelector('span');
            if (labelSpan) {
                labelSpan.textContent = item.textContent;
            } else {
                currentTypeBtn.textContent = item.textContent;
            }

            // Close Menu
            dropdownMenu.classList.remove('show');

            // Update State
            state.type = item.dataset.value;
            syncDataCredit();

            // RESET STATE GLOBALLY
            state.ratings = {};
            state.badges = {};

            // Manual starts empty (the card shows dimmed hints until filled in);
            // a new type always starts fresh — nothing carries over between works.
            if (state.type === 'manual') {
                state.meta = {
                    id: '', title: '', year: '', poster: '', wide: '',
                    genre: '', synopsis: '', score: '', stats: '',
                    imgPos: 'center'
                };
            } else {
                state.meta = {
                    id: '',
                    title: t('card.default.title'),
                    year: '2023',
                    poster: null,
                    wide: '',
                    genre: t('card.default.genre'),
                    synopsis: '',
                    score: '',
                    stats: '',
                    imgPos: 'center'
                };
            }

            // Manual Mode UI Toggles (upload hints are handled by card.js)
            const titleText = document.getElementById('title-text');
            const genreText = document.getElementById('genre-text');

            // Clear the previous type's query and results so they can't be
            // re-opened and selected under the new type (e.g. a game saved as a book)
            const searchResults = document.getElementById('search-results');
            const searchQuery = document.getElementById('search-query');
            searchResults.classList.add('hidden');
            searchResults.innerHTML = '';
            searchQuery.value = '';

            if (state.type === 'manual') {
                // Enable editing
                titleText.contentEditable = "true";
                genreText.contentEditable = "true";
            } else {
                // Disable editing
                titleText.contentEditable = "false";
                genreText.contentEditable = "false";
            }

            renderControls();
            updatePreview();
            updateDisplayedInfo();
            syncManualForm();
            syncTypeChips();
        });
    });

    // Orientation Selectors
    const orientButtons = document.querySelectorAll('.orient-btn');
    orientButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            orientButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // The card re-renders and re-measures every block for the new layout
            state.orientation = btn.dataset.value;
            updateFooterDimensions();
            renderControls();
            updatePreview();
            requestAnimationFrame(() => requestAnimationFrame(() => reAdjustLayout()));

            // Enable/Disable Drag based on orientation
            // User requested to remove ability to move elements in vertical mode (Step 721)
            // But keep text adjusting (contentEditable) which is handled in Manual Mode logic.
            setDragState(false);
        });
    });

    // Search Input
    el.searchQuery.addEventListener('input', debounce(() => {
        handleSearch();
    }, 500));

    el.searchQuery.addEventListener('focus', () => {
        if (el.searchQuery.value.trim()) el.searchResults.classList.remove('hidden');
    });

    // Hide search results on click outside
    document.addEventListener('click', (e) => {
        if (!el.searchQuery.contains(e.target) && !el.searchResults.contains(e.target)) {
            el.searchResults.classList.add('hidden');
        }
    });

    // Export & Copy
    el.exportBtn.addEventListener('click', handleExport);
    if (el.copyBtn) {
        el.copyBtn.addEventListener('click', handleCopyToClipboard);
    }

    // Synopsis — editing it marks it as the classifier's own (stored on export)
    el.synopsisText.addEventListener('input', (e) => {
        state.meta.synopsis = e.target.innerText;
        state.meta.synopsisEdited = true;
    });

    // Manual Title Resizing
    const titleText = document.getElementById('title-text');
    titleText.addEventListener('input', () => {
        state.meta.title = titleText.innerText;
        reAdjustLayout();
    });

    // Manual genres on the card: editing shows the genres as plain text
    // ("دراما، خيال"), and on blur the text becomes genre pills again. The length
    // pill is edited in the side form, so select-all + typing can't turn genres
    // into blue length pills.
    const genreTextEl = document.getElementById('genre-text');
    genreTextEl.addEventListener('focus', () => {
        if (state.type !== 'manual') return;
        genreTextEl.classList.remove('cd-ph');
        genreTextEl.textContent = state.meta.genre || '';
    });
    genreTextEl.addEventListener('blur', () => {
        if (state.type !== 'manual') return;
        const genres = genreTextEl.innerText.split(/[،,\n]/).map(s => s.trim()).filter(Boolean);
        state.meta.genre = genres.join(t('list.sep'));
        updateDisplayedInfo();
        syncManualForm();
    });

    // Manual: tapping a dimmed hint on the card clears it, so typing replaces it
    // instead of landing in the middle of "اكتب العنوان هنا".
    const card = document.getElementById('preview-canvas');
    card.addEventListener('focusin', (e) => {
        if (state.type !== 'manual') return;
        const el = e.target;
        if ((el.id === 'title-text' || el.id === 'synopsis-text') && el.classList.contains('cd-ph')) {
            el.textContent = ''; el.dataset.full = ''; el.classList.remove('cd-ph');
        }
    });
    // Leaving a field: re-render (an emptied field gets its hint back) and update the form
    card.addEventListener('focusout', () => {
        if (state.type !== 'manual') return;
        setTimeout(() => { updateDisplayedInfo(); syncManualForm(); }, 0);
    });

    // Manual Mode - File Upload (the cover, the vertical band and the tall poster all open it)
    const fileInput = document.getElementById('manual-cover-upload');
    document.querySelectorAll('.cd-upload-target').forEach(target => {
        target.addEventListener('click', () => {
            if (state.type === 'manual') fileInput.click();
        });
    });

    // Landscape uploads double as the wide art, so the vertical card gets the band layout
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const url = event.target.result;
            const probe = new Image();
            probe.onload = () => {
                const landscape = probe.naturalWidth / probe.naturalHeight >= 1.3;
                state.meta.poster = url;
                state.meta.wide = landscape ? url : '';
                updatePreview(); syncManualForm();
            };
            probe.onerror = () => { state.meta.poster = url; state.meta.wide = ''; updatePreview(); syncManualForm(); };
            probe.src = url;
        };
        reader.readAsDataURL(file);
        fileInput.value = '';
    });

}

// Start
document.addEventListener('DOMContentLoaded', init);
