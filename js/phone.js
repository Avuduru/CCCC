// Phone layout helpers (phone.css does the layout; this adds the few pieces
// that need behaviour). Everything here is harmless on desktop, where
// phone.css keeps these elements hidden.
import { state } from './state.js';
import { CARD_SIZE } from './card.js';
import { t } from './i18n.js';

export function initPhone() {
    buildTypeChips();
    setupEnlarge();
    buildGuideTabs();
    setupKeyboardMode();
}

// ── Typing: give the keyboard's small screen to the field ────────────────
// With the iPhone keyboard up only ~450px is visible; the pinned card and the
// Export bar would cover the field and the search results. While a text field
// in the controls has focus, body.kb-open unpins the card and hides the bar
// (phone.css), and the field scrolls to the top so its results fit below it.
const isPhone = () => window.matchMedia('(max-width: 640px)').matches;
const isTextField = (el) => el && (el.matches('input[type="text"], input:not([type]), textarea') || el.isContentEditable);

// The block a field belongs to (its label included), scrolled into view while typing
const blockOf = (el) => el.closest('.mf-field') || el.closest('.classifier-row') || el.closest('.search-wrapper') || el;

// After the keyboard closes the card pins again over the top of the screen;
// put the field you were using just below it, so you still see what you typed
// (e.g. the search box with the title you searched for).
function keepBelowPinnedCard(el) {
    const stage = document.querySelector('.stage');
    if (!stage || !el) return;
    const gap = stage.getBoundingClientRect().bottom + 12 - el.getBoundingClientRect().top;
    if (gap > 0 || el.getBoundingClientRect().top > window.innerHeight - 140) window.scrollBy(0, -gap);
}

function setupKeyboardMode() {
    const controls = document.querySelector('.top-controls');
    if (!controls) return;
    let closeTimer = 0;
    let lastBlock = null;
    controls.addEventListener('focusin', (e) => {
        if (!isPhone() || !isTextField(e.target)) return;
        clearTimeout(closeTimer);
        document.body.classList.add('kb-open');
        lastBlock = blockOf(e.target);
        // after the keyboard has started to open, so the scroll isn't undone
        setTimeout(() => lastBlock && lastBlock.scrollIntoView({ block: 'start', behavior: 'smooth' }), 300);
    });
    controls.addEventListener('focusout', () => {
        // Wait a moment: a tap on a search result blurs the field first, and the
        // layout must not move under that tap. Moving to another field cancels this.
        clearTimeout(closeTimer);
        closeTimer = setTimeout(() => {
            if (isTextField(document.activeElement)) return;
            document.body.classList.remove('kb-open');
            const block = lastBlock;
            requestAnimationFrame(() => keepBelowPinnedCard(block));
            // iOS resizes the screen as the keyboard slides away: settle once more after
            const vv = window.visualViewport;
            if (vv) {
                const settle = () => { vv.removeEventListener('resize', settle); keepBelowPinnedCard(block); };
                vv.addEventListener('resize', settle);
                setTimeout(() => vv.removeEventListener('resize', settle), 1200);
            }
        }, 350);
    });
    // Picking a search result closes the keyboard, so the card (pinned again) is in view
    const results = document.getElementById('search-results');
    if (results) results.addEventListener('click', () => {
        if (isPhone() && document.activeElement && isTextField(document.activeElement)) document.activeElement.blur();
    });
}

// ── Content type: one tap per type instead of a dropdown ──────────────────
// Each chip just clicks the matching dropdown item, so the type-switch logic
// lives in one place (js/app.js).
function buildTypeChips() {
    const box = document.getElementById('type-chips');
    if (!box) return;
    document.querySelectorAll('#type-dropdown .dropdown-item').forEach(item => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'type-chip';
        chip.dataset.value = item.dataset.value;
        chip.textContent = item.textContent.trim();
        chip.addEventListener('click', () => item.click());
        box.appendChild(chip);
    });
    syncTypeChips();
}

