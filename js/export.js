import { state } from './state.js';
import { adjustVerticalPositions, fitGenreRow } from './ui.js';

// Exported cards are full-colour (4:4:4) baseline JPEGs at this quality.
// X/Twitter passes such JPEGs through untouched, while it re-saves PNGs at
// ~q85 with halved colour resolution (tested Nov 2026). Browsers' own JPEG
// encoders halve colour resolution, so we use the vendored MozJPEG encoder.
const JPEG_QUALITY = 92;

// Manual-mode defaults that must never reach an exported image.
const MANUAL_PLACEHOLDERS = ['التصنيف 1', 'التصنيف 2', 'التصنيف 3', 'المدة/عدد الحلقات'];
const MANUAL_SYNOPSIS_PLACEHOLDER = 'اكتب النبذة هنا...';

function lineHeightOf(el) {
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight);
    return isNaN(lh) ? parseFloat(cs.fontSize) * 1.15 : lh;
}

// Shorten `el`'s text until fits() is true, cutting at a word boundary and
// adding "…". Falls back to a character cut when a single word is too long.
function truncateToFit(el, fits) {
    if (fits()) return;
    const original = el.innerText;
    const parts = original.split(/(\s+)/);          // words and the spaces between them
    const setWords = (n) => { el.innerText = parts.slice(0, n).join('').trimEnd() + '…'; };
    let lo = 0, hi = parts.length;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        setWords(mid);
        if (fits()) lo = mid; else hi = mid;
    }
    if (lo > 0) { setWords(lo); return; }
    // Not even the first word fits: cut by characters.
    let clo = 0, chi = original.length;
    while (chi - clo > 1) {
        const mid = (clo + chi) >> 1;
        el.innerText = original.slice(0, mid) + '…';
        if (fits()) clo = mid; else chi = mid;
    }
    el.innerText = original.slice(0, clo) + '…';
}

// The preview decides title size at preview scale; re-decide at export scale.
function fitTitleInClone(clone) {
    const h2 = clone.querySelector('#title-text');
    if (!h2 || !h2.innerText.trim()) return;
    const twoLineClass = clone.classList.contains('vertical') ? 'has-2-line-title' : 'horizontal-has-2-line-title';
    clone.classList.remove('has-2-line-title', 'horizontal-has-2-line-title');
    h2.classList.remove('title-scale-1', 'title-scale-2', 'title-scale-3');
    if (h2.scrollHeight > lineHeightOf(h2) * 1.5) clone.classList.add(twoLineClass);
    // Max two lines (export CSS: max-height 2.2em); cut at a word with "…".
    const maxH = parseFloat(getComputedStyle(h2).fontSize) * 2.2;
    truncateToFit(h2, () => h2.scrollHeight <= maxH + 1);
}

function fitSynopsisInClone(clone) {
    const el = clone.querySelector('#synopsis-text');
    const wrapper = el ? el.parentElement : null;
    if (!el || !wrapper || !el.innerText.trim()) return;
    const vertical = clone.classList.contains('vertical');
    const manual = !vertical && state.synopsisSize && state.synopsisSize !== 'auto';
    if (!manual) {
        el.classList.remove('scale-medium', 'scale-heavy', 'scale-extreme', 'manual-size-sm', 'manual-size-md', 'manual-size-lg', 'manual-size-xl');
        for (const cls of ['scale-medium', 'scale-heavy', 'scale-extreme']) {
            if (el.scrollHeight <= wrapper.clientHeight) break;
            el.classList.remove('scale-medium', 'scale-heavy', 'scale-extreme');
            el.classList.add(cls);
        }
    }
    // Still too long: end on the last whole word that fits, with "…".
    truncateToFit(el, () => el.scrollHeight <= wrapper.clientHeight + 1);
}

// The classifier pill may never be wider than the poster above it.
function fitWatermarkInClone(clone) {
    const vertical = clone.classList.contains('vertical');
    const wm = clone.querySelector(vertical ? '.modern-watermark.vertical-only' : '.modern-watermark.horizontal-only');
    const poster = clone.querySelector('.poster-container');
    if (!wm || wm.classList.contains('hidden') || !poster) return;
    const name = wm.querySelector('.name-span');
    const maxW = poster.getBoundingClientRect().width;
    if (name) truncateToFit(name, () => wm.getBoundingClientRect().width <= maxW + 1);
}

