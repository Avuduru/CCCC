import { CATEGORIES } from './constants.js';
import { state, updateState } from './state.js';
import { handleSearch } from './api.js';
import { translateGenres, translateText } from './translations.js';
import { debounce } from './utils.js';
import { initCard, renderCard, fitCard, scalePreview } from './card.js';

// Cache for prefetched game covers
const gameCoverCache = {};

// DOM Elements
const els = {
    ratingsList: () => document.getElementById('ratings-list'),
    togglesList: () => document.getElementById('toggles-list'),
    activeStickers: () => document.getElementById('active-stickers'),
    typeButtons: () => document.querySelectorAll('.type-btn'),
    posterImg: () => document.getElementById('poster-img'),
    titleText: () => document.getElementById('title-text'),
    genreText: () => document.getElementById('genre-text'),
    scoreBadge: () => document.getElementById('score-badge'),
    scoreText: () => document.getElementById('score-text'),
    synopsisText: () => document.getElementById('synopsis-text'),
    searchQuery: () => document.getElementById('search-query'),
    searchResults: () => document.getElementById('search-results'),
    exportBtn: () => document.getElementById('export-btn'),
    previewCanvas: () => document.getElementById('preview-canvas'),
    infoModal: () => document.getElementById('info-modal'),
    openModalBtn: () => document.getElementById('open-info-modal'),
    closeModalBtn: () => document.getElementById('close-modal'),
};

export function initUI() {
    renderControls();
    initCard();
    setupModal();

    // Re-fit the synopsis while the user types in it (debounced)
    const synText = els.synopsisText();
    if (synText) {
        synText.addEventListener('input', debounce(() => fitCard(), 300));
    }
}

export function renderControls() {
    const list = els.ratingsList();
    const toggles = els.togglesList();

    if (!list || !toggles) return;

    // Clear lists
    list.innerHTML = '';
    toggles.innerHTML = '';

    // Update Title based on active dropdown item
    const dropdownItems = document.querySelectorAll('.dropdown-item');
    dropdownItems.forEach(item => {
        if (item.dataset.value === state.type) {
            const title = document.querySelector('.ratings-title');
            if (title) title.innerHTML = `<span class="label-white">محتوى</span> <span class="label-green">ال${item.textContent}</span>`;
        }
    });

    const isGameOrManual = state.type === 'game' || state.type === 'manual';
    const availableCloud = document.getElementById('available-categories');
    if (availableCloud) availableCloud.innerHTML = '';

    // 1. Render Rating Bars or Category Tags (Mawjoodat)
    CATEGORIES.Mawjoodat.forEach(cat => {
        if (cat.type === 'game_only' && !isGameOrManual) return;

        const currentLevel = state.ratings[cat.id] ? parseInt(state.ratings[cat.id]) : 0;

        if (currentLevel > 0) {
            // Render Slider Row
            const row = document.createElement('div');
            row.className = 'rating-row';
            row.innerHTML = `
                <div class="rating-row-label">
                    <span>${cat.label}</span>
                    <button class="remove-slider-btn" data-id="${cat.id}">&times;</button>
                </div>
                <div class="rating-bar-container" data-id="${cat.id}" data-level="${currentLevel}">
                    <div class="bar-segment seg-gray" data-val="0"></div>
                    <div class="bar-segment seg-yellow" data-val="3"></div>
                    <div class="bar-segment seg-orange" data-val="2"></div>
                    <div class="bar-segment seg-red" data-val="1"></div>
                    <div class="rating-knob"></div>
                </div>
            `;
            list.appendChild(row);

            // Apply correct initial UI state manually so knob is aligned
            setTimeout(() => {
                const container = row.querySelector('.rating-bar-container');
                const knob = container.querySelector('.rating-knob');
                updateRatingUI(container, knob, currentLevel);
            }, 0);

        } else {
            // Render Tag Cloud Pill
            if (availableCloud) {
                const tag = document.createElement('button');
                tag.className = 'category-tag';
                tag.dataset.id = cat.id;
                tag.innerHTML = `<span class="plus-icon">+</span> ${cat.label}`;
                availableCloud.appendChild(tag);
            }
        }
    });

    // 2. Render Toggles (Mustathniyat)
    CATEGORIES.Mustathniyat.forEach(item => {
        const div = document.createElement('div');
        div.className = 'toggle-badge';
        div.dataset.id = item.id;
        div.innerHTML = `
            <div class="toggle-square"></div>
            <span>${item.label}</span>
        `;
        toggles.appendChild(div);
    });

    attachControlListeners();
}

