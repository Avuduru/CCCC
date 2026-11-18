// Interface language. The page itself decides: the English pages (lang/en/*.html,
// served at /en) have <html lang="en">, the Arabic ones lang="ar". Every string the
// scripts put on screen comes from here, so both languages share one code path.
// Page text written in the HTML lives in the HTML files themselves.
export const LANG = document.documentElement.lang === 'en' ? 'en' : 'ar';
export const EN = LANG === 'en';

const STRINGS = {
    ar: {
        'card.default.title': 'عنوان العمل',
        'card.default.genre': 'نوع العمل',
        'card.loading': 'جاري التحميل...',
        'card.translating': 'جاري الترجمة...',
        'card.book_published': 'نُشر عام {year}',
        'manual.ph.title': 'اكتب العنوان هنا',
        'manual.ph.synopsis': 'اكتب نبذة قصيرة…',
        'manual.ph.stats': 'المدة',
        'manual.ph.genres': ['النوع 1', 'النوع 2', 'النوع 3'],
        'manual.image.upload': 'رفع صورة',
        'manual.image.change': 'تغيير الصورة',
        'ratings.title.manual': '<span class="label-white">المحتوى</span>',
        'ratings.title.type': '<span class="label-white">محتوى</span> <span class="label-green">ال{type}</span>',
        'ratings.level.group': 'درجة {category}',
        'level.3': 'عابر', 'level.2': 'متكرر', 'level.1': 'أساسي',
        'search.no_results': 'لا توجد نتائج',
        'preview.ready': '{ratio} · جاهزة للتصدير',
        'preview.title': 'معاينة البطاقة',
        'preview.close': 'إغلاق المعاينة',
        'actions.export': 'تصدير',
        'actions.copy': 'نسخ',
        'actions.exporting': 'جاري التصدير...',
        'actions.error': 'تعذر التصدير',
        'actions.copying': 'جاري النسخ...',
        'actions.copied': 'تم النسخ ✓',
        'actions.copy_failed': 'فشل النسخ',
        'export_popup.done': 'تم',
        'export_popup.title': 'بطاقتك جاهزة للمشاركة',
        'export_popup.share': 'مشاركة',
        'export_popup.hold_to_save': 'لحفظ الصورة، اضغط عليها باستمرار',
        'export_popup.or_hold_to_save': 'أو احفظ الصورة بالضغط عليها باستمرار',
        'guide.section_fallback': 'القسم {n}',
        'list.sep': '، ',
        // Start panel: the card before a work is picked
        'intro.title': 'ابدأ بعمل تعرفه',
        'intro.tagline': 'صنّف الأعمال بحسب ما تحتويه<br>لا بحسب رقم عمري',
        'intro.steps': [
            ['اختر النوع وابحث عن العمل', 'أنمي · مانجا · فيلم · مسلسل · لعبة · كتاب'],
            ['أضف ما يحتويه وحدّد درجته', 'وأشِر إلى ما يخلو منه'],
            ['صدّر البطاقة وشاركها', 'بالعرض أو بالطول، باسمك وتقييمك'],
        ],
        'intro.levels': 'الدرجات:',
    },
    en: {
        'card.default.title': 'Title',
        'card.default.genre': 'Genre',
        'card.loading': 'Loading…',
        'card.translating': 'Translating…',
        'card.book_published': 'Published {year}',
        'manual.ph.title': 'Type the title',
        'manual.ph.synopsis': 'Write a short synopsis…',
        'manual.ph.stats': 'Length',
        'manual.ph.genres': ['Genre 1', 'Genre 2', 'Genre 3'],
        'manual.image.upload': 'Upload image',
        'manual.image.change': 'Change image',
        'ratings.title.manual': '<span class="label-white">Content</span>',
        'ratings.title.type': '<span class="label-green">{type}</span> <span class="label-white">content</span>',
        'ratings.level.group': '{category} level',
        'level.3': 'Passing', 'level.2': 'Recurring', 'level.1': 'Core',
        'search.no_results': 'No results',
        'preview.ready': '{ratio} · ready to export',
        'preview.title': 'Card preview',
        'preview.close': 'Close preview',
        'actions.export': 'Export',
        'actions.copy': 'Copy',
        'actions.exporting': 'Exporting…',
        'actions.error': 'Export failed',
        'actions.copying': 'Copying…',
        'actions.copied': 'Copied ✓',
        'actions.copy_failed': 'Copy failed',
        'export_popup.done': 'Done',
        'export_popup.title': 'Your card is ready to share',
        'export_popup.share': 'Share',
        'export_popup.hold_to_save': 'Press and hold the image to save it',
        'export_popup.or_hold_to_save': 'Or press and hold the image to save it',
        'guide.section_fallback': 'Section {n}',
        'list.sep': ', ',
        'intro.title': 'Start with a work you know',
        'intro.tagline': 'Rate works by what they contain,<br>not by age',
        'intro.steps': [
            ['Pick a type and search for a title', 'Anime · Manga · Movie · TV · Game · Book'],
            ['Add what it contains and set each level', "And mark what it's free of"],
            ['Export the card and share it', 'Landscape or portrait, with your name and score'],
        ],
        'intro.levels': 'Levels:',
    },
};

// t('key') or t('key', { name: value }) — fills {name} placeholders
export function t(key, vars) {
    let s = STRINGS[LANG][key];
    if (s === undefined) s = STRINGS.ar[key];
    if (typeof s !== 'string' || !vars) return s;
    return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

// Every value a placeholder can have in either language, e.g. both "Loading…"
// texts, so text saved under one language is still recognised.
export const allValues = (key) => [STRINGS.ar[key], STRINGS.en[key]];

// "24 episodes" / "24 حلقة" for the length pill on the card.
const UNITS = {
    ar: {
        episode: { s1: 'حلقة واحدة', s2: 'حلقتان', p3_10: 'حلقات', p11: 'حلقة' },
        chapter: { s1: 'فصل واحد', s2: 'فصلان', p3_10: 'فصول', p11: 'فصل' },
        volume:  { s1: 'مجلد واحد', s2: 'مجلدان', p3_10: 'مجلدات', p11: 'مجلد' },
        minute:  { s1: 'دقيقة واحدة', s2: 'دقيقتان', p3_10: 'دقائق', p11: 'دقيقة' },
        hour:    { s1: 'ساعة واحدة', s2: 'ساعتان', p3_10: 'ساعات', p11: 'ساعة' },
        page:    { s1: 'صفحة واحدة', s2: 'صفحتان', p3_10: 'صفحات', p11: 'صفحة' },
    },
    en: {
        episode: ['episode', 'episodes'],
        chapter: ['chapter', 'chapters'],
        volume:  ['volume', 'volumes'],
        minute:  ['min', 'min'],
        hour:    ['hour', 'hours'],
        page:    ['page', 'pages'],
    },
};

export function formatCount(count, unit) {
    const num = parseFloat(count);
    if (!num || isNaN(num)) return '';
    if (EN) {
        const w = UNITS.en[unit];
        return w ? `${num} ${num === 1 ? w[0] : w[1]}` : `${num}`;
    }
    // Arabic: 1 and 2 have their own words, 3–10 take the plural, 11+ the singular
    const w = UNITS.ar[unit];
    if (!w) return `${num}`;
    if (num % 1 !== 0) return `${num} ${w.p11}`;
    if (num === 1) return w.s1;
    if (num === 2) return w.s2;
    const lastTwo = num % 100;
    if (lastTwo >= 3 && lastTwo <= 10) return `${num} ${w.p3_10}`;
    return `${num} ${w.p11}`;
}