function stripManualPlaceholders(clone) {
    clone.querySelectorAll('.upload-overlay').forEach(el => el.remove());
    if (state.type !== 'manual') return;
    clone.querySelectorAll('#genre-text .genre-pill').forEach(p => {
        if (MANUAL_PLACEHOLDERS.includes(p.innerText.trim())) p.remove();
    });
    const score = clone.querySelector('#score-text');
    const badge = clone.querySelector('#score-badge');
    const s = score ? score.innerText.trim() : '';
    if (badge && (!s || s === '0.0' || s === '0')) badge.classList.add('hidden');
    const syn = clone.querySelector('#synopsis-text');
    if (syn && syn.innerText.trim() === MANUAL_SYNOPSIS_PLACEHOLDER) syn.innerText = '';
}

function logClassification(action) {
    try {
        // Manual entries have no catalogue ID — key them by title so different works don't merge.
        // Searchable types with no selected item (placeholder card) are not logged at all.
        let contentId = state.meta.id ? String(state.meta.id) : '';
        if (!contentId && state.type === 'manual') {
            const t = (state.meta.title || '').trim().toLowerCase();
            if (t && t !== 'اكتب العنوان هنا') contentId = `manual:${t}`;
        }
        if (!contentId) return;

        const reviewerInput = document.getElementById('reviewer-name-input');
        fetch('proxy.php?type=log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content_id: contentId,
                content_type: state.type,
                title: state.meta.title,
                ratings: state.ratings,
                badges: state.badges,
                classifier: reviewerInput ? reviewerInput.value : '',
                orientation: state.orientation,
                action: action
            })
        }).catch(() => {});
    } catch (e) {}
}

function getFilename(ext) {
    let base = state.meta.id
        ? String(state.meta.id)
        : (state.meta.title ? state.meta.title.trim() : 'Card');
    base = base.replace(/[\n\r]/g, ' ').replace(/[\/\\?%*:|"<>]/g, '-');
    return `CCCC-${base}.${ext}`;
}

function downloadLink(url, filename) {
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.style.display = 'none';
    document.body.appendChild(link);
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    setTimeout(() => { if (document.body.contains(link)) document.body.removeChild(link); }, 2000);
}

// Shared render pipeline: clone → wait for fonts → fit at export size → html2canvas.
// Resolves to the full-size canvas (1920×1080 or 1200×1500); never downscaled.
async function renderCanvas(originalCanvas) {
    const isVertical = originalCanvas.classList.contains('vertical');
    const exportWidth = isVertical ? 1200 : 1920;

    const clone = originalCanvas.cloneNode(true);
    const exportContainer = document.createElement('div');
    exportContainer.style.cssText =
        `position:fixed;left:-9999px;top:0;z-index:-1;width:${exportWidth}px`;
    clone.classList.add('export-mode');
    exportContainer.appendChild(clone);
    document.body.appendChild(exportContainer);

    try {
        // Copy canvas bitmap (cloneNode does not copy <canvas> pixel data)
        const originalBg = originalCanvas.querySelector('#poster-bg');
        const clonedBg   = clone.querySelector('#poster-bg');
        if (originalBg && clonedBg) {
            clonedBg.width  = originalBg.width;
            clonedBg.height = originalBg.height;
            clonedBg.getContext('2d').drawImage(originalBg, 0, 0);
        }

        // Remove contenteditable: iOS uses a different rendering path for editable
        // elements that can break Arabic contextual letter shaping in html2canvas.
        clone.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));

        // Wait for CSS font loading API to settle
        await document.fonts.ready;
        // Force-load the exact Handjet weight/size instances used in card text.
        // On iOS, document.fonts.ready resolves immediately from cache but the
        // font hasn't been applied+shaped in the newly created off-screen clone yet.
        await document.fonts.load('900 106px Handjet');
        await document.fonts.load('400 40px Handjet');
        // Two rAF passes guarantee a full layout+paint cycle on the off-screen clone.
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        // Extra buffer for slower iOS devices
        await new Promise(r => setTimeout(r, 300));

        stripManualPlaceholders(clone);
        fitTitleInClone(clone);
        const row = clone.querySelector('.genre-row');
        if (isVertical && row) fitGenreRow(row);
        fitSynopsisInClone(clone);
        fitWatermarkInClone(clone);
        adjustVerticalPositions(clone);

        // iOS: WebKit returns phantom extra rects from Range.getClientRects() for
        // Arabic text at non-zero offsets within a text node. html2canvas treats
        // >1 rects as a line-wrap and falls back to per-grapheme rendering — one
        // fillText() per character — so each letter renders in isolated form.
        // Patch getClientRects inside h2c's iframe via onclone: return only the
        // first non-zero-width rect (the real word position), suppressing phantoms.
        const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

        return await html2canvas(clone, {
            backgroundColor: null,
            scale: 1,
            useCORS: true,
            allowTaint: true,
            logging: false,
            width: exportWidth,
            height: clone.offsetHeight,
            windowWidth: exportWidth,
            onclone: isIOS ? (_doc) => {
                const FrameRange = _doc.defaultView && _doc.defaultView.Range;
                if (!FrameRange) return;
                const orig = FrameRange.prototype.getClientRects;
                FrameRange.prototype.getClientRects = function () {
                    const rects = orig.call(this);
                    if (rects.length > 1 && /[؀-ۿ]/.test(this.toString())) {
                        const real = Array.from(rects).find(r => r.width > 0) || rects[0];
                        return { length: 1, 0: real, item: (i) => i === 0 ? real : null };
                    }
                    return rects;
                };
            } : undefined,
        });
    } finally {
        document.body.removeChild(exportContainer);
    }
}