function attachControlListeners() {
    // 1. Tag Cloud Addition Logic
    document.querySelectorAll('.category-tag').forEach(tag => {
        tag.addEventListener('click', () => {
            const id = tag.dataset.id;
            // Set entirely new active base level
            state.ratings[id] = 1; // Default to highest severity (Red)
            renderControls();     // Re-run builder
            updatePreview();
        });
    });

    // 2. Slider Removal Logic
    document.querySelectorAll('.remove-slider-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            state.ratings[id] = 0; // Reset
            renderControls();      // Re-run builder
            updatePreview();
        });
    });

    // 3. Rating Bars Interaction (Draggable)
    document.querySelectorAll('.rating-bar-container').forEach(container => {
        const id = container.dataset.id;
        const knob = container.querySelector('.rating-knob');

        const handleMove = (clientX) => {
            const rect = container.getBoundingClientRect();
            let x = clientX - rect.left;
            // Clamp
            if (x < 0) x = 0;
            if (x > rect.width) x = rect.width;

            // RTL Calculation: 0 is Right, 100% is Left
            // percentFromLeft = x / width
            // percentFromRight = 1 - (x / width)
            const percentFromRight = 1 - (x / rect.width);

            let level = 1; // Default Red (Left)
            if (percentFromRight < 0.25) level = 0; // Right (Gray)
            else if (percentFromRight < 0.50) level = 3; // Mid-Right (Yellow)
            else if (percentFromRight < 0.75) level = 2; // Mid-Left (Orange)

            // Only update if changed
            if (parseInt(state.ratings[id]) !== level) {
                state.ratings[id] = level;
                updateRatingUI(container, knob, level);
                updatePreview();
            }
        };

        // Mouse Events
        container.addEventListener('mousedown', (e) => {
            e.preventDefault(); // Prevent text selection
            handleMove(e.clientX); // Jump to click position immediately

            const onMouseMove = (moveEvent) => handleMove(moveEvent.clientX);
            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        // Touch Events
        container.addEventListener('touchstart', (e) => {
            e.preventDefault(); // Prevent scrolling while dragging slider
            const touch = e.touches[0];
            handleMove(touch.clientX);

            const onTouchMove = (moveEvent) => {
                moveEvent.preventDefault();
                handleMove(moveEvent.touches[0].clientX);
            };
            const onTouchEnd = () => {
                document.removeEventListener('touchmove', onTouchMove);
                document.removeEventListener('touchend', onTouchEnd);
            };

            document.addEventListener('touchmove', onTouchMove, { passive: false });
            document.addEventListener('touchend', onTouchEnd);
        });
    });

    // Toggles Interaction
    document.querySelectorAll('.toggle-badge').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            state.badges[id] = !state.badges[id];

            // Update UI
            if (state.badges[id]) btn.classList.add('active');
            else btn.classList.remove('active');

            updatePreview();
        });
    });

    // --- Watermark Logic ---
    // Classifier name + rating (out of 10) \u2192 shown on the card (bound once)
    const reviewerInput = document.getElementById('reviewer-name-input');
    const ratingInput = document.getElementById('reviewer-rating-input');
    if (reviewerInput && !reviewerInput.dataset.bound) {
        reviewerInput.dataset.bound = '1';
        reviewerInput.addEventListener('input', (e) => {
            state.classifier.name = e.target.value.trim();
            renderCard();
        });
    }
    if (ratingInput && !ratingInput.dataset.bound) {
        ratingInput.dataset.bound = '1';
        ratingInput.addEventListener('input', (e) => {
            state.classifier.rating = normalizeRating(e.target.value);
            renderCard();
        });
        ratingInput.addEventListener('blur', () => {
            ratingInput.value = state.classifier.rating;
        });
    }
}

