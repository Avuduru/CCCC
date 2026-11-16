// Card v4: renders the share card from state and fits every text block by
// measuring the real DOM. The card is laid out at export size (1920×1080 or
// 1200×1500); the preview is the same element scaled down (scalePreview), so
// what the user sees is exactly what is exported.
import { state } from './state.js';
import { CATEGORIES } from './constants.js';

export const CARD_SIZE = { h: { w: 1920, h: 1080 }, v: { w: 1200, h: 1500 } };

// Title: one line at `one`px if it fits, else the largest size ≤ `two` that
// fits in two lines (down to `min`), then a word-boundary "…".
const TITLE = {
    h:    { one: 156, two: 104, min: 80 },   // C-H / CH-stress
    wide: { one: 118, two: 84,  min: 64 },   // CV-wide / CV-stress
    tall: { one: 124, two: 84,  min: 64 },   // A-V / CVside
};
const SYNOPSIS = { min: 26, max: 52 };
const STICKER = { gap: 16, groupGap: 28, one: 190, two: { h: 140, wide: 150, tall: 150 } };

const $ = (sel, root) => (root || document).querySelector(sel);
export const cardEl = () => document.getElementById('preview-canvas');

export function layoutOf() {
    if (state.orientation !== 'vertical') return 'h';
    return state.meta.wide ? 'wide' : 'tall';
}

const isFocused = (el) => el && document.activeElement === el;
const startsLatin = (t) => /^[\sA-Za-z0-9À-ɏ@"'(]/.test(t || '') && /[A-Za-z]/.test((t || '').slice(0, 12));

// ── Text helpers ─────────────────────────────────────────────────────────
// Shorten el's text until fits() is true, cutting at a word boundary with "…".
// Falls back to a character cut when a single word is too long.
export function truncateToFit(el, fits) {
    if (fits()) return;
    const original = el.textContent;
    const parts = original.split(/(\s+)/);
    const setWords = (n) => { el.textContent = parts.slice(0, n).join('').trimEnd() + '…'; };
    let lo = 0, hi = parts.length;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        setWords(mid);
        if (fits()) lo = mid; else hi = mid;
    }
    if (lo > 0) { setWords(lo); return; }
    let clo = 0, chi = original.length;
    while (chi - clo > 1) {
        const mid = (clo + chi) >> 1;
        el.textContent = original.slice(0, mid) + '…';
        if (fits()) clo = mid; else chi = mid;
    }
    el.textContent = original.slice(0, clo) + '…';
}

const lineHeightPx = (el) => {
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight);
    return isNaN(lh) ? parseFloat(cs.fontSize) * 1.2 : lh;
};
const lineCount = (el) => Math.round(el.scrollHeight / lineHeightPx(el));

// One fit per frame, however many images finish loading in it
let fitQueued = false;
function scheduleFit() {
    if (fitQueued) return;
    fitQueued = true;
    requestAnimationFrame(() => { fitQueued = false; fitCard(); });
}

// ── Rendering ────────────────────────────────────────────────────────────
function setBg(el, url) {
    if (!el) return;
    el.style.backgroundImage = url ? `url("${url}")` : 'none';
    el.classList.toggle('empty-poster', !url);
}

function renderPills(g, stats, genres, shown) {
    g.textContent = '';
    stats.forEach(s => {
        const p = document.createElement('span');
        p.className = 'cd-pill cd-pill-stat stats-pill';
        p.textContent = s;
        g.appendChild(p);
    });
    genres.slice(0, shown).forEach(t => {
        const p = document.createElement('span');
        p.className = 'cd-pill cd-pill-genre';
        p.textContent = t;
        g.appendChild(p);
    });
    if (shown < genres.length) {
        const p = document.createElement('span');
        p.className = 'cd-pill cd-pill-genre more-pill';
        p.dir = 'ltr'; // "+3", not "3+"
        p.textContent = `+${genres.length - shown}`;
        g.appendChild(p);
    }
}