function canvasToBlob(canvas, type, quality) {
    return new Promise(r => canvas.toBlob(r, type, quality));
}

// Full-colour baseline JPEG via the vendored MozJPEG encoder (loaded on first export).
// Fallback: the browser's own encoder at maximum quality, then PNG.
async function canvasToJpeg(canvas) {
    try {
        const { default: encode } = await import('./vendor/jsquash-jpeg/encode.js');
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        const buf = await encode(data, {
            quality: JPEG_QUALITY,
            progressive: false,
            optimize_coding: true,
            auto_subsample: false,
            chroma_subsample: 1,     // 1 = no chroma subsampling (4:4:4)
        });
        return { blob: new Blob([buf], { type: 'image/jpeg' }), ext: 'jpg' };
    } catch (e) {
        console.warn('JPEG encoder unavailable, using browser encoder:', e);
        const jpeg = await canvasToBlob(canvas, 'image/jpeg', 1.0);
        if (jpeg) return { blob: jpeg, ext: 'jpg' };
        return { blob: await canvasToBlob(canvas, 'image/png'), ext: 'png' };
    }
}

function showExportModal(url, file) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '999999';

    const content = document.createElement('div');
    content.className = 'modal-content modal-slide-up';
    content.style.maxWidth = '90vw';
    content.style.width = 'auto';
    content.style.padding = '0';
    content.style.overflow = 'hidden';
    content.style.background = 'var(--ink-2)';

    const header = document.createElement('header');
    header.className = 'modal-header';
    header.style.borderBottom = 'none';
    header.style.padding = '15px 20px';
    header.style.background = 'var(--ink-3)';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'modal-title-wrap';
    titleWrap.innerHTML = `<span class="kicker"><span class="kicker-dot" style="background:#2ecc71"></span>تم</span><h2 style="font-size: 22px;">بطاقتك جاهزة للمشاركة</h2>`;

    const actions = document.createElement('div');
    actions.className = 'modal-header-actions';

    const close = () => { if (document.body.contains(overlay)) document.body.removeChild(overlay); URL.revokeObjectURL(url); };
    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.innerText = '×';
    closeBtn.onclick = close;

    actions.appendChild(closeBtn);
    header.appendChild(titleWrap);
    header.appendChild(actions);

    const body = document.createElement('div');
    body.className = 'modal-body';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.alignItems = 'center';
    body.style.gap = '15px';
    body.style.padding = '0 20px 20px 20px';

    // Share hands the actual JPEG file to X, WhatsApp, Photos… (no clipboard re-encoding).
    // It runs on its own tap, so the browser's user-gesture requirement is always met.
    const canShare = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
    if (canShare) {
        const shareBtn = document.createElement('button');
        shareBtn.type = 'button';
        shareBtn.className = 'share-btn';
        shareBtn.innerText = 'مشاركة';
        shareBtn.onclick = async () => {
            try {
                await navigator.share({ files: [file], title: state.meta.title || 'CCCC' });
                logClassification('export');
            } catch (e) {
                if (e && e.name !== 'AbortError') console.error('Share failed:', e);
            }
        };
        body.appendChild(shareBtn);
    }

    const instructions = document.createElement('p');
    instructions.innerText = canShare ? 'أو اضغط مطولاً على الصورة لحفظها' : 'اضغط مطولاً على الصورة لحفظها';
    instructions.style.color = 'var(--text-dim)';
    instructions.style.fontSize = '14px';
    instructions.style.margin = '0';

    const img = document.createElement('img');
    img.src = url;
    img.style.maxWidth = '100%';
    img.style.maxHeight = '65vh';
    img.style.objectFit = 'contain';
    img.style.borderRadius = '6px';
    img.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';

    body.appendChild(instructions);
    body.appendChild(img);

    content.appendChild(header);
    content.appendChild(body);
    overlay.appendChild(content);

    document.body.appendChild(overlay);
}