// Accepts 0\u201310 with up to two decimals ("7.5", "6.25", Arabic digits or "\u066B");
// anything else is dropped so the card never shows e.g. "11/10".
export function normalizeRating(raw) {
    let t = String(raw || '').trim()
        .replace(/[\u0660-\u0669]/g, d => '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669'.indexOf(d))
        .replace(/[\u066B,]/g, '.');
    if (!t) return '';
    const m = t.match(/^\d{1,2}(\.\d{0,2})?/);
    if (!m) return '';
    let n = parseFloat(m[0]);
    if (isNaN(n) || n < 0) return '';
    if (n > 10) n = 10;
    return String(Math.round(n * 100) / 100);
}

function setupModal() {
    const modal = els.infoModal();
    const openBtn = els.openModalBtn();
    const closeBtn = els.closeModalBtn();

    if (!modal || !openBtn || !closeBtn) return;

    openBtn.addEventListener('click', (e) => {
        e.preventDefault();
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden'; // Prevent Scroll
    });

    const closeModal = () => {
        modal.classList.add('hidden');
        document.body.style.overflow = ''; // Restore Scroll
    };

    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Close on Escape
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
            closeModal();
        }
    });
}

export function updateRatingUI(container, knob, level) {
    container.dataset.level = level;
    container.className = `rating-bar-container active-${level}`;

    // 4 Segments: Gray(0), Yellow(3), Orange(2), Red(1)
    // RTL layout:
    // Level 0 (Gray): Rightmost -> 12.5% from right
    // Level 3 (Yellow): Second -> 37.5% from right
    // Level 2 (Orange): Third -> 62.5% from right
    // Level 1 (Red): Leftmost -> 87.5% from right

    let pos = '12.5%';
    if (level === 3) pos = '37.5%';
    if (level === 2) pos = '62.5%';
    if (level === 1) pos = '87.5%';

    knob.style.right = pos;
}

export function updatePreview() {
    renderCard();
}

export function reAdjustLayout() {
    fitCard();
    scalePreview();
}

export function showSearchResults(data, type) {
    let results = [];
    if (type === 'movie' || type === 'tv') results = data.results || [];
    else if (type === 'game') results = data.results || [];
    else if (type === 'anime' || type === 'manga') results = data.data || [];
    else if (type === 'book') results = data.docs || []; // Open Library uses 'docs'

    const container = els.searchResults();
    container.innerHTML = '';

    if (!results.length) {
        container.innerHTML = '<div class="search-result-item">لا توجد نتائج</div>';
    } else {
        results.slice(0, 5).forEach(item => {
            const title = item.title || item.name || item.title_english || (item.volumeInfo ? item.volumeInfo.title : 'No Title');
            // Neutral 2:3 tile for results without artwork
            let poster = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='69'%3E%3Crect width='46' height='69' fill='%23262a33'/%3E%3C/svg%3E";

            if (item.poster_path) poster = `https://image.tmdb.org/t/p/w92${item.poster_path}`;
            else if (item.background_image) poster = item.background_image; // RAWG
            else if (item.thumbnail) poster = item.thumbnail; // FreeToGame (legacy)
            else if (item.images?.jpg?.small_image_url) poster = item.images.jpg.small_image_url;
            else if (item.volumeInfo?.imageLinks?.thumbnail) poster = item.volumeInfo.imageLinks.thumbnail;
            else if (item.cover_i) poster = `https://covers.openlibrary.org/b/id/${item.cover_i}-S.jpg`; // Open Library covers

            const div = document.createElement('div');
            div.className = 'search-result-item';
            
            const img = document.createElement('img');
            img.src = poster;
            
            const span = document.createElement('span');
            span.textContent = title;
            
            div.appendChild(img);
            div.appendChild(span);
            div.addEventListener('click', () => selectItem(item, type));
            container.appendChild(div);

            // Prefetch game covers in background for instant selection
            if (type === 'game') {
                const searchName = item.name || item.title;
                if (searchName && !gameCoverCache[searchName]) {
                    fetch(`proxy.php?query=${encodeURIComponent(searchName)}&type=game_cover`)
                        .then(resp => resp.json())
                        .then(data => {
                            if (data.success && data.data && data.data.length > 0) {
                                const coverUrl = data.data[0].url;
                                if (coverUrl) {
                                    gameCoverCache[searchName] = `proxy.php?query=${encodeURIComponent(coverUrl)}&type=image_proxy`;
                                }
                            }
                        })
                        .catch(err => console.error('Failed to prefetch cover:', err));
                }
            }
        });
    }
    container.classList.remove('hidden');
}

