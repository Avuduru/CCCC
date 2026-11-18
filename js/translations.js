import { EN } from './i18n.js';

// Genre Translation Map (English to Arabic)
export const genreTranslations = {
    // General
    'Action': 'أكشن',
    'Adventure': 'مغامرة',
    'Comedy': 'كوميديا',
    'Drama': 'دراما',
    'Fantasy': 'فانتازيا',
    'Horror': 'رعب',
    'Mystery': 'غموض',
    'Romance': 'رومانسية',
    'Sci-Fi': 'خيال علمي',
    'Science Fiction': 'خيال علمي',
    'Thriller': 'إثارة',
    'Suspense': 'تشويق',
    'Supernatural': 'خارق للطبيعة',
    'Gore': 'دموي',
    'Mythology': 'أساطير',

    // Anime/Manga Specific
    'Seinen': 'سينين',
    'Shounen': 'شونين',
    'Shoujo': 'شوجو',
    'Josei': 'جوسي',
    'Isekai': 'إيسيكاي',
    'Mecha': 'ميكا',
    'Slice of Life': 'حياة يومية',
    'Sports': 'رياضة',
    'Ecchi': 'إيتشي',
    'Harem': 'حريم',
    'School': 'مدرسي',
    'Music': 'موسيقى',
    'Psychological': 'نفسي',
    'Historical': 'تاريخي',
    'Military': 'عسكري',
    'Demons': 'شياطين',
    'Vampire': 'مصاص دماء',
    'Magic': 'سحر',
    'Police': 'شرطة',
    'Detective': 'تحقيق',
    'Martial Arts': 'فنون قتالية',
    'Samurai': 'ساموراي',
    'Space': 'فضاء',
    'Super Power': 'قوى خارقة',

    // Extended Jikan API Anime Tags
    'Avant Garde': 'تجريبي',
    'Award Winning': 'حائز على جوائز',
    'Boys Love': 'حب بين فتيان',
    'Girls Love': 'حب بين فتيات',
    'Gourmet': 'طعام وطبخ',
    'Erotica': 'إثارة جنسية',
    'Hentai': 'إباحي',
    'Adult Cast': 'شخصيات بالغة',
    'Anthropomorphic': 'حيوانات مؤنسنة',
    'CGDCT': 'فتيات لطيفات',
    'Childcare': 'رعاية أطفال',
    'Combat Sports': 'رياضات قتالية',
    'Crossdressing': 'زي الجنس الآخر',
    'Delinquents': 'جانحون',
    'Educational': 'تعليمي',
    'Gag Humor': 'دعابات',
    'High Stakes Game': 'رهانات خطيرة',
    'Idols (Female)': 'نجمات (أيدولز)',
    'Idols (Male)': 'نجوم (أيدولز)',
    'Iyashikei': 'أجواء مريحة',
    'Love Polygon': 'تشابك عاطفي',
    'Magical Sex Shift': 'تحول جنسي سحري',
    'Mahou Shoujo': 'فتاة ساحرة',
    'Medical': 'طبي',
    'Organized Crime': 'جريمة منظمة',
    'Otaku Culture': 'ثقافة الأوتاكو',
    'Parody': 'محاكاة ساخرة',
    'Performing Arts': 'فنون أداء',
    'Pets': 'حيوانات أليفة',
    'Reincarnation': 'تناسخ',
    'Reverse Harem': 'حريم عكسي',
    'Love Status Quo': 'جمود عاطفي',
    'Showbiz': 'عالم الترفيه',
    'Strategy Game': 'استراتيجية',
    'Survival': 'نجاة',
    'Team Sports': 'رياضات جماعية',
    'Time Travel': 'سفر عبر الزمن',
    'Video Game': 'لعبة فيديو',
    'Visual Arts': 'فنون بصرية',
    'Workplace': 'بيئة عمل',
    'Urban Fantasy': 'فانتازيا حضرية',
    'Villainess': 'شريرة',
    'Kids': 'أطفال',

    // Games
    'RPG': 'آر بي جي',
    'Action RPG': 'أكشن آر بي جي',
    'Shooter': 'إطلاق نار',
    'Platformer': 'منصات',
    'Strategy': 'استراتيجية',
    'Simulation': 'محاكاة',
    'Fighting': 'قتال',
    'Racing': 'سباق',
    'Puzzle': 'ألغاز',
    'Arcade': 'أركيد',
    'Indie': 'مستقل',
    'Massively Multiplayer': 'جماعي واسع',
    'Casual': 'ألعاب خفيفة',
    'Family': 'عائلي',
    'Board Games': 'ألعاب لوحية',
    'Educational': 'تعليمي',

    // Books
    'Fiction': 'أدب تخييلي',
    'Non-Fiction': 'غير روائي',
    'Biography': 'سيرة',
    'Self-Help': 'تطوير الذات',
    'Poetry': 'شعر',
    'Philosophy': 'فلسفة',

    // TV/Movies
    'Documentary': 'وثائقي',
    'Animation': 'رسوم متحركة',
    'Crime': 'جريمة',
    'War': 'حرب',
    'Western': 'رعاة البقر',
    'Musical': 'استعراضي',
    'Biography': 'سيرة',
    'History': 'تاريخ',
    'Family': 'عائلي',
    'Movie': 'فيلم',
    'TV Series': 'مسلسل',

    // TMDB TV genres
    'Action & Adventure': 'أكشن ومغامرة',
    'Sci-Fi & Fantasy': 'علمي وفانتازيا',
    'War & Politics': 'حرب وسياسة',
    'News': 'أخبار',
    'Reality': 'تلفزيون الواقع',
    'Soap': 'دراما متسلسلة',
    'Talk': 'برامج حوارية',
    'TV Movie': 'فيلم تلفزيوني',
    'Game': 'لعبة'
};