export function renderStickers(card = cardEl()) {
    if (!card) return;
    const warn = [];
    for (const cat of CATEGORIES.Mawjoodat) {
        const lvl = parseInt(state.ratings[cat.id], 10);
        if (lvl > 0) warn.push({ src: `assets/icons/${cat.icon}${lvl}.png?v=2`, alt: cat.label, fallback: `assets/icons/${cat.icon}.png?v=2` });
    }
    const free = CATEGORIES.Mustathniyat.filter(b => state.badges[b.id])
        .map(b => ({ src: `assets/icons/${b.icon}0.png?v=2`, alt: b.label }));

    const fill = (grid, list) => {
        grid.textContent = '';
        list.forEach(s => {
            const img = document.createElement('img');
            img.className = 'cd-sticker';
            img.addEventListener('load', scheduleFit);
            img.src = s.src; img.alt = s.alt;
            if (s.fallback) img.onerror = () => { if (img.src.indexOf(s.fallback) < 0) img.src = s.fallback; };
            grid.appendChild(img);
        });
    };
    fill($('#active-stickers', card), warn);
    fill($('#free-stickers', card), free);
    $('#cd-group-warn', card).classList.toggle('hidden', !warn.length);
    $('#cd-group-free', card).classList.toggle('hidden', !free.length);
    $('#cd-divider', card).classList.toggle('hidden', !(warn.length && free.length));
    $('#cd-stickers', card).classList.toggle('hidden', !(warn.length || free.length));
}

export function renderClassifier(card = cardEl()) {
    if (!card) return;
    const name = (state.classifier.name || '').trim();
    const rating = (state.classifier.rating || '').toString().trim();
    card.querySelectorAll('.cd-classifier').forEach(c => {
        const n = $('.cd-cl-name', c);
        n.textContent = name;
        n.dataset.full = name;
        n.dir = /^[A-Za-z@]/.test(name) ? 'ltr' : 'rtl';
        $('.cd-cl-num', c).textContent = rating;
        $('.cd-cl-text', c).classList.toggle('hidden', !name);
        $('.cd-cl-sep', c).classList.toggle('hidden', !(name && rating));
        $('.cd-cl-rating', c).classList.toggle('hidden', !rating);
        c.classList.toggle('hidden', !(name || rating));
    });
}

export function applyLayout(card = cardEl()) {
    if (!card) return;
    const L = layoutOf();
    card.classList.toggle('cd-h', L === 'h');
    card.classList.toggle('cd-v', L !== 'h');
    card.classList.toggle('cd-wide', L === 'wide');
    card.classList.toggle('cd-tall', L === 'tall');
    card.dataset.layout = L;
}

export function renderCard() {
    const card = cardEl();
    if (!card) return;
    applyLayout(card);
    const m = state.meta;
    const L = card.dataset.layout;

    // Images: H uses the tall poster (wide art as a fallback); V-wide the wide art;
    // V-tall the tall poster beside the synopsis.
    const tall = m.poster || m.wide || '';
    setBg($('#poster-img', card), L === 'wide' ? m.wide : tall);
    setBg($('#cd-tall-poster', card), tall);
    const manual = state.type === 'manual';
    card.querySelectorAll('.cd-upload-target').forEach(t => {
        t.classList.toggle('manual-mode', manual);
        const hint = $('.upload-overlay', t);
        if (hint) hint.classList.toggle('hidden', !(manual && !tall));
    });

    const t = $('#title-text', card);
    if (!isFocused(t)) {
        t.textContent = m.title || '';
        t.dataset.full = m.title || '';
        t.dir = startsLatin(m.title) ? 'ltr' : 'rtl';
    }

    const score = (m.score ?? '').toString().trim();
    const st = $('#score-text', card);
    if (!isFocused(st)) st.textContent = score;
    $('#score-badge', card).classList.toggle('hidden', !score && state.type !== 'manual');

    const g = $('#genre-text', card);
    if (!isFocused(g)) {
        const stats = (m.stats || '').split(' • ').map(s => s.trim()).filter(Boolean);
        const genres = (m.genre || '').split(/،|,/).map(s => s.trim()).filter(Boolean);
        g.dataset.stats = JSON.stringify(stats);
        g.dataset.genres = JSON.stringify(genres);
        renderPills(g, stats, genres, genres.length);
    }

    const syn = $('#synopsis-text', card);
    if (!isFocused(syn)) {
        syn.textContent = m.synopsis || '';
        syn.dataset.full = m.synopsis || '';
    }

    renderStickers(card);
    renderClassifier(card);
    requestAnimationFrame(() => { fitCard(card); scalePreview(); });
}