function selectItem(item, type) {
    if (type === 'anime' || type === 'manga') {
        // AniList (primary) and Jikan/MAL (fallback) use different ID spaces — namespace them
        state.meta.id = item.mal_id ? `${item.id_source || 'mal'}:${item.mal_id}` : '';
    } else if (type === 'book') {
        state.meta.id = item.key || ''; // Open Library work key, e.g. /works/OL893414W
    } else {
        state.meta.id = item.slug || item.id || '';
    }
    state.meta.title = item.title || item.name || item.title_english || (item.volumeInfo ? item.volumeInfo.title : 'No Title');
    state.meta.score = '';
    state.meta.stats = '';
    state.meta.wide = '';
    const proxied = (u) => u ? `proxy.php?query=${encodeURIComponent(u)}&type=image_proxy` : '';


    if (type === 'movie' || type === 'tv') {
        if (item.vote_average) state.meta.score = parseFloat(item.vote_average).toFixed(1);
        // Proxied so the export canvas isn't tainted (CORS). w780 poster, w1280 backdrop.
        state.meta.poster = item.poster_path ? proxied(`https://image.tmdb.org/t/p/w780${item.poster_path}`) : '';
        state.meta.wide = item.backdrop_path ? proxied(`https://image.tmdb.org/t/p/w1280${item.backdrop_path}`) : '';

        // Default fallback genre while fetching
        state.meta.genre = translateGenres(type === 'movie' ? 'Movie' : 'TV Series');

        // Fetch details for runtime/episodes and genres
        const detailType = type === 'movie' ? 'movie_details' : 'tv_details';
        fetch(`proxy.php?query=${item.id}&type=${detailType}`)
            .then(resp => resp.json())
            .then(data => {
                if (data.genres && data.genres.length > 0) {
                    const genreText = data.genres.map(g => g.name).join(', ');
                    state.meta.genre = translateGenres(genreText);
                }

                if (type === 'movie' && data.runtime) {
                    state.meta.stats = formatArabicPlural(data.runtime, 'minute');
                } else if (type === 'tv' && data.number_of_episodes) {
                    state.meta.stats = formatArabicPlural(data.number_of_episodes, 'episode');
                }
                updateDisplayedInfo();
            }).catch(e => console.error(e));

        // Translate synopsis asynchronously
        if (item.overview) {
            state.meta.synopsis = 'جاري الترجمة...';
            updateDisplayedInfo();
            translateText(item.overview).then(translated => {
                state.meta.synopsis = translated;
                updateDisplayedInfo();
            });
        }
    } else if (type === 'game') {
        if (item.metacritic) state.meta.score = item.metacritic;
        // RAWG format - fetch full game details for description
        state.meta.poster = ''; // Start empty, will be filled by SteamGridDB (600×900)
        state.meta.wide = proxied(item.background_image); // RAWG key art (16:9)
        const genreText = item.genres ? item.genres.map(g => g.name).join(', ') : 'Game';
        state.meta.genre = translateGenres(genreText);

        // Show loading message  
        state.meta.synopsis = 'جاري التحميل...';
        updateDisplayedInfo();

        // Fetch full game details asynchronously
        if (item.slug) {
            const gameName = item.name || item.title;

            // Fire RAWG details + HLTB in parallel
            const detailsPromise = fetch(`proxy.php?query=${item.slug}&type=game_details`)
                .then(resp => resp.json())
                .catch(err => { console.error('Failed to fetch game details:', err); return null; });

            const hltbPromise = gameName
                ? fetch(`proxy.php?query=${encodeURIComponent(gameName)}&type=hltb`)
                    .then(resp => resp.json())
                    .catch(err => { console.error('HLTB fetch failed:', err); return null; })
                : Promise.resolve(null);

            Promise.all([detailsPromise, hltbPromise]).then(([data, hltbData]) => {
                // --- RAWG details ---
                if (data) {
                    let description = '';
                    if (data.description_raw) {
                        description = data.description_raw;
                    } else if (data.description) {
                        description = data.description.replace(/<[^>]*>/g, '');
                    } else {
                        const platform = item.platforms ? item.platforms.map(p => p.platform.name).slice(0, 3).join(', ') : '';
                        const released = item.released ? `Released: ${item.released}` : '';
                        description = [platform, released].filter(Boolean).join(' • ') || 'No description available';
                    }
                    if (data.metacritic) state.meta.score = data.metacritic;

                    // --- Playtime: prefer HLTB, fallback to RAWG ---
                    if (hltbData && hltbData.success && hltbData.data && hltbData.data.main_story > 0) {
                        state.meta.stats = formatArabicPlural(hltbData.data.main_story, 'hour');
                    } else if (data.playtime) {
                        // Fallback to RAWG average playtime
                        state.meta.stats = formatArabicPlural(data.playtime, 'hour');
                    }

                    // Translate description
                    translateText(description).then(translated => {
                        state.meta.synopsis = translated;
                        updateDisplayedInfo();
                    });
                } else {
                    // RAWG failed entirely — still try HLTB for stats
                    if (hltbData && hltbData.success && hltbData.data && hltbData.data.main_story > 0) {
                        state.meta.stats = formatArabicPlural(hltbData.data.main_story, 'hour');
                    }
                    const platform = item.platforms ? item.platforms.map(p => p.platform.name).slice(0, 3).join(', ') : '';
                    const released = item.released ? `Released: ${item.released}` : '';
                    state.meta.synopsis = [platform, released].filter(Boolean).join(' • ') || 'No description available';
                }
                updateDisplayedInfo();
            });
        }

        // 2. Fetch vertical cover asynchronously (SteamGridDB)
        const searchName = item.name || item.title;
        if (searchName) {
            // Check cache first for instant display
            if (gameCoverCache[searchName]) {
                state.meta.poster = gameCoverCache[searchName];
                updateDisplayedInfo();
            } else {
                // Fetch if not in cache
                fetch(`proxy.php?query=${encodeURIComponent(searchName)}&type=game_cover`)
                    .then(resp => resp.json())
                    .then(data => {
                        if (data.success && data.data && data.data.length > 0) {
                            const coverUrl = data.data[0].url;
                            if (coverUrl) {
                                // Proxy the image to avoid CORS issues during export
                                const proxiedUrl = `proxy.php?query=${encodeURIComponent(coverUrl)}&type=image_proxy`;
                                gameCoverCache[searchName] = proxiedUrl; // Cache it
                                state.meta.poster = proxiedUrl;
                                updateDisplayedInfo();
                            }
                        }
                    })
                    .catch(err => console.error('Failed to fetch steamgriddb cover:', err));
            }
        }

        // Update display immediately with what we have
        updateDisplayedInfo();
        els.searchResults().classList.add('hidden');
        els.searchQuery().value = state.meta.title;
        return; // Early return since we handle display updates in async callback
    } else if (type === 'anime' || type === 'manga') {
        if (item.score) state.meta.score = parseFloat(item.score).toFixed(2);
        
        if (type === 'anime' && item.episodes) {
            state.meta.stats = formatArabicPlural(item.episodes, 'episode');
        } else if (type === 'manga') {
            let statsParts = [];
            if (item.chapters) statsParts.push(formatArabicPlural(item.chapters, 'chapter'));
            if (item.volumes) statsParts.push(formatArabicPlural(item.volumes, 'volume'));
            if (statsParts.length > 0) state.meta.stats = statsParts.join(' • ');
        }
        
        const rawPoster = item.images.jpg.large_image_url;
        state.meta.poster = `proxy.php?query=${encodeURIComponent(rawPoster)}&type=image_proxy`;

        // Translate genre
        const genreText = item.genres ? item.genres.map(g => g.name).join(', ') : '';
        state.meta.genre = translateGenres(genreText);

        // Translate synopsis (without source credits like "(Source: Crunchyroll)")
        const cleanSynopsis = cleanSourceNotes(item.synopsis || '');
        state.meta.synopsis = cleanSynopsis ? 'جاري الترجمة...' : '';
        updateDisplayedInfo();
        if (cleanSynopsis) {
            translateText(cleanSynopsis).then(translated => {
                state.meta.synopsis = translated;
                updateDisplayedInfo();
            });
        }
    } else if (type === 'book') {
        if (item.ratings_average) state.meta.score = parseFloat(item.ratings_average).toFixed(1);
        if (item.number_of_pages_median) state.meta.stats = formatArabicPlural(item.number_of_pages_median, 'page');
        // Open Library format
        const rawPoster = item.cover_i ? `https://covers.openlibrary.org/b/id/${item.cover_i}-L.jpg` : (item.volumeInfo?.imageLinks?.thumbnail || '');
        state.meta.poster = rawPoster ? `proxy.php?query=${encodeURIComponent(rawPoster)}&type=image_proxy` : '';

        // Genre pill: categories when present, otherwise the first publication year
        const categories = item.volumeInfo?.categories?.join(', ');
        state.meta.genre = categories ? translateGenres(categories)
            : (item.first_publish_year ? `نُشر عام ${item.first_publish_year}` : translateGenres('Book'));

        // Description: the Open Library work page has one for many books; search
        // results only carry a first sentence. With neither, the synopsis stays empty.
        const fallback = item.first_sentence?.join(' ') || item.volumeInfo?.description || '';
        const selectedKey = item.key;
        state.meta.synopsis = 'جاري التحميل...';
        updateDisplayedInfo();
        const detailsPromise = selectedKey
            ? fetch(`proxy.php?query=${encodeURIComponent(selectedKey)}&type=book_details`).then(r => r.json()).catch(() => null)
            : Promise.resolve(null);
        detailsPromise.then(details => {
            if (state.meta.id !== selectedKey) return; // user picked something else meanwhile
            const description = (details && details.description) || fallback;
            if (!description) { state.meta.synopsis = ''; updateDisplayedInfo(); return; }
            translateText(description).then(translated => {
                if (state.meta.id !== selectedKey) return;
                state.meta.synopsis = translated;
                updateDisplayedInfo();
            });
        });
    }

    updateDisplayedInfo();
    els.searchResults().classList.add('hidden');
    els.searchQuery().value = state.meta.title;
}

