"""Build the English pages (lang/en/*.html, served at /en) from the Arabic ones.

    python tools/i18n/build_en.py          # writes lang/en/index.html, about.html, guide.html
    python tools/i18n/build_en.py --check  # exits 1 if the English pages are out of date

The Arabic pages are the source. Each English page is the Arabic page with:
  - <html lang="en" dir="ltr">, ltr.css and the English fonts added,
  - local paths made absolute (/style.v3.css, /assets/...), because /en/about is one level down,
  - links pointing at the English pages (/en, /en/about, /en/guide),
  - every Arabic text replaced by its English wording (Docs/i18n/strings.final.json, en_final).

Every replacement must match exactly as many times as stated, and no Arabic may be left
over except where listed (ALLOWED_ARABIC). So after an edit to an Arabic page this script
stops with the text it could not find, instead of quietly publishing a half-translated page.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seo  # noqa: E402  (titles, descriptions, canonical/hreflang, Open Graph, JSON-LD)

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'lang' / 'en'
ARABIC = re.compile(r'[؀-ۿ]')

# Arabic that belongs on the English pages: the Arabic name in the header, the link back
# to the Arabic site, and icon file names (the guide's plain icons have no text).
ALLOWED_ARABIC = [
    'التصنيف المحافظ للمحتوى الإبداعي',
    'العربية',
    'محافظ',   # the site's Arabic name, listed as an alternate name in the JSON-LD
]
ALLOWED_ARABIC_ATTR = re.compile(r'(src|href)="/assets/icons/[^"]*"')

# Shared by all three pages ----------------------------------------------------------
NAME_AR = 'التصنيف المحافظ للمحتوى الإبداعي'
NAME_EN = 'Conservative Classification of Creative Content'
FONTS_EN = ('<link href="https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700'
            '&family=JetBrains+Mono:wght@400;500;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">')

HEADER_BRAND = [
    # The small line becomes the Arabic name, the large line the English one
    (f'<div class="brand-ar">{NAME_AR}</div>', f'<div class="brand-ar">{NAME_EN}</div>'),
    ('<div class="brand-en">CONSERVATIVE CLASSIFICATION OF CREATIVE CONTENT</div>',
     f'<div class="brand-en" lang="ar" dir="rtl">{NAME_AR}</div>'),
]

GUIDE_TEXT = {
    'l1.stories': ('يتكرر المحتوى ويشكل جزءا أساسيا من القصة، بحيث يصعب فهمها عند تخطيه.',
                   'The content is central and appears frequently. Skipping it makes the overall story hard to follow.'),
    'l1.games': ('لا يمكن إتمام اللعبة دون المرور بهذا المحتوى.',
                 'You cannot finish the game without encountering this content.'),
    'l2.stories': ('يمكن تخطي المحتوى دون التأثير على فهم القصة، لكن تكرار التخطي يقطع تسلسلها.',
                   'You can skip the content and still follow the story, but frequent skipping disrupts the experience.'),
    'l2.games': ('يمكن إتمام اللعبة مع تجنب هذا المحتوى، لكن تجنبه يزيد صعوبتها ويغير التجربة.',
                 'You can finish the game while avoiding this content, but doing so makes it harder and changes the experience.'),
    'l3.stories': ('يظهر المحتوى نادرا، ويسهل تخطيه دون التأثير على فهم القصة.',
                   'The content is rare and easy to skip without losing track of the story.'),
    'l3.games': ('يمكن تجاهل المحتوى أو اتباع طرق بديلة لإتمام اللعبة.',
                 'You can ignore the content or take another route to finish the game.'),
    'kufr': ('محتوى يروج للكفر أو الإلحاد، أو يسخر من الأديان أو الذات الإلهية، أو يعرض بصورة إيجابية أو محايدة عقائد وفلسفات تخالف العقيدة الإسلامية.',
             'Content that promotes disbelief or atheism, mocks religion or God, or presents beliefs and philosophies that conflict with Islamic teachings positively or neutrally.'),
    'magic': ('قوى ورموز وتعويذات مرتبطة بالسحر والتنجيم والتنبؤ بالغيب.',
              'Powers, symbols and spells tied to sorcery, astrology and fortune-telling.'),
    'sex': ('مشاهد جنسية إيحائية أو مباشرة.', 'Suggestive or explicit sexual scenes.'),
    'nudity': ('مشاهد تتضمن تعريا كاملا أو جزئيا.', 'Full or partial nudity.'),
    'lgbt': ('عرض أو تمجيد الشذوذ، بما يشمل العلاقات المثلية والتحول الجنسي والموضوعات المرتبطة بهما.',
             'Depictions or positive portrayals of LGBTQ+ themes, including same-sex relationships and transgender identities.'),
    'gore': ('محتوى قد يسبب الانزعاج الشديد، مثل العنف الدموي والأشلاء والاغتصاب والانتحار والتعذيب والمشاهد المثيرة للاشمئزاز.',
             'Potentially distressing content, including graphic violence, gore, rape, suicide, torture and intensely disturbing imagery.'),
    'vices': ('الترويج للقمار أو تعاطي المخدرات، أو التشجيع عليهما أو تصويرهما بصورة إيجابية، إضافة إلى المشاهد المثيرة للغرائز، مثل الإيحاءات الجسدية والإغراء غير الصريح.',
              'Promoting or encouraging gambling or drug use, portraying them positively, or showing sensual scenes such as suggestive body shots or implied seduction.'),
    'addiction': ('(خاص بالألعاب) آليات تربط التقدم بالعودة اليومية المنتظمة، مثل تسجيل الدخول اليومي وسلاسل الأيام المتتالية.',
                  '(Games only) Mechanics that require regular daily returns to keep progressing, such as daily logins and streaks.'),
    'p2w': ('(خاص بالألعاب) ربط التقدم بالمال المنفق على عناصر داخل اللعبة.',
            '(Games only) Progress is tied to money spent on in-game items.'),
    'lootbox': ('(خاص بالألعاب) آليات تشجع على شراء صناديق بمحتويات عشوائية أو دفع المال مقابل سحوبات عشوائية.',
                '(Games only) Mechanics that encourage spending on loot boxes or gacha pulls with random rewards.'),
    'exceptions': ('يفترض نظام التصنيف وجود الموسيقى أو الأغاني، والألفاظ النابية، والعلاقات العاطفية خارج الزواج في العمل ما لم يشر التصنيف إلى خلاف ذلك. استخدم كل رمز من الرموز التالية فقط إذا كان العمل يخلو من المحتوى الذي يشير إليه.',
                   'For rating purposes, CCCC assumes a work contains music or songs, profanity, and romantic relationships outside marriage unless marked otherwise. Use each badge below only when the work is free of that content.'),
    'intro': ('التصنيف المحافظ للمحتوى الإبداعي (CCCC) أداة تتيح تصنيف الأعمال الإبداعية بحسب ما تحتويه، لا بحسب رقم عمري.',
              'CCCC is a tool for rating creative works by what they contain, not by age.'),
}
FLAG_NAMES = [  # (Arabic name, English name, Arabic icon file, description key)
    ('كفريات', 'Blasphemy', 'كفريات', 'kufr'),
    ('سحر', 'Magic', 'سحر', 'magic'),
    ('جنس', 'Sexual content', 'جنس', 'sex'),
    ('تعري', 'Nudity', 'تعري', 'nudity'),
    ('شذوذ', 'LGBTQ+ themes', 'شذوذ', 'lgbt'),
    ('صادم', 'Disturbing', 'صادم', 'gore'),
    ('مفاسد', 'Vices', 'مفاسد', 'vices'),
    ('إدمانيات', 'Addictive design', 'إدمانيّات', 'addiction'),
    ('تبذير', 'Pay-to-win', 'تبذير', 'p2w'),
    ('قمار', 'Gambling', 'قمار', 'lootbox'),
]
EXCEPTION_ICONS = [
    ('<img src="assets/icons/موسيقى0.png" alt="لا يحتوي على موسيقى">', '<img src="/assets/icons/en/nomusic.png" alt="No music">'),
    ('<img src="assets/icons/ألفاظ نابية0.png" alt="لا يحتوي على ألفاظ نابية">', '<img src="/assets/icons/en/noprofanity.png" alt="No profanity">'),
    ('<img src="assets/icons/علاقات حب0.png" alt="لا يحتوي على علاقات عاطفية خارج الزواج">', '<img src="/assets/icons/en/noaffairs.png" alt="No romantic relationships outside marriage">'),
]
LEVELS = [('الدرجة الأولى', 'Level 1'), ('الدرجة الثانية', 'Level 2'), ('الدرجة الثالثة', 'Level 3')]


def common_head():
    """lang/dir and ltr.css last in <head> (the SEO block is swapped in build())."""
    return [
        ('<html lang="ar" dir="rtl">', '<html lang="en" dir="ltr">', 1),
        ('</head>', '    <link rel="stylesheet" href="/ltr.css">\n</head>', 1),
    ]


# Page: the tool (index.html) ---------------------------------------------------------
def index_rules():
    r = [
        ('<link\n        href="https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&family=JetBrains+Mono:wght@400;500;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap"\n        rel="stylesheet">', FONTS_EN, 1),
        (f'<h1 class="brand-ar">{NAME_AR}</h1>', f'<h1 class="brand-ar">{NAME_EN}</h1>', 1),   # the tool page's main heading
        HEADER_BRAND[1] + (1,),
        ('<a class="status-about" href="/en" lang="en" hreflang="en">English</a>', '<a class="status-about" href="/" lang="ar" hreflang="ar">العربية</a>', 1),
        ('<a class="status-about" href="about">عن المشروع</a>', '<a class="status-about" href="/en/about">About</a>', 1),
        ('<span class="status-text">الإصدار 1.0</span>', '<span class="status-text">Version 1.0</span>', 1),
        ('<!-- Phones: the guide comes first (phone.css); desktop keeps the تنبيه box below -->', '<!-- Phones: the guide comes first (phone.css); desktop keeps the Note box below -->', 1),
        ('<span class="guide-panel-text">دليل التصنيف المحافظ</span>', '<span class="guide-panel-text">Rating guide</span>', 1),
        ('<path d="M10 3 5 8l5 5"/>', '<path d="M6 3l5 5-5 5"/>', 1),   # chevron points forward (right)
        ('<span class="kicker-dot"></span>القالب</span>', '<span class="kicker-dot"></span>Template</span>', 1),
        ('<span class="control-label">قالب البطاقة</span>', '<span class="control-label">Card layout</span>', 1),
        ('<span>بالعرض</span>', '<span>Landscape</span>', 1),
        ('<span>بالطول</span>', '<span>Portrait</span>', 1),
        ('<span class="control-label">نوع المحتوى</span>', '<span class="control-label">Content type</span>', 1),
        ('aria-label="نوع المحتوى"', 'aria-label="Content type"', 1),
        ('<span>أنمي</span>', '<span>Anime</span>', 1),
        ('data-value="anime">أنمي<', 'data-value="anime">Anime<', 1),
        ('data-value="manga">مانجا<', 'data-value="manga">Manga<', 1),
        ('data-value="movie">فيلم<', 'data-value="movie">Movie<', 1),
        ('data-value="tv">مسلسل<', 'data-value="tv">TV series<', 1),
        ('data-value="game">لعبة<', 'data-value="game">Game<', 1),
        ('data-value="book">كتاب<', 'data-value="book">Book<', 1),
        ('data-value="manual">يدوي<', 'data-value="manual">Manual<', 1),
        ('<span class="kicker-dot"></span>العمل</span>', '<span class="kicker-dot"></span>Work</span>', 1),
        ('placeholder="ابحث عن عمل…"', 'placeholder="Search for a title…"', 1),
        ('<span class="search-hint">إدخال</span>', '<span class="search-hint">Enter</span>', 1),
        ('<!-- Each box has its label above it ("your name", "your score"), so no\n                             separate heading is needed; the card itself still says "المُصنّف:" -->',
         '<!-- Each box has its label above it ("your name", "your score"), so no\n                             separate heading is needed; the card itself still says "Rated by:" -->', 1),
        ('<span class="cl-label">اسمك <em>اختياري</em></span>', '<span class="cl-label">Your name <em>optional</em></span>', 1),
        ('placeholder="اسمك…"', 'placeholder="Name or @handle"', 1),
        ('<span class="cl-label">تقييمك <em>اختياري</em></span>', '<span class="cl-label">Your score <em>optional</em></span>', 1),
        ('title="تقييمك من 10 (اختياري)"', 'title="Your score out of 10 (optional)"', 1),
        ('aria-label="تقييمك من 10"', 'aria-label="Your score out of 10"', 1),
        ('<!-- Manual mode: the card\'s fields as a form (shown only for "يدوي") -->', '<!-- Manual mode: the card\'s fields as a form (shown only for "Manual") -->', 1),
        ('<span class="kicker-dot"></span>بيانات العمل</span>', '<span class="kicker-dot"></span>Work details</span>', 1),
        ('<span class="mf-label">العنوان</span>', '<span class="mf-label">Title</span>', 1),
        ('placeholder="اكتب العنوان هنا"', 'placeholder="Type the title"', 1),
        ('<span class="mf-label">الأنواع <em>افصل بينها بفواصل</em></span>', '<span class="mf-label">Genres <em>separate with commas</em></span>', 1),
        ('placeholder="دراما، فانتازيا، مغامرة"', 'placeholder="Drama, Fantasy, Adventure"', 1),
        ('<span class="mf-label">المدة <em>حلقات، دقائق، صفحات أو ساعات</em></span>', '<span class="mf-label">Length <em>episodes, minutes, pages or hours</em></span>', 1),
        ('placeholder="مثال: 24 حلقة · 120 دقيقة · 300 صفحة · 40 ساعة"', 'placeholder="e.g. 24 episodes · 120 min · 300 pages · 40 hours"', 1),
        ('<span class="mf-label">النبذة</span>', '<span class="mf-label">Synopsis</span>', 1),
        ('placeholder="اكتب نبذة قصيرة…"', 'placeholder="Write a short synopsis…"', 1),
        ('<span class="mf-label">الصورة</span>', '<span class="mf-label">Image</span>', 1),
        ('class="mf-btn">رفع صورة</button>', 'class="mf-btn">Upload image</button>', 1),
        ('hidden">إزالة</button>', 'hidden">Remove</button>', 1),
        ('aria-label="موضع الصورة"', 'aria-label="Image position"', 1),
        ('data-pos="top">أعلى<', 'data-pos="top">Top<', 1),
        ('class="active">وسط<', 'class="active">Center<', 1),
        ('data-pos="bottom">أسفل<', 'data-pos="bottom">Bottom<', 1),
        ('<h2 class="ratings-title">محتوى الأنمي</h2>', '<h2 class="ratings-title"><span class="label-green">Anime</span> <span class="label-white">content</span></h2>', 1),
        ('<span class="kicker-dot kicker-dot-warn"></span>التصنيف</span>', '<span class="kicker-dot kicker-dot-warn"></span>Rating</span>', 1),
        ('<span class="warn-prefix">تنبيه!</span>', '<span class="warn-prefix">Note</span>', 1),
        ('قبل تصنيف أي عمل، اقرأ:', 'Before you rate a work, read:', 1),
        ('<a href="#" id="open-info-modal">دليل التصنيف المحافظ</a>', '<a href="#" id="open-info-modal">Rating guide</a>', 1),
        ('<a class="phone-about-link" href="about">عن المشروع</a>', '<a class="phone-about-link" href="/en/about">About</a>', 1),
        ('<a class="phone-about-link" href="/en" lang="en" hreflang="en">English</a>', '<a class="phone-about-link" href="/" lang="ar" hreflang="ar">العربية</a>', 1),
        ('<span class="kicker-dot"></span>معاينة البطاقة</span>', '<span class="kicker-dot"></span>Card preview</span>', 1),
        ('id="ratio-meta">16:9 · جاهزة للتصدير</span>', 'id="ratio-meta">16:9 · ready to export</span>', 1),
        ('id="preview-canvas" dir="rtl"', 'id="preview-canvas" dir="ltr"', 1),
        ('<span>اضغط لرفع صورة</span>', '<span>Select an image to upload</span>', 2),
        ('<span class="cd-cl-label">المُصنّف:</span>', '<span class="cd-cl-label">Rated by:</span>', 2),
        (f'<span class="cd-brand-label">{NAME_AR}</span>', f'<span class="cd-brand-label">{NAME_EN}</span>', 1),
        ('<h2 id="title-text" class="cd-title">عنوان العمل</h2>', '<h2 id="title-text" class="cd-title">Title</h2>', 1),
        ('<span class="cd-group-label">يحتوي على</span>', '<span class="cd-group-label">Contains</span>', 1),
        ('<span class="cd-group-label">يخلو من</span>', '<span class="cd-group-label">Free of</span>', 1),
        ('<span>تكبير المعاينة</span>', '<span>Enlarge preview</span>', 1),
        ('<span class="footer-tag">المخرجات</span>', '<span class="footer-tag">Output</span>', 1),
        ('<span class="btn-icon">⧉</span><span>نسخ</span>', '<span class="btn-icon">⧉</span><span>Copy</span>', 1),
        ('<span class="btn-icon">↓</span><span>تصدير</span>', '<span class="btn-icon">↓</span><span>Export</span>', 1),
        # Guide modal
        ('<span class="kicker-dot"></span>الدليل</span>', '<span class="kicker-dot"></span>Guide</span>', 1),
        ('<h2>دليل التصنيف المحافظ</h2>', '<h2>Rating guide</h2>', 1),
        ('title="فتح في صفحة كاملة" aria-label="فتح في صفحة كاملة"', 'title="Open full page" aria-label="Open full page"', 1),
        ('aria-label="إغلاق">×</button>', 'aria-label="Close">×</button>', 1),
        ('aria-label="أقسام الدليل"', 'aria-label="Guide sections"', 1),
        (f'{GUIDE_TEXT["intro"][0]} <a href="about">المزيد عن المشروع</a>', f'{GUIDE_TEXT["intro"][1]} <a href="/en/about">About the project</a>', 1),
        ('<span class="section-num">01</span>الدرجات</h3>', '<span class="section-num">01</span>Levels</h3>', 1),
        ('<div class="grade-meta">شديد</div>', '<div class="grade-meta">Severe</div>', 1),
        ('<div class="grade-meta">متوسط</div>', '<div class="grade-meta">Moderate</div>', 1),
        ('<div class="grade-meta">خفيف</div>', '<div class="grade-meta">Mild</div>', 1),
        ('<div class="grade-desc-label">// في الأعمال القصصية</div>', '<div class="grade-desc-label">// In story-based media</div>', 3),
        ('<div class="grade-desc-label">// في الألعاب</div>', '<div class="grade-desc-label">// In games</div>', 3),
        ('<span class="section-num">02</span>الموجودات</h3>', '<span class="section-num">02</span>Content flags</h3>', 1),
        ('<span class="legend-dot"></span>محاذير عقدية وفكرية</span>', '<span class="legend-dot"></span>Belief and ideology</span>', 1),
        ('<span class="legend-dot"></span>محاذير أخلاقية ومحتوى صادم</span>', '<span class="legend-dot"></span>Moral and disturbing content</span>', 1),
        ('<span class="legend-dot"></span>استغلال مالي وسلوكي</span>', '<span class="legend-dot"></span>Spending and engagement</span>', 1),
        ('<span class="section-num">03</span>المستثنيات</h3>', '<span class="section-num">03</span>Exceptions</h3>', 1),
    ]
    for ar, en in LEVELS:
        r.append((f'<div class="grade-title">{ar}</div>', f'<div class="grade-title">{en}</div>', 1))
    for k in ('l1.stories', 'l1.games', 'l2.stories', 'l2.games', 'l3.stories', 'l3.games', 'exceptions'):
        r.append(GUIDE_TEXT[k] + (1,))
    for ar, en, icon, key in FLAG_NAMES:
        r.append((f'alt="{ar}">', f'alt="{en}">', 1))
        r.append((f'<strong>{ar}</strong>', f'<strong>{en}</strong>', 1))
        r.append(GUIDE_TEXT[key] + (1,))
    r += [(a, b, 1) for a, b in EXCEPTION_ICONS]
    return r


# Page: about -------------------------------------------------------------------------
def about_rules():
    return [
        ('<!-- Arabic uses the site\'s own Handjet files (style.v3.css); Google\'s copy broke letter joins on iOS -->',
         '<!-- Headings use the site\'s own Handjet files (style.v3.css); paragraphs use IBM Plex Sans (ltr.css) -->', 1),
        ('<link href="https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&family=JetBrains+Mono:wght@400;500;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap" rel="stylesheet">', FONTS_EN, 1),
        *[(a, b, 1) for a, b in HEADER_BRAND],
        ('<a class="about-lang" href="/en/about" lang="en" hreflang="en">English</a>', '<a class="about-lang" href="/about" lang="ar" hreflang="ar">العربية</a>', 1),
        ('<a class="about-back" href="./">→ العودة إلى الأداة</a>', '<a class="about-back" href="/en">← Back to the tool</a>', 1),
        ('<h1>عن المشروع</h1>', '<h1>About</h1>', 1),
        ('<p class="lead">التصنيف المحافظ للمحتوى الإبداعي (CCCC) أداة تتيح للمستهلكين والمراجعين وصناع المحتوى، ولأي جهة أخرى، تصنيف الأعمال الإبداعية بحسب ما تحتويه، لا بحسب رقم عمري.</p>',
         '<p class="lead">CCCC (Conservative Classification of Creative Content) lets viewers, reviewers, creators and anyone else rate creative works by what they contain, not by age.</p>', 1),
        ('<h2>لماذا أنشأناه</h2>', '<h2>Why we built it</h2>', 1),
        ('<p>تخبرك التصنيفات العمرية بالسنّ المناسبة للعمل، لكنها لا تخبرك بما يحتويه. والمجتمعات المحافظة لا تسأل "هل يناسب هذا العمل من هم فوق الثالثة عشرة؟"، بل تسأل "هل يخلو من الكفريات والسحر والتعرّي؟". ولأن أنظمة التصنيف الحالية لا تجيب عن هذا السؤال، خصوصًا في الأنمي والمانجا والألعاب، رأينا أن من واجبنا تصميم أداة تجيب عنه.</p>',
         '<p>Age ratings tell you which age a work suits, not what\'s in it. Conservative audiences don\'t ask "is this fine for 13 and up?" — they ask "is it free of blasphemy, magic and nudity?" Existing rating systems don\'t answer that, especially for anime, manga and games, so we built a tool that does.</p>', 1),
        ('<h2>كيف يعمل</h2>', '<h2>How it works</h2>', 1),
        ('<p>لكل عنصر من الموجودات درجة من ثلاث درجات، بحسب حضوره في العمل وإمكانية تجنبه:</p>',
         '<p>Each content flag has one of three levels, based on how prominent it is and how easily it can be avoided:</p>', 1),
        ('الدرجة الأولى · شديد</li>', 'Level 1 · Severe</li>', 1),
        ('الدرجة الثانية · متوسط</li>', 'Level 2 · Moderate</li>', 1),
        ('الدرجة الثالثة · خفيف</li>', 'Level 3 · Mild</li>', 1),
        ('<p>أما الموسيقى والألفاظ النابية والعلاقات العاطفية خارج الزواج، فلا درجات لها. استخدم رموز المستثنيات للإشارة إلى ما يخلو منه العمل.</p>',
         '<p>Music, profanity and romantic relationships outside marriage have no levels. Use an exception badge to show that a work is free of one of them.</p>', 1),
        ('<p>التفاصيل في <a href="guide">دليل التصنيف المحافظ</a>.</p>', '<p>See the <a href="/en/guide">rating guide</a> for details.</p>', 1),
        ('<h2>حدود دورنا</h2>', '<h2>What we\'re not</h2>', 1),
        ('<p>لسنا جهة رقابية ولا نصدر أحكاما ملزمة. نوفر النظام والأداة، ويتولى المستخدم تصنيف الأعمال التي شاهدها أو قرأها أو لعبها، ونشر تصنيفه باسمه وعلى مسؤوليته.</p>',
         '<p>We are not a censorship body and do not issue binding rulings. We provide the system and the tool. Users rate works they have watched, read or played, publish ratings in their own name, and take responsibility for them.</p>', 1),
        ('<h2>مفتوح للجميع</h2>', '<h2>Open to everyone</h2>', 1),
        ('<p>المشروع <a href="https://github.com/Avuduru/CCCC" target="_blank" rel="noopener">مفتوح المصدر</a>، ويمكن لأي شخص استخدامه ومشاركة تصنيفاته.</p>',
         '<p>The project is <a href="https://github.com/Avuduru/CCCC" target="_blank" rel="noopener">open source</a>, and anyone can use it and share their ratings.</p>', 1),
        # Changelog: add each new entry's English here, matching the Arabic in about.html
        ('<h2>سجل التغييرات</h2>', '<h2>Changelog</h2>', 1),
        ('<p>نسجّل هنا كل تغيير في دليل التصنيف يغيّر معنى التصنيف. ويُحفظ مع كل تصنيف رقم إصدار الدليل الذي صُنِّف وفقه، فلا تختلط التصنيفات القديمة بالجديدة.</p>',
         '<p>Every change to the rating guide that changes what a rating means is listed here. Each rating is saved with the version of the guide it was made under, so older and newer ratings never get mixed up.</p>', 1),
        ('<p>الإصدار الأول عند الإطلاق: عشرة موجودات بثلاث درجات (شديد ومتوسط وخفيف)، وثلاثة رموز للمستثنيات (الموسيقى والألفاظ النابية والعلاقات العاطفية خارج الزواج).</p>',
         '<p>First version, at launch: ten content flags with three levels (severe, moderate, mild), and three exception badges (music, profanity, and romantic relationships outside marriage).</p>', 1),
        ('<a class="btn-primary" href="./">ابدأ التصنيف</a>', '<a class="btn-primary" href="/en">Start rating</a>', 1),
        ('<a class="btn-quiet" href="guide">دليل التصنيف المحافظ</a>', '<a class="btn-quiet" href="/en/guide">Rating guide</a>', 1),
    ]


# Page: guide -------------------------------------------------------------------------
def guide_rules():
    r = [
        ('<link href="https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&family=JetBrains+Mono:wght@400;500;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap" rel="stylesheet">', FONTS_EN, 1),
        ('href="style.v3.css?v=5"', 'href="/style.v3.css"', 1),
        # Mirror the few physical sides in the page's own styles
        ('            top: 0; bottom: 0; right: 0;\n            width: 4px;', '            top: 0; bottom: 0; left: 0;\n            width: 4px;', 1),
        ('            top: 0; left: 0;\n            width: 14px; height: 14px;\n            background: linear-gradient(135deg, var(--g-bg) 50%, transparent 50%);',
         '            top: 0; right: 0;\n            width: 14px; height: 14px;\n            background: linear-gradient(225deg, var(--g-bg) 50%, transparent 50%);', 1),
        ('padding: 22px 22px 22px 26px;', 'padding: 22px 26px 22px 22px;', 1),
        ('.legend-chip .count { color: var(--g-text-2); margin-right: 4px;', '.legend-chip .count { color: var(--g-text-2); margin-left: 4px;', 1),
        ('.exc-panel::before { top: -1px; right: -1px; border-left: none; border-bottom: none; }', '.exc-panel::before { top: -1px; left: -1px; border-right: none; border-bottom: none; }', 1),
        ('.exc-panel::after  { bottom: -1px; left: -1px; border-right: none; border-top: none; }', '.exc-panel::after  { bottom: -1px; right: -1px; border-left: none; border-top: none; }', 1),
        ('background: linear-gradient(to left, var(--g-grade-1) 0%, var(--g-grade-2) 50%, var(--g-grade-3) 100%);',
         'background: linear-gradient(to right, var(--g-grade-3) 0%, var(--g-grade-2) 50%, var(--g-grade-1) 100%);', 1),
        ("color: currentColor; margin-left: 8px; opacity: 0.7; }", "color: currentColor; margin-right: 8px; opacity: 0.7; }", 1),
        *[(a, b, 1) for a, b in HEADER_BRAND],
        ('<a class="guide-back guide-lang" href="/en/guide" lang="en" hreflang="en">English</a>', '<a class="guide-back guide-lang" href="/guide" lang="ar" hreflang="ar">العربية</a>', 1),
        ('<span>دليل التصنيف</span>', '<span>Rating guide</span>', 1),
        ('<span>→ العودة إلى الأداة</span>', '<span>← Back to the tool</span>', 1),
        ('<span class="kicker-dot"></span>الدليل</span>', '<span class="kicker-dot"></span>Guide</span>', 1),
        ('<h1>دليل التصنيف المحافظ</h1>', '<h1>Rating guide</h1>', 1),
        (GUIDE_TEXT['intro'][0] + ' <a href="about" style="color: var(--acc); white-space: nowrap;">المزيد عن المشروع</a>',
         GUIDE_TEXT['intro'][1] + ' <a href="/en/about" style="color: var(--acc); white-space: nowrap;">About the project</a>', 1),
        ('<!-- ── SECTION 03: الدرجات ── -->', '<!-- ── SECTION 03: Levels ── -->', 1),
        ('<!-- ── SECTION 01: الموجودات ── -->', '<!-- ── SECTION 01: Content flags ── -->', 1),
        ('<!-- ── SECTION 02: المستثنيات ── -->', '<!-- ── SECTION 02: Exceptions ── -->', 1),
        ('<h3>الدرجات</h3>', '<h3>Levels</h3>', 1),
        ('TIER LADDER <strong>·</strong> 03 LEVELS', 'LEVEL SCALE <strong>·</strong> 03 LEVELS', 1),
        ('<span>مقياس الشدة</span>', '<span>Severity scale</span>', 1),
        ('<span>خفيف</span>\n                <span class="axis-bar"></span>\n                <span>شديد</span>', '<span>Mild</span>\n                <span class="axis-bar"></span>\n                <span>Severe</span>', 1),
        ('<div class="tier-meta grade-meta">شديد</div>', '<div class="tier-meta grade-meta">Severe</div>', 1),
        ('<div class="tier-meta grade-meta">متوسط</div>', '<div class="tier-meta grade-meta">Moderate</div>', 1),
        ('<div class="tier-meta grade-meta">خفيف</div>', '<div class="tier-meta grade-meta">Mild</div>', 1),
        ('<span class="tier-row-label grade-desc-label">في الأعمال القصصية</span>', '<span class="tier-row-label grade-desc-label">In story-based media</span>', 3),
        ('<span class="tier-row-label grade-desc-label">في الألعاب</span>', '<span class="tier-row-label grade-desc-label">In games</span>', 3),
        ('<h3>الموجودات</h3>', '<h3>Content flags</h3>', 1),
        ('10 ENTRIES <strong>·</strong> 3 CATEGORIES', '10 CONTENT FLAGS <strong>·</strong> 3 GROUPS', 1),
        ('<span class="count">02</span>محاذير عقدية وفكرية</span>', '<span class="count">02</span>Belief and ideology</span>', 1),
        ('<span class="count">05</span>محاذير أخلاقية ومحتوى صادم</span>', '<span class="count">05</span>Moral and disturbing content</span>', 1),
        ('<span class="count">03</span>استغلال مالي وسلوكي</span>', '<span class="count">03</span>Spending and engagement</span>', 1),
        ('<h3>المستثنيات</h3>', '<h3>Exceptions</h3>', 1),
        ('STATUS MODIFIERS <strong>·</strong> +03', 'EXCEPTION BADGES <strong>·</strong> +03', 1),
        ('<a href="about#changelog" title="سجل التغييرات">GUIDE.v1</a>', '<a href="/en/about#changelog" title="Changelog">GUIDE.v1</a>', 1),
    ]
    for ar, en in LEVELS:
        r.append((f'<div class="tier-title grade-title">{ar}</div>', f'<div class="tier-title grade-title">{en}</div>', 1))
    for k in ('l1.stories', 'l1.games', 'l2.stories', 'l2.games', 'l3.stories', 'l3.games', 'exceptions'):
        r.append(GUIDE_TEXT[k] + (1,))
    for ar, en, icon, key in FLAG_NAMES:
        r.append((f'alt="{ar}">', f'alt="{en}">', 1))
        r.append((f'<strong>{ar}</strong>', f'<strong>{en}</strong>', 1))
        r.append(GUIDE_TEXT[key] + (1,))
    # tile tags come after the descriptions, which also contain "(خاص بالألعاب)"
    r += [
        ('</span>محاذير عقدية</span>', '</span>Belief</span>', 2),
        ('</span>محاذير أخلاقية</span>', '</span>Moral</span>', 5),
        ('</span>خاص بالألعاب</span>', '</span>Games only</span>', 3),
    ]
    r += [(a, b, 1) for a, b in EXCEPTION_ICONS]
    return r


PAGES = [
    # source, output, page key (tools/i18n/seo.py), rules
    ('index.html', 'index.html', 'index', index_rules),
    ('about.html', 'about.html', 'about', about_rules),
    ('guide.html', 'guide.html', 'guide', guide_rules),
]

# Links between pages and local file paths ---------------------------------------------
PAGE_LINKS = [('href="./"', 'href="/en"'), ('href="about"', 'href="/en/about"'), ('href="guide"', 'href="/en/guide"')]
LOCAL_PATH = re.compile(r'\b(src|href)="(?!https?:|//|#|/|data:|mailto:)((?:assets|js)/[^"]*|[\w.-]+\.(?:css|js|png|ico))"')


def build(src_name, rules, page_key):
    html = (ROOT / src_name).read_text(encoding='utf-8')
    problems = []
    try:
        html = seo.replace_block(html, seo.block(page_key, 'en'))
    except AssertionError as err:
        problems.append(f'{src_name}: {err}')
    for a, b, n in common_head() + rules():
        found = html.count(a)
        if found != n:
            problems.append(f'{src_name}: expected {n}× but found {found}×:\n    {a[:160]}')
            continue
        html = html.replace(a, b)
    for a, b in PAGE_LINKS:
        html = html.replace(a, b)
    html = LOCAL_PATH.sub(lambda m: f'{m.group(1)}="/{m.group(2)}"', html)
    # The note goes after <!DOCTYPE html>: anything before it would switch browsers to quirks mode
    doctype, rest_of_page = html.split('\n', 1)
    html = (doctype + '\n<!-- Generated from ../../' + src_name + ' by tools/i18n/build_en.py. Edit the Arabic page and the\n'
            '     wording in that script, then run it again; changes made here are overwritten. -->\n' + rest_of_page)

    # Nothing Arabic may be left over, apart from the allowed bits
    rest = ALLOWED_ARABIC_ATTR.sub('', html)
    for ok in ALLOWED_ARABIC:
        rest = rest.replace(ok, '')
    for i, line in enumerate(rest.splitlines(), 1):
        if ARABIC.search(line):
            problems.append(f'{src_name}: Arabic left on line {i}: {line.strip()[:120]}')
    return html, problems


def main():
    check = '--check' in sys.argv
    all_problems, stale = [], []
    OUT.mkdir(parents=True, exist_ok=True)
    for src, out, key, rules in PAGES:
        html, problems = build(src, rules, key)
        all_problems += problems
        target = OUT / out
        if problems:
            continue
        current = target.read_text(encoding='utf-8') if target.exists() else None
        if current != html:
            if check:
                stale.append(str(target.relative_to(ROOT)))
            else:
                target.write_text(html, encoding='utf-8', newline='\n')
                print('wrote', target.relative_to(ROOT))
    if all_problems:
        print('\n'.join(all_problems))
        sys.exit(1)
    if stale:
        print('Out of date (run python tools/i18n/build_en.py):', ', '.join(stale))
        sys.exit(1)
    print('English pages up to date.' if check else 'done')


if __name__ == '__main__':
    main()
