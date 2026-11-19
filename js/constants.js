import { EN } from './i18n.js';

// label: Arabic, en: English. `icon` is the Arabic icon file name (assets/icons/);
// the English icons are named by id (assets/icons/en/<id><level>.png).
const RAW = {
    Mawjoodat: [
        { id: 'kufr', label: 'كفريات', en: 'Blasphemy', icon: 'كفريات' },
        { id: 'sex', label: 'جنس', en: 'Sexual content', icon: 'جنس' },
        { id: 'nudity', label: 'تعري', en: 'Nudity', icon: 'تعري' },
        { id: 'vices', label: 'مفاسد', en: 'Vices', icon: 'مفاسد' },
        { id: 'magic', label: 'سحر', en: 'Magic', icon: 'سحر' },
        { id: 'lgbt', label: 'شذوذ', en: 'LGBTQ+ themes', icon: 'شذوذ' },
        { id: 'gore', label: 'صادم', en: 'Disturbing', icon: 'صادم' },
        // Game only items
        { id: 'addiction', label: 'إدمانيات', en: 'Addictive design', type: 'game_only', icon: 'إدمانيّات' },
        { id: 'lootbox', label: 'قمار', en: 'Gambling', type: 'game_only', icon: 'قمار' },
        { id: 'p2w', label: 'تبذير', en: 'Pay-to-win', type: 'game_only', icon: 'تبذير' },
    ],
    Mustathniyat: [
        { id: 'nomusic', label: 'لا موسيقى', en: 'No music', icon: 'موسيقى' },
        { id: 'noprofanity', label: 'لا ألفاظ نابية', en: 'No profanity', icon: 'ألفاظ نابية' },
        { id: 'noaffairs', label: 'لا علاقات حب', en: 'No dating/affairs', icon: 'علاقات حب' }
    ]
};

// On the English site every label reads in English
const localize = (c) => (EN ? { ...c, label: c.en } : c);
export const CATEGORIES = {
    Mawjoodat: RAW.Mawjoodat.map(localize),
    Mustathniyat: RAW.Mustathniyat.map(localize),
};

// Card sticker for a content flag at level 1–3, or an exception badge (level 0)
export function iconSrc(cat, level) {
    // ?v= makes the CDN cache them like every other versioned file (without it each one went
    // to the server, ~1 s apiece on a first visit to /en). Bump it when the icons change.
    if (EN) return level ? `/assets/icons/en/${cat.id}${level}.png?v=2` : `/assets/icons/en/${cat.id}.png?v=2`;
    return `assets/icons/${cat.icon}${level}.png?v=2`;
}
