"""Search and link-preview tags for every page, in both languages.

    python tools/i18n/seo.py     # rewrites the <!-- SEO --> block in index.html, about.html, guide.html

Each Arabic page carries a block between <!-- SEO --> and <!-- /SEO --> in its <head>;
tools/i18n/build_en.py swaps in the English block for the /en pages. Both come from here, so
titles, descriptions, canonical URLs, hreflang, Open Graph / X cards and JSON-LD stay in step.
"""
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SITE = 'https://muhafid.com'
START, END = '<!-- SEO -->', '<!-- /SEO -->'

# path on each site (Arabic, English)
PATHS = {'index': ('/', '/en'), 'about': ('/about', '/en/about'), 'guide': ('/guide', '/en/guide')}

TEXT = {
    'ar': {
        'site': 'محافظ',
        'index': ('محافظ · التصنيف المحافظ للمحتوى الإبداعي (CCCC)',
                  'صنّف الأفلام والمسلسلات والأنمي والمانجا والألعاب والكتب بحسب ما تحتويه، لا بحسب رقم عمري، '
                  'واصنع بطاقة تصنيف جاهزة للمشاركة. مجاني ودون تسجيل.'),
        'guide': ('دليل التصنيف المحافظ: الدرجات والموجودات والمستثنيات — محافظ',
                  'كيف تصنّف عملًا: الدرجات الثلاث (أساسي ومتكرر وعابر)، '
                  'والموجودات العشر، والمستثنيات (الموسيقى والألفاظ النابية والعلاقات العاطفية).'),
        'about': ('عن المشروع — محافظ (CCCC)',
                  'التصنيف المحافظ للمحتوى الإبداعي (CCCC) أداة مفتوحة المصدر تتيح للمتابعين والمراجعين وصناع المحتوى '
                  'تصنيف الأعمال الإبداعية بحسب ما تحتويه، لا بحسب رقم عمري.'),
        'locale': 'ar_AR', 'image_alt': 'التصنيف المحافظ للمحتوى الإبداعي — muhafid.com',
    },
    'en': {
        'site': 'Muhafid',
        'index': ('Muhafid · Conservative Classification of Creative Content (CCCC)',
                  'Rate movies, TV, anime, manga, games and books by what they contain, not by age, '
                  'and make a share-ready rating card. Free, no sign-up.'),
        'guide': ('Rating guide: levels, content flags and exceptions — Muhafid',
                  'How CCCC rates a work: three levels (core, recurring, passing), ten content flags, '
                  'and exception badges for music, profanity and romance.'),
        'about': ('About — Muhafid (CCCC)',
                  'CCCC is an open-source tool that lets viewers, reviewers and creators rate creative works '
                  'by what they contain, not by age.'),
        'locale': 'en_US', 'image_alt': 'Conservative Classification of Creative Content — muhafid.com',
    },
}


def block(page, lang, indent='    '):
    t = TEXT[lang]
    title, desc = t[page]
    ar_url, en_url = (SITE + p for p in PATHS[page])
    url = ar_url if lang == 'ar' else en_url
    image = f'{SITE}/assets/og/muhafid-{lang}.jpg'
    other_locale = TEXT['en' if lang == 'ar' else 'ar']['locale']
    e = lambda s: html.escape(s, quote=True)

    if page == 'index':
        data = {'@context': 'https://schema.org', '@graph': [
            {'@type': 'WebSite', '@id': f'{SITE}/#website', 'url': f'{SITE}/', 'name': t['site'],
             'alternateName': ['Muhafid' if lang == 'ar' else 'محافظ', 'CCCC', 'Conservative Classification of Creative Content',
                               'التصنيف المحافظ للمحتوى الإبداعي'],
             'inLanguage': ['ar', 'en']},
            {'@type': 'WebApplication', 'name': title.split(' · ')[-1] if ' · ' in title else title, 'url': url,
             'description': desc, 'inLanguage': lang, 'applicationCategory': 'EntertainmentApplication',
             'operatingSystem': 'Any', 'browserRequirements': 'Requires JavaScript', 'isAccessibleForFree': True,
             'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'USD'},
             'image': image, 'isPartOf': {'@id': f'{SITE}/#website'}},
        ]}
    else:
        data = {'@context': 'https://schema.org', '@type': 'AboutPage' if page == 'about' else 'WebPage',
                'name': title, 'url': url, 'description': desc, 'inLanguage': lang,
                'isPartOf': {'@type': 'WebSite', '@id': f'{SITE}/#website', 'url': f'{SITE}/', 'name': t['site']}}

    lines = [
        START,
        f'<title>{e(title)}</title>',
        f'<meta name="description" content="{e(desc)}">',
        f'<link rel="canonical" href="{url}">',
        f'<link rel="alternate" hreflang="ar" href="{ar_url}">',
        f'<link rel="alternate" hreflang="en" href="{en_url}">',
        f'<link rel="alternate" hreflang="x-default" href="{ar_url}">',
        '<meta name="theme-color" content="#0e1014">',
        f'<meta property="og:site_name" content="{e(t["site"])}">',
        '<meta property="og:type" content="website">',
        f'<meta property="og:title" content="{e(title)}">',
        f'<meta property="og:description" content="{e(desc)}">',
        f'<meta property="og:url" content="{url}">',
        f'<meta property="og:locale" content="{t["locale"]}">',
        f'<meta property="og:locale:alternate" content="{other_locale}">',
        f'<meta property="og:image" content="{image}">',
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        f'<meta property="og:image:alt" content="{e(t["image_alt"])}">',
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{e(title)}">',
        f'<meta name="twitter:description" content="{e(desc)}">',
        f'<meta name="twitter:image" content="{image}">',
        f'<script type="application/ld+json">{json.dumps(data, ensure_ascii=False, separators=(",", ":"))}</script>',
        END,
    ]
    return ('\n' + indent).join(lines)


def replace_block(text, new):
    a, b = text.find(START), text.find(END)
    assert a != -1 and b != -1 and text.count(START) == 1, 'SEO markers missing'
    return text[:a] + new + text[b + len(END):]


def main():
    for page in ('index', 'about', 'guide'):
        p = ROOT / f'{page}.html'
        s = p.read_text(encoding='utf-8')
        s2 = replace_block(s, block(page, 'ar'))
        if s2 != s:
            p.write_text(s2, encoding='utf-8', newline='\n')
            print('updated', p.name)
    print('done')


if __name__ == '__main__':
    main()