export function updateDisplayedInfo() {
    renderCard();
}

// Remove source credits that AniList/MAL append to synopses, e.g.
// "(Source: Crunchyroll)", "[Written by MAL Rewrite]", "(Source: Square Enix)".
function cleanSourceNotes(text) {
    return text
        .replace(/[(\[]\s*(?:source|written by|via)\b[^)\]]*[)\]]/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// Arabic Plural Rules Helper
export function formatArabicPlural(count, type) {
    const num = parseFloat(count);
    if (!num || isNaN(num) || num === 0) return '';
    
    const words = {
        episode: { s1: 'حلقة واحدة', s2: 'حلقتان', p3_10: 'حلقات', p11: 'حلقة' },
        chapter: { s1: 'فصل واحد', s2: 'فصلان', p3_10: 'فصول', p11: 'فصل' },
        volume:  { s1: 'مجلد واحد', s2: 'مجلدان', p3_10: 'مجلدات', p11: 'مجلد' },
        minute:  { s1: 'دقيقة واحدة', s2: 'دقيقتان', p3_10: 'دقائق', p11: 'دقيقة' },
        hour:    { s1: 'ساعة واحدة', s2: 'ساعتان', p3_10: 'ساعات', p11: 'ساعة' },
        page:    { s1: 'صفحة واحدة', s2: 'صفحتان', p3_10: 'صفحات', p11: 'صفحة' }  
    };

    const w = words[type];
    if (!w) return `${num}`;

    if (num % 1 !== 0) return `${num} ${w.p11}`;
    if (num === 1) return w.s1;
    if (num === 2) return w.s2;

    const lastTwo = num % 100;
    if (lastTwo >= 3 && lastTwo <= 10) return `${num} ${w.p3_10}`;
    return `${num} ${w.p11}`;
}

export function preloadStickers() {
    // Only preload once to save bandwidth
    if (window._stickersPreloaded) return;
    window._stickersPreloaded = true;

    const cacheImage = (src) => {
        const img = new Image();
        img.src = src;
    };

    // Preload Mawjoodat (Severities 1, 2, 3)
    CATEGORIES.Mawjoodat.forEach(cat => {
        for (let i = 1; i <= 3; i++) {
            cacheImage(`assets/icons/${cat.icon}${i}.png?v=2`);
        }
    });

    // Preload Mustathniyat (Exception Badges 0)
    CATEGORIES.Mustathniyat.forEach(item => {
        cacheImage(`assets/icons/${item.icon}0.png?v=2`);
    });
}
