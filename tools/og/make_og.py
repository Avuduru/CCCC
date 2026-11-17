"""Render the link-preview images (Open Graph / X cards) for both languages.

    python tools/og/make_og.py      # needs Playwright; writes assets/og/muhafid-ar.jpg and muhafid-en.jpg

1200×630 (the size X, WhatsApp, Telegram and Google use for large previews),
rendered at 2× and saved as full-colour JPEG at 1200×630.
"""
import io
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets' / 'og'
A = (ROOT / 'assets').as_uri()

LANGS = {
    'ar': dict(dir='rtl', title='التصنيف المحافظ<br><span>للمحتوى الإبداعي</span>',
               sub='صنّف الأعمال بحسب ما تحتويه، لا بحسب رقم عمري', title_font='PixelAE', title_size=64,
               icons=[f'{A}/icons/{n}1.png' for n in ('كفريات', 'جنس', 'تعري', 'مفاسد', 'سحر', 'شذوذ', 'صادم')]),
    'en': dict(dir='ltr', title='Conservative Classification<br><span>of Creative Content</span>',
               sub='Rate works by what they contain, not by age', title_font='Handjet', title_size=62,
               icons=[f'{A}/icons/en/{n}1.png' for n in ('kufr', 'sex', 'nudity', 'vices', 'magic', 'lgbt', 'gore')]),
}

PAGE = """<!doctype html><html dir="{dir}"><head><meta charset="utf-8"><style>
@font-face {{ font-family: 'PixelAE'; src: url('{A}/fonts/PixelAE-Bold.ttf'); font-weight: 700; }}
@font-face {{ font-family: 'Handjet'; src: url('{A}/fonts/Handjet-Bold.ttf'); font-weight: 700; }}
@font-face {{ font-family: 'Handjet'; src: url('{A}/fonts/Handjet-SemiBold.ttf'); font-weight: 600; }}
html, body {{ margin: 0; }}
.og {{ width: 1200px; height: 630px; box-sizing: border-box; padding: 56px 64px 0; display: flex; flex-direction: column;
      background-color: #0e1014; background-image: radial-gradient(rgba(255,255,255,0.05) 1.5px, transparent 1.6px); background-size: 24px 24px;
      color: #f2f4ee; font-family: 'Handjet', sans-serif; overflow: hidden; }}
.top {{ display: flex; align-items: center; gap: 40px; flex: 1; }}
.logo {{ flex: none; padding: 34px 38px; background: #161a21; border: 1px solid rgba(255,255,255,0.08); border-radius: 26px; }}
.logo img {{ height: 92px; display: block; }}
h1 {{ margin: 0; font-family: '{title_font}', 'Handjet', sans-serif; font-weight: 700; font-size: {title_size}px; line-height: 1.1; }}
h1 span {{ color: #c8ff5e; }}
p {{ margin: 16px 0 0; font-size: 32px; font-weight: 600; color: #9aa093; }}
.band {{ margin: 0 -64px; padding: 26px 64px 30px; background: #161a21; border-top: 1px solid rgba(255,255,255,0.08);
        display: flex; align-items: center; justify-content: space-between; }}
.icons {{ display: flex; gap: 12px; }}
.icons img {{ width: 92px; height: 92px; display: block; }}
.url {{ font-family: 'Handjet', monospace; font-weight: 700; font-size: 34px; letter-spacing: 0.12em; color: #c8ff5e; direction: ltr; }}
</style></head><body><div class="og">
  <div class="top"><div class="logo"><img src="{A}/LOGO.png"></div>
    <div><h1>{title}</h1><p>{sub}</p></div></div>
  <div class="band"><div class="icons">{icons}</div><div class="url">MUHAFID.COM</div></div>
</div></body></html>"""


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--allow-file-access-from-files'])
        for lang, c in LANGS.items():
            html = PAGE.format(A=A, icons=''.join(f'<img src="{s}">' for s in c['icons']), **{k: v for k, v in c.items() if k != 'icons'})
            tmp = OUT / f'_og_{lang}.html'
            tmp.write_text(html, encoding='utf-8')
            page = b.new_page(viewport={'width': 1200, 'height': 630}, device_scale_factor=2)
            page.goto(tmp.as_uri(), wait_until='networkidle')
            page.evaluate("document.fonts.ready")
            page.wait_for_timeout(500)
            im = Image.open(io.BytesIO(page.screenshot())).convert('RGB').resize((1200, 630), Image.LANCZOS)
            target = OUT / f'muhafid-{lang}.jpg'
            im.save(target, 'JPEG', quality=90, subsampling=0, optimize=True)
            tmp.unlink()
            print('wrote', target.relative_to(ROOT), round(target.stat().st_size / 1024), 'KB')
        b.close()


if __name__ == '__main__':
    main()