export function syncTypeChips() {
    const box = document.getElementById('type-chips');
    if (!box) return;
    box.querySelectorAll('.type-chip').forEach(chip => {
        const on = chip.dataset.value === state.type;
        chip.classList.toggle('active', on);
        chip.setAttribute('aria-pressed', on);
        if (on && box.offsetParent && box.scrollWidth > box.clientWidth) {
            chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    });
}

// ── Enlarged preview: the card as large as the screen allows ─────────────
// A copy of the live card, scaled to fit, with its own Export / Copy buttons
// (the page's fixed bar lives inside the pinned preview's layer, below this sheet).
function setupEnlarge() {
    const btn = document.getElementById('preview-enlarge');
    if (!btn) return;
    btn.addEventListener('click', openPreviewSheet);
}

function openPreviewSheet() {
    const card = document.getElementById('preview-canvas');
    if (!card) return;
    const size = card.dataset.layout === 'h' ? CARD_SIZE.h : CARD_SIZE.v;

    const sheet = document.createElement('div');
    sheet.className = 'preview-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', t('preview.title'));
    sheet.innerHTML = `
        <header class="preview-sheet-head">
            <h2>${t('preview.title')}</h2>
            <button type="button" class="preview-sheet-close" aria-label="${t('preview.close')}">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 3l10 10M13 3 3 13"/></svg>
            </button>
        </header>
        <div class="preview-sheet-body"><div class="preview-sheet-card"></div>
            <span class="preview-sheet-meta" dir="ltr">${size === CARD_SIZE.h ? '16:9 · 1920 × 1080' : '4:5 · 1200 × 1500'} · JPG</span>
        </div>
        <div class="preview-sheet-actions">
            <button type="button" class="ph-export">${t('actions.export')}</button>
            <button type="button" class="ph-copy">${t('actions.copy')}</button>
        </div>`;
    // Same handlers as the page's own buttons (Copy must run inside this tap for iOS)
    sheet.querySelector('.ph-export').addEventListener('click', () => document.getElementById('export-btn').click());
    sheet.querySelector('.ph-copy').addEventListener('click', () => document.getElementById('copy-btn').click());

    const clone = card.cloneNode(true);
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    clone.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
    clone.querySelectorAll('.upload-overlay').forEach(el => el.remove());

    const holder = sheet.querySelector('.preview-sheet-card');
    holder.appendChild(clone);
    document.body.appendChild(sheet);
    document.body.style.overflow = 'hidden';

    const fit = () => {
        const body = sheet.querySelector('.preview-sheet-body');
        const availW = body.clientWidth - 32;
        const availH = body.clientHeight - 48;
        const k = Math.min(availW / size.w, availH / size.h);
        holder.style.width = Math.round(size.w * k) + 'px';
        holder.style.height = Math.round(size.h * k) + 'px';
        clone.style.left = '0px';
        clone.style.top = '0px';
        clone.style.transform = `scale(${k})`;
    };
    fit();
    window.addEventListener('resize', fit);

    const close = () => {
        window.removeEventListener('resize', fit);
        document.removeEventListener('keydown', onKey);
        sheet.remove();
        document.body.style.overflow = '';
        document.getElementById('preview-enlarge')?.focus();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    sheet.querySelector('.preview-sheet-close').addEventListener('click', close);
    sheet.querySelector('.preview-sheet-close').focus();
}

// ── Guide: tabs that jump between its three sections ─────────────────────
function buildGuideTabs() {
    const nav = document.getElementById('guide-tabs');
    const body = document.querySelector('#info-modal .modal-body');
    if (!nav || !body) return;
    const sections = Array.from(body.querySelectorAll('.modal-section'));
    const tabs = sections.map((sec, i) => {
        const h = sec.querySelector('.section-title');
        const num = h && h.querySelector('.section-num');
        const label = h ? h.textContent.replace(num ? num.textContent : '', '').trim() : t('guide.section_fallback', { n: i + 1 });
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'guide-tab';
        tab.textContent = label;
        tab.addEventListener('click', () => {
            const top = sec.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 8;
            body.scrollTo({ top, behavior: 'smooth' });
        });
        nav.appendChild(tab);
        return tab;
    });
    const mark = () => {
        if (!body.clientHeight) return;   // guide closed: nothing to measure yet
        const base = body.getBoundingClientRect().top + 48;
        let current = 0;
        sections.forEach((sec, i) => { if (sec.getBoundingClientRect().top <= base) current = i; });
        // At the very bottom the last section is current even if it is short
        if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4) current = sections.length - 1;
        tabs.forEach((t, i) => { t.classList.toggle('active', i === current); t.setAttribute('aria-current', i === current ? 'true' : 'false'); });
    };
    body.addEventListener('scroll', mark, { passive: true });
    tabs[0]?.classList.add('active');
    // Re-measure each time the guide opens
    ['open-guide-panel', 'open-info-modal'].forEach(id =>
        document.getElementById(id)?.addEventListener('click', () => requestAnimationFrame(mark)));
}
