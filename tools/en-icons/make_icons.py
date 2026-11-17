"""Make the English sticker icons (assets/icons/en/) from the Arabic ones.

Each original tile keeps its frame, colour and white artwork; only the label
areas are painted over (the black strip at the bottom, and on the three green
badges also the top line) and the English label is written in, sized to fit.

Run from the repo root:  python tools/en-icons/make_icons.py
Needs: pip install playwright && playwright install chromium (and internet for the Google Font).
Change a label in LABELS below and re-run to regenerate all 33 files.
geo.json holds where each label area starts (measured from the Arabic files).
"""
import base64, json, os, urllib.parse
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'assets', 'icons')
OUT = os.path.join(ROOT, 'assets', 'icons', 'en')
GEO = json.load(open(os.path.join(os.path.dirname(__file__), 'geo.json'), encoding='utf-8'))

LABELS = {
    'kufr': 'BLASPHEMY', 'sex': 'SEXUAL CONTENT', 'nudity': 'NUDITY', 'vices': 'VICES', 'magic': 'MAGIC',
    'lgbt': 'LGBTQ+', 'gore': 'DISTURBING', 'addiction': 'ADDICTIVE', 'lootbox': 'GAMBLING', 'p2w': 'PAY-TO-WIN',
    'nomusic': 'MUSIC', 'noprofanity': 'PROFANITY', 'noaffairs': 'ROMANCE',
}
TOP_LINE = 'CONTAINS NO'   # top line of the three green badges
FONT = {'family': 'Barlow Condensed', 'weight': 800, 'max': 38, 'track': 0.03,
        'css': 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@800&display=swap'}

PAGE = """<!doctype html><html><head><link rel="stylesheet" href="%s"></head><body><script>
async function draw(spec) {
  const F = spec.font;
  await document.fonts.load(`${F.weight} 40px "${F.family}"`);
  const img = new Image(); img.src = spec.src; await img.decode();
  const c = document.createElement('canvas'); c.width = spec.w; c.height = spec.h;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const setFont = (s) => { x.font = `${F.weight} ${s}px "${F.family}"`; x.letterSpacing = (F.track * s) + 'px'; };
  const fit = (text, maxW, maxSize) => { let s = maxSize; for (; s > 10; s--) { setFont(s); if (x.measureText(text).width <= maxW) break; } return s; };
  const center = (text, cy) => { const m = x.measureText(text); return cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2; };
  x.textAlign = 'center';
  let maxW, cy;
  if (spec.badge) {
    x.fillStyle = '#000'; x.fillRect(50, spec.stripTop + 2, spec.w - 100, 280 - spec.stripTop - 2);   // inside the rounded corners
    x.fillStyle = spec.green; x.fillRect(34, 24, spec.w - 68, 48); x.fillRect(80, 70, spec.w - 140, 10);   // Arabic top line + its tails
    const ts = fit(spec.top, spec.w - 90, F.max); setFont(ts); const ty = center(spec.top, 48);
    x.lineJoin = 'round'; x.lineWidth = Math.max(5, ts * 0.22); x.strokeStyle = '#000'; x.strokeText(spec.top, spec.w / 2, ty);
    x.fillStyle = '#fff'; x.fillText(spec.top, spec.w / 2, ty);
    maxW = spec.w - 96; cy = spec.stripTop + 20;
  } else {
    x.fillStyle = '#000'; x.fillRect(0, spec.stripTop, spec.w, spec.h - spec.stripTop);
    maxW = spec.w - 30; cy = spec.stripTop + (spec.h - 8 - spec.stripTop) / 2 + 1;
  }
  setFont(fit(spec.label, maxW, F.max));
  x.fillStyle = '#fff'; x.fillText(spec.label, spec.w / 2, center(spec.label, cy));
  return c.toDataURL('image/png');
}
</script></body></html>"""

def main():
    os.makedirs(OUT, exist_ok=True)
    page_path = os.path.join(OUT, '_render.html')
    open(page_path, 'w', encoding='utf-8').write(PAGE % FONT['css'])
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(args=['--allow-file-access-from-files'])
            pg = b.new_page()
            pg.goto('file:///' + page_path.replace('\\', '/'), wait_until='networkidle')
            for gid, g in GEO.items():
                badge = gid.startswith('no')
                spec = {'font': FONT, 'src': 'file:///' + urllib.parse.quote(os.path.join(SRC, g['src']).replace('\\', '/')),
                        'w': g['w'], 'h': g['h'], 'stripTop': g['stripTop'], 'badge': badge, 'green': g.get('green'),
                        'label': LABELS[gid if badge else gid[:-1]], 'top': TOP_LINE}
                data = pg.evaluate('(s) => draw(s)', spec)
                open(os.path.join(OUT, gid + '.png'), 'wb').write(base64.b64decode(data.split(',', 1)[1]))
            b.close()
    finally:
        os.remove(page_path)
    print('wrote', len(GEO), 'icons to', OUT)

if __name__ == '__main__':
    main()