// ── Fitting (measured) ───────────────────────────────────────────────────
function fitTitle(card, L) {
    const t = $('#title-text', card);
    const cfg = TITLE[L];
    if (!isFocused(t) && t.dataset.full !== undefined) t.textContent = t.dataset.full;
    t.classList.add('cd-one-line');
    t.style.fontSize = cfg.one + 'px';
    if (lineCount(t) <= 1) return;
    t.classList.remove('cd-one-line');
    let size = cfg.two;
    t.style.fontSize = size + 'px';
    while (lineCount(t) > 2 && size > cfg.min) {
        size -= 4;
        t.style.fontSize = size + 'px';
    }
    if (!isFocused(t) && lineCount(t) > 2) {
        const maxH = lineHeightPx(t) * 2 + 2;
        truncateToFit(t, () => t.scrollHeight <= maxH);
    }
}

function fitPills(card) {
    const row = $('.cd-pills', card);
    const g = $('#genre-text', card);
    if (isFocused(g) || !g.dataset.genres) return;
    const stats = JSON.parse(g.dataset.stats || '[]');
    const genres = JSON.parse(g.dataset.genres || '[]');
    let shown = genres.length;
    renderPills(g, stats, genres, shown);
    while (row.scrollWidth > row.clientWidth + 1 && shown > 1) {
        shown--;
        renderPills(g, stats, genres, shown);
    }
}

// Stickers grow to fill the panel (up to 190px), fixed 16px gaps, groups centred;
// more than 6 in total → two balanced rows.
function fitStickers(card, L) {
    const panel = $('#cd-stickers', card);
    if (panel.classList.contains('hidden')) return;
    const warn = $('#active-stickers', card), free = $('#free-stickers', card);
    const n1 = warn.children.length, n2 = free.children.length;
    const cs = getComputedStyle(panel);
    const innerW = panel.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const rows = (n1 + n2) > 6 ? 2 : 1;
    const per1 = n1 ? Math.ceil(n1 / rows) : 0;
    const per2 = n2 ? Math.ceil(n2 / rows) : 0;
    const divider = (n1 && n2) ? 2 + STICKER.groupGap * 2 : 0;
    const gaps = (Math.max(per1 - 1, 0) + Math.max(per2 - 1, 0)) * STICKER.gap;
    const max = rows === 2 ? STICKER.two[L] : STICKER.one;
    const size = Math.floor(Math.min(max, (innerW - divider - gaps) / (per1 + per2)));
    const apply = (grid, per) => {
        grid.style.width = per ? (per * size + (per - 1) * STICKER.gap) + 'px' : '';
        // html2canvas has no object-fit: keep each icon's own aspect (exception icons are ~0.97 wide)
        Array.from(grid.children).forEach(img => {
            const r = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
            img.style.width = Math.round(size * Math.min(r, 1)) + 'px';
            img.style.height = size + 'px';
        });
    };
    apply(warn, per1);
    apply(free, per2);
}