/**
 * Translate genre names to Arabic
 * @param {string} genreText - Comma-separated genre string
 * @returns {string} - Translated genre string
 */
export function translateGenres(genreText) {
    if (!genreText) return '';
    // The English site shows the sources' own genre names
    if (EN) return genreText.split(',').map(g => g.trim()).filter(Boolean).join(', ');

    // Split by comma, translate each, rejoin
    return genreText
        .split(',')
        .map(genre => {
            const trimmed = genre.trim();
            return genreTranslations[trimmed] || trimmed; // Fallback to original if not found
        })
        .join('، '); // Arabic comma
}

/**
 * Translate a synopsis to Arabic through proxy.php (Google, then MyMemory). Returns the
 * original text when no real Arabic translation comes back.
 */
// A real translation to Arabic contains Arabic letters; anything else (an upstream error
// message passed through as "translatedText") is shown and cached never.
const looksArabic = (s) => typeof s === 'string' && /[؀-ۿ]/.test(s);

// Cache key from the WHOLE text (the old key used only its first 50 characters, so two
// synopses starting alike shared one translation).
function textKey(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return `tr2_${text.length}_${(h >>> 0).toString(36)}`;
}

// Once per browser: drop the old-style cache (it may hold an error message saved as a
// translation, e.g. "QUERY LENGTH LIMIT EXCEEDED…").
try {
    if (!localStorage.getItem('tr2_migrated')) {
        Object.keys(localStorage).filter(k => k.startsWith('trans_')).forEach(k => localStorage.removeItem(k));
        localStorage.setItem('tr2_migrated', '1');
    }
} catch (e) { /* storage blocked: nothing cached anyway */ }

export async function translateText(text) {
    if (!text || text.length === 0) return text;
    // The sources write in English, so the English site uses their text as is
    if (EN) return text;

    const cacheKey = textKey(text);
    try {
        const cached = localStorage.getItem(cacheKey);
        if (looksArabic(cached)) return cached;
    } catch (e) { /* storage blocked */ }

    try {
        // Google Translate (GTX) via local proxy. The synopsis is sent base64url-encoded
        // (only A-Z a-z 0-9 _ -), so it never contains %, quotes or <> — the WAF's
        // URL-encoding / XSS / SQLi rules can't false-positive on a synopsis (e.g. "90%").
        const b64url = btoa(unescape(encodeURIComponent(text)))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const response = await fetch(`proxy.php?type=translate&q=${b64url}`);
        const data = await response.json();
        const translated = data && data.responseStatus === 200 && data.responseData ? data.responseData.translatedText : '';

        if (looksArabic(translated)) {
            try { localStorage.setItem(cacheKey, translated); } catch (e) { /* full or blocked */ }
            return translated;
        }
        return text;   // no usable translation: keep the original English
    } catch (error) {
        console.error('Translation failed:', error);
        return text; // Return original text on error
    }
}
