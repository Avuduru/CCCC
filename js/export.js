import { state } from './state.js';
import { fitCard, CARD_SIZE } from './card.js';

// Exported cards are full-colour (4:4:4) baseline JPEGs at this quality.
// X/Twitter passes such JPEGs through untouched, while it re-saves PNGs at
// ~q85 with halved colour resolution (tested Nov 2026). Browsers' own JPEG
// encoders halve colour resolution, so we use the vendored MozJPEG encoder.
const JPEG_QUALITY = 92;

// Manual-mode defaults that must never reach an exported image.
const MANUAL_PLACEHOLDERS = ['التصنيف 1', 'التصنيف 2', 'التصنيف 3', 'المدة/عدد الحلقات'];
const MANUAL_SYNOPSIS_PLACEHOLDER = 'اكتب النبذة هنا...';
const MANUAL_TITLE_PLACEHOLDER = 'اكتب العنوان هنا';

// Placeholders js/ui.js shows while a synopsis is still being fetched or translated.
const SYNOPSIS_LOADING = ['جاري التحميل...', 'جاري الترجمة...'];
const SYNOPSIS_WAIT_MS = 8000;
const isSynopsisLoading = () => SYNOPSIS_LOADING.includes((state.meta.synopsis || '').trim());

// Export pressed before the synopsis arrived: wait for it (up to 8s), so the
// image gets the real text rather than "جاري التحميل...".
async function waitForSynopsis() {
    const start = Date.now();
    while (isSynopsisLoading() && Date.now() - start < SYNOPSIS_WAIT_MS) {
        await new Promise(r => setTimeout(r, 150));
    }
}

// If it still hasn't arrived, the card is exported without a synopsis.
function stripLoadingText(clone) {
    const syn = clone.querySelector('#synopsis-text');
    if (syn && SYNOPSIS_LOADING.includes((syn.dataset.full || syn.textContent).trim())) {
        syn.textContent = ''; syn.dataset.full = '';
    }
}

// The pills are rebuilt by fitCard from data-genres / data-stats, so the
// placeholders are removed there; the synopsis keeps its full text in data-full.
function stripManualPlaceholders(clone) {
    clone.querySelectorAll('.upload-overlay').forEach(el => el.remove());
    if (state.type !== 'manual') return;
    const g = clone.querySelector('#genre-text');
    if (g) {
        const keep = (list) => list.filter(t => !MANUAL_PLACEHOLDERS.includes(t.trim()));
        g.dataset.genres = JSON.stringify(keep(JSON.parse(g.dataset.genres || '[]')));
        g.dataset.stats = JSON.stringify(keep(JSON.parse(g.dataset.stats || '[]')));
    }
    const score = clone.querySelector('#score-text');
    const badge = clone.querySelector('#score-badge');
    const s = score ? score.textContent.trim() : '';
    if (badge && (!s || s === '0.0' || s === '0')) badge.classList.add('hidden');
    const title = clone.querySelector('#title-text');
    if (title && (title.dataset.full || title.textContent).trim() === MANUAL_TITLE_PLACEHOLDER) {
        title.textContent = ''; title.dataset.full = '';
    }
    const syn = clone.querySelector('#synopsis-text');
    if (syn && (syn.dataset.full || syn.textContent).trim() === MANUAL_SYNOPSIS_PLACEHOLDER) {
        syn.textContent = ''; syn.dataset.full = '';
    }
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

        fetch('proxy.php?type=log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content_id: contentId,
                content_type: state.type,
                title: state.meta.title,
                ratings: state.ratings,
                badges: state.badges,
                classifier: state.classifier.name || '',
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

// Shared render pipeline: the card is already laid out at export size, so the
// clone only drops the preview's scale transform, re-runs the same fits, and
// is drawn by html2canvas at 1:1 (1920×1080 or 1200×1500, never downscaled).
async function renderCanvas(originalCanvas) {
    await waitForSynopsis();
    // Read the layout after the wait: the card may have re-rendered meanwhile.
    const size = originalCanvas.dataset.layout === 'h' ? CARD_SIZE.h : CARD_SIZE.v;

    const clone = originalCanvas.cloneNode(true);
    clone.removeAttribute('id');
    clone.style.transform = 'none';
    clone.style.left = '0px';
    clone.style.top = '0px';
    const exportContainer = document.createElement('div');
    exportContainer.style.cssText =
        `position:fixed;left:-10000px;top:0;z-index:-1;width:${size.w}px;height:${size.h}px;overflow:hidden`;
    exportContainer.appendChild(clone);
    document.body.appendChild(exportContainer);

    try {
        // Remove contenteditable: iOS uses a different rendering path for editable
        // elements that can break Arabic contextual letter shaping in html2canvas.
        clone.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));

        // Wait for fonts. On iOS, document.fonts.ready can resolve from cache before
        // the faces are applied to a new off-screen node, so load each one used.
        await document.fonts.ready;
        await Promise.all([
            '700 120px Handjet', '600 36px Handjet', '400 40px Handjet',
            '400 28px Silkscreen', '700 22px "JetBrains Mono"',
        ].map(f => document.fonts.load(f).catch(() => {})));
        // Two rAF passes guarantee a full layout+paint cycle on the off-screen clone.
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        // Extra buffer for slower iOS devices
        await new Promise(r => setTimeout(r, 300));

        stripManualPlaceholders(clone);
        stripLoadingText(clone);
        fitCard(clone);

        // iOS: WebKit returns phantom extra rects from Range.getClientRects() for
        // Arabic text at non-zero offsets within a text node. html2canvas treats
        // >1 rects as a line-wrap and falls back to per-grapheme rendering — one
        // fillText() per character — so each letter renders in isolated form.
        // Patch getClientRects inside h2c's iframe via onclone: return only the
        // first non-zero-width rect (the real word position), suppressing phantoms.
        const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

        return await html2canvas(clone, {
            backgroundColor: '#0e1014',
            scale: 1,
            useCORS: true,
            allowTaint: true,
            logging: false,
            width: size.w,
            height: size.h,
            windowWidth: size.w,
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