export function handleExport() {
    const originalCanvas = document.getElementById('preview-canvas');
    const exportBtn = document.getElementById('export-btn');
    exportBtn.innerText = 'جاري التصدير...';

    // Truly robust check for any mobile or tablet device (catches modern iPads disguised as Macs)
    const isMobileOrTablet = /Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent) ||
                             (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    renderCanvas(originalCanvas)
        .then(canvasToJpeg)
        .then(({ blob, ext }) => {
            if (!blob) { exportBtn.innerText = 'ERROR'; return; }

            const filename = getFilename(ext);
            const url = URL.createObjectURL(blob);

            if (isMobileOrTablet) {
                // iPhone, iPad and Android: the same popup, with a Share button inside it
                const file = new File([blob], filename, { type: blob.type });
                showExportModal(url, file);
                logClassification('export');
            } else {
                // Desktop PCs and Macs get instant file downloads
                downloadLink(url, filename);
                logClassification('export');
                setTimeout(() => URL.revokeObjectURL(url), 2000);
            }
        })
        .catch(err => {
            console.error('Export failed:', err);
            exportBtn.innerText = 'ERROR';
        })
        .finally(() => {
            setTimeout(() => { exportBtn.innerText = 'تصديـر'; }, 2000);
        });
}

export function handleCopyToClipboard() {
    const originalCanvas = document.getElementById('preview-canvas');
    const copyBtn = document.getElementById('copy-btn');
    if (!copyBtn) return;

    const originalText = copyBtn.innerText;
    copyBtn.innerText = 'جاري النسخ...';

    // iOS Safari requires navigator.clipboard.write() to be called SYNCHRONOUSLY
    // within a user gesture — if we await async work first, the gesture trust
    // expires and Safari throws a NotAllowedError.
    // The fix: call clipboard.write() immediately (synchronous), passing a
    // Promise<Blob> as the ClipboardItem value. Safari 13.4+ supports this pattern.
    // Clipboards only accept PNG images, so Copy stays PNG (full size).
    const blobPromise = renderCanvas(originalCanvas).then(c => canvasToBlob(c, 'image/png'));

    navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blobPromise })
    ])
    .then(() => {
        logClassification('copy');
        copyBtn.innerText = 'تم النسخ ✓';
    })
    .catch(err => {
        console.error('Clipboard write failed:', err);
        copyBtn.innerText = 'فشل النسخ';
    })
    .finally(() => {
        setTimeout(() => { copyBtn.innerText = originalText; }, 2000);
    });
}