// V-tall: the poster takes the row's full height at 2:3, so no space is left unused.
function fitTallPoster(card, L) {
    const poster = $('#cd-tall-poster', card);
    if (L !== 'tall') { poster.style.width = ''; poster.style.height = ''; return; }
    const row = $('.cd-row', card);
    const cs = getComputedStyle(row);
    const h = row.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    poster.style.height = h + 'px';
    poster.style.width = Math.round(h * 2 / 3) + 'px';
}

// Fill-to-fit: the largest size (26–52px) whose text fits the box; still too
// long at 26px → ends on the last whole word with "…".
function fitSynopsis(card) {
    const el = $('#synopsis-text', card);
    const box = el.parentElement;
    if (!isFocused(el) && el.dataset.full !== undefined) el.textContent = el.dataset.full;
    if (!el.textContent.trim()) { el.style.fontSize = SYNOPSIS.max + 'px'; return; }
    const fits = () => el.scrollHeight <= box.clientHeight + 1;
    let lo = SYNOPSIS.min, hi = SYNOPSIS.max, best = SYNOPSIS.min;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        el.style.fontSize = mid + 'px';
        if (fits()) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    el.style.fontSize = best + 'px';
    if (!isFocused(el) && !fits()) truncateToFit(el, fits);
}

// The classifier never spills: max = cover/band width − margins, or the footer space.
function fitClassifier(card, L) {
    const c = L === 'tall' ? $('.cd-footer .cd-classifier', card) : $('.cd-media .cd-classifier', card);
    if (!c || c.classList.contains('hidden')) return;
    const name = $('.cd-cl-name', c);
    if (name.dataset.full !== undefined) name.textContent = name.dataset.full;
    let maxW;
    if (L === 'tall') {
        const footer = $('.cd-footer', card);
        const brand = $('.cd-footer-brand', card);
        const fcs = getComputedStyle(footer);
        maxW = Math.min(680, footer.clientWidth - parseFloat(fcs.paddingLeft) - parseFloat(fcs.paddingRight) - brand.offsetWidth - 48);
    } else {
        maxW = c.parentElement.clientWidth;
    }
    // scrollWidth: the pill's max-width clamps offsetWidth while the text overflows
    truncateToFit(name, () => Math.max(c.offsetWidth, c.scrollWidth) <= maxW);
}

export function fitCard(card = cardEl()) {
    if (!card) return;
    const L = card.dataset.layout || layoutOf();
    fitTitle(card, L);
    fitPills(card);
    fitStickers(card, L);
    fitTallPoster(card, L);
    fitSynopsis(card);
    fitClassifier(card, L);
}

// ── Preview scaling ──────────────────────────────────────────────────────
export function scalePreview() {
    const card = cardEl();
    if (!card) return;
    const scaler = card.parentElement;
    const size = card.dataset.layout === 'h' || !card.dataset.layout ? CARD_SIZE.h : CARD_SIZE.v;
    const availW = scaler.clientWidth;
    if (!availW) return;
    let k = availW / size.w;
    if (size === CARD_SIZE.v) k = Math.min(k, Math.min(760, window.innerHeight * 0.8) / size.h);
    scaler.style.height = Math.round(size.h * k) + 'px';
    card.style.transform = `scale(${k})`;
    card.style.left = Math.round((availW - size.w * k) / 2) + 'px';
}

export function initCard() {
    const card = cardEl();
    if (!card) return;
    // Keep the untruncated text in step with what the user types, so a later
    // re-fit restores their words rather than the old ones.
    ['#title-text', '#synopsis-text'].forEach(sel => {
        const el = $(sel, card);
        el.addEventListener('input', () => { el.dataset.full = el.innerText; });
    });
    const st = $('#score-text', card);
    st.addEventListener('input', () => { state.meta.score = st.innerText.trim(); });
    if ('ResizeObserver' in window) new ResizeObserver(() => scalePreview()).observe(card.parentElement);
    window.addEventListener('resize', scalePreview);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitCard());
    renderCard();
}
