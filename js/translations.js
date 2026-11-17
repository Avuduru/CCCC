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
 * Translate text using MyMemory API (free tier: 5000 chars/day)
 * @param {string} text - Text to translate
 * @returns {Promise<string>} - Translated text
 */
export async function translateText(text) {
    if (!text || text.length === 0) return text;

    // Check cache first
    const cacheKey = `trans_${text.substring(0, 50)}`; // Use first 50 chars as key
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        return cached;
    }

    try {
        // Google Translate (GTX) via local proxy
        const url = `proxy.php?type=translate&query=${encodeURIComponent(text)}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.responseStatus === 200 && data.responseData.translatedText) {
            const translated = data.responseData.translatedText;
            // Cache the translation
            localStorage.setItem(cacheKey, translated);
            return translated;
        }

        // Fallback to original if translation fails
        return text;
    } catch (error) {
        console.error('Translation failed:', error);
        return text; // Return original text on error
    }
}
