// State
import { t } from './i18n.js';

export const state = {
    type: 'anime', // default
    orientation: 'horizontal', // 'horizontal' or 'vertical'
    ratings: {},   // { kufr: 2 }
    badges: {},    // { nomusic: true }
    meta: {
        title: t('card.default.title'),
        year: '2023',
        poster: null,   // tall cover/poster (2:3)
        wide: '',       // wide art (16:9) for the vertical band; '' → A-style vertical layout
        genre: t('card.default.genre'),
        synopsis: '',
        score: '',
        stats: '',
        imgPos: 'center'  // manual only: which part of the image shows ('top' | 'center' | 'bottom')
    },
    classifier: {
        name: '',
        rating: ''      // classifier's own rating out of 10 (card only)
    }
};

export function updateState(u) {
    Object.assign(state, u);
}
