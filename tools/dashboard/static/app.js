// CCCC home dashboard: fetches /api/data and /api/health from server.py and draws everything.
// Refreshes every 60 s; charts update in place (no flicker).
'use strict';

const REFRESH = 60;
const TYPE_COLORS = { anime: '#ff6b9d', manga: '#c792ea', movie: '#f5a524', tv: '#5eb1ff', game: '#c8ff5e', book: '#f2d53c', manual: '#8b93a1' };
const TYPE_NAMES = { anime: 'Anime', manga: 'Manga', movie: 'Movies', tv: 'TV', game: 'Games', book: 'Books', manual: 'Manual' };
const TYPES = ['anime', 'manga', 'movie', 'tv', 'game', 'book'];
const TILES = [
  ['kufr', 'Blasphemy'], ['sex', 'Sexual content'], ['nudity', 'Nudity'], ['vices', 'Vices'], ['magic', 'Magic'],
  ['lgbt', 'LGBTQ+ themes'], ['gore', 'Disturbing'], ['addiction', 'Addictive design', 'game'], ['lootbox', 'Gambling', 'game'],
  ['p2w', 'Pay-to-win', 'game'],
];
const BADGES = [['nomusic', 'No music'], ['noprofanity', 'No profanity'], ['noaffairs', 'No dating/affairs']];

const $ = (s) => document.querySelector(s);
const fmt = (n) => (n == null ? '–' : Number(n).toLocaleString('en-US'));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let range = '7d';
try { range = localStorage.getItem('dash-range') || '7d'; } catch { range = '7d'; }
let lastData = null, countdown = REFRESH, siteUrl = 'https://muhafid.com';

// ---------- Chart.js look ----------
Chart.defaults.color = '#8b93a1';
Chart.defaults.font.family = "'JetBrains Mono', monospace";
Chart.defaults.font.size = 11;
Chart.defaults.borderColor = '#232833';
Chart.defaults.plugins.legend.labels.boxWidth = 10;
Chart.defaults.plugins.legend.labels.boxHeight = 10;
Chart.defaults.plugins.tooltip.backgroundColor = '#262c37';
Chart.defaults.plugins.tooltip.borderColor = '#2a303b';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.maintainAspectRatio = false;

const charts = {};
function chart(id, config) {
  const c = charts[id];
  if (c) {
    c.data = config.data;
    c.options = config.options || {};
    c.update('none');
    return c;
  }
  charts[id] = new Chart(document.getElementById(id), config);
  return charts[id];
}
function grad(ctxId, color) {
  const ctx = document.getElementById(ctxId).getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, ctx.canvas.clientHeight || 300);
  g.addColorStop(0, color + '55');
  g.addColorStop(1, color + '00');
  return g;
}

// ---------- time axis ----------
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hourKey = (d) => `${dayKey(d)} ${pad(d.getHours())}`;

// Bucket keys for the selected range, oldest first (local time = GoatCounter's time zone, assumed).
function buckets(data) {
  const now = new Date();
  const keys = [], labels = [];
  if (data.group === 'hour') {
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 3600e3);
      keys.push(hourKey(d));
      labels.push(`${pad(d.getHours())}:00`);
    }
  } else {
    const n = { '7d': 7, '30d': 30, '90d': 90 }[data.range] || 7;
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      keys.push(dayKey(d));
      labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    }
  }
  return { keys, labels };
}

// Per-bucket series for a set of GoatCounter paths
function gcSeries(paths, keys, hourly) {
  const m = new Map(keys.map((k) => [k, 0]));
  for (const p of paths) {
    for (const d of p.days) {
      if (hourly) {
        (d.hourly || []).forEach((v, h) => { const k = `${d.day} ${pad(h)}`; if (m.has(k)) m.set(k, m.get(k) + v); });
      } else if (m.has(d.day)) {
        m.set(d.day, m.get(d.day) + (d.daily || 0));
      }
    }
  }
  return keys.map((k) => m.get(k));
}

// DB clock -> local: the DB reports its own "now", so its offset from real time is known.
function dbOffsetMs(site) {
  if (!site?.db_now) return 0;
  const asUtc = Date.parse(site.db_now.replace(' ', 'T') + 'Z');
  return Math.round((asUtc - Date.now()) / 3600e3) * 3600e3;   // whole hours
}
function dbSeries(site, keys, hourly) {
  const m = new Map(keys.map((k) => [k, 0]));
  if (!site) return keys.map(() => 0);
  const off = dbOffsetMs(site);
  if (hourly) {
    for (const h of site.hourly || []) {
      const local = new Date(Date.parse(h.hour.replace(' ', 'T') + ':00Z') - off);
      const k = hourKey(local);
      if (m.has(k)) m.set(k, m.get(k) + h.new);
    }
  } else {
    for (const d of site.daily || []) if (m.has(d.day)) m.set(d.day, m.get(d.day) + d.new);
  }
  return keys.map((k) => m.get(k));
}

const sum = (a) => a.reduce((x, y) => x + y, 0);
const evPaths = (data, prefix) => data.gc.paths.filter((p) => p.event && p.path.startsWith(prefix));
const evCount = (data, name) => sum(data.gc.paths.filter((p) => p.event && p.path === name).map((p) => p.count));

// ---------- KPIs ----------
function kpi(label, color, value, note, series) {
  return { label, color, value, note, series };
}
function renderKpis(data, b, s) {
  const site = data.site || {};
  const shares = ['share', 'post-x', 'copy-text'].map((n) => evCount(data, n));
  const items = [
    kpi('Visitors', '#c8ff5e', s.visits.total, `${fmt(sum(data.gc.paths.filter((p) => !p.event).map((p) => p.count)))} page views`, s.visits.series),
    kpi('Searched', '#5eb1ff', s.searched.total, `${fmt(s.noResults)} hit no results`, s.searched.series),
    kpi('Picked a work', '#c792ea', s.picked.total, s.searched.total ? `${pct(s.picked.total, s.searched.total)}% of searchers` : '', s.picked.series),
    kpi('New ratings', '#f5a524', s.rated.total, `+${fmt(site.updated_24h)} re-exports in 24h`, s.rated.series),
    kpi('Shared', '#ff6b9d', sum(shares), `Share ${fmt(shares[0])} · X ${fmt(shares[1])} · text ${fmt(shares[2])}`, null),
    kpi('All-time raters', '#f2d53c', site.total_raters, `${fmt(site.total_works)} works · avg score ${site.avg_score ?? '–'}`, null),
  ];
  const box = $('#kpis');
  if (box.children.length !== items.length) {
    box.innerHTML = items.map((k, i) => `<div class="kpi"><div class="label"><i style="--c:${k.color}"></i>${esc(k.label)}</div>
      <div class="value" id="kv${i}">–</div><div class="note" id="kn${i}"></div><div class="spark"><canvas id="ks${i}"></canvas></div></div>`).join('');
  }
  items.forEach((k, i) => {
    animateNumber($(`#kv${i}`), k.value);
    $(`#kn${i}`).textContent = k.note;
    const series = k.series || [];
    chart(`ks${i}`, {
      type: 'line',
      data: { labels: b.labels, datasets: [{ data: series, borderColor: k.color, borderWidth: 2, fill: true, backgroundColor: grad(`ks${i}`, k.color), pointRadius: 0, tension: .35 }] },
      options: { plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false, beginAtZero: true } }, animation: false },
    });
  });
}
function animateNumber(el, to) {
  if (to == null) { el.textContent = '–'; return; }
  const from = Number(el.dataset.v || 0);
  el.dataset.v = to;
  if (from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / 700), e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(Math.round(from + (to - from) * e));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- trend + funnel ----------
function renderTrend(data, b, s) {
  $('#trend-sub').textContent = data.group === 'hour' ? 'per hour, last 24 h' : `per day, last ${b.keys.length} days`;
  chart('trend', {
    data: {
      labels: b.labels,
      datasets: [
        { type: 'line', label: 'Visitors', data: s.visits.series, borderColor: '#c8ff5e', backgroundColor: grad('trend', '#c8ff5e'), fill: true, tension: .35, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, yAxisID: 'y' },
        { type: 'line', label: 'Searched', data: s.searched.series, borderColor: '#5eb1ff', borderDash: [5, 4], tension: .35, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, yAxisID: 'y' },
        { type: 'bar', label: 'New ratings', data: s.rated.series, backgroundColor: '#f5a524cc', borderRadius: 4, maxBarThickness: 18, yAxisID: 'y' },
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top', align: 'end' } },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 12, maxRotation: 0 } }, y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#1b2029' } } },
    },
  });

  const steps = [
    ['Visited', s.visits.total, '#c8ff5e'],
    ['Searched', s.searched.total, '#5eb1ff'],
    ['Picked a work', s.picked.total, '#c792ea'],
    ['Rated', s.rated.total, '#f5a524'],
    ['Shared', sum(['share', 'post-x', 'copy-text'].map((n) => evCount(data, n))), '#ff6b9d'],
  ];
  const top = Math.max(1, steps[0][1]);
  $('#funnel').innerHTML = steps.map(([n, v, c], i) => `<div class="fstep">
      <div class="row"><span>${n}</span><span><b>${fmt(v)}</b>${i ? `<span class="pct">${pct(v, top)}%</span>` : ''}</span></div>
      <div class="fbar"><i style="--c:${c}; width:${Math.min(100, (v / top) * 100)}%"></i></div></div>`).join('')
    + `<div class="fnote">Rated = new ratings in the database (counts people with ad-blockers too, so it can top the others).</div>`;
}

// ---------- map + countries ----------
let world = null, a2num = null;
async function loadWorld() {
  if (world) return;
  const [topo, codes] = await Promise.all([
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json').then((r) => r.json()),
    fetch('https://cdn.jsdelivr.net/npm/i18n-iso-countries@7.11.0/codes.json').then((r) => r.json()),
  ]);
  world = topojson.feature(topo, topo.objects.countries).features.filter((f) => f.properties.name !== 'Antarctica');
  a2num = new Map(codes.map((c) => [c[0], c[2]]));
}
const regionName = (() => { try { const dn = new Intl.DisplayNames(['en'], { type: 'region' }); return (cc, fb) => { try { return dn.of(cc) || fb; } catch { return fb; } }; } catch { return (cc, fb) => fb; } })();
const flag = (cc) => (cc && /^[A-Z]{2}$/.test(cc) ? `https://flagcdn.com/w40/${cc.toLowerCase()}.png` : '');

async function renderMap(data) {
  const locs = data.gc.locations.filter((l) => l.count > 0);
  const total = sum(locs.map((l) => l.count));
  $('#map-sub').textContent = `${locs.length} countries`;
  $('#countries').innerHTML = locs.length ? locs.slice(0, 12).map((l) => `<li>
      <span>${flag(l.id) ? `<img class="flag" src="${flag(l.id)}" alt="">` : '<span class="ico">?</span>'}</span>
      <span class="name">${esc(regionName(l.id, l.name || 'Unknown'))}</span><span class="num">${fmt(l.count)} <small style="color:var(--faint)">${pct(l.count, total)}%</small></span>
      <span class="bar"><i style="width:${(l.count / locs[0].count) * 100}%"></i></span></li>`).join('') : '<li><span class="empty">No visits in this range yet</span></li>';

  try { await loadWorld(); } catch { $('#map').textContent = 'Map unavailable (could not load the world outline).'; return; }
  const byNum = new Map();
  for (const l of locs) { const n = a2num.get(l.id); if (n) byNum.set(n, l); }
  const max = Math.max(1, ...locs.map((l) => l.count));
  const color = d3.scaleSequentialSqrt([0, max], d3.interpolateRgb('#2f4413', '#c8ff5e'));
  const el = $('#map');
  const w = el.clientWidth || 800, h = w / 2;
  let svg = d3.select(el).select('svg');
  if (svg.empty()) {
    svg = d3.select(el).append('svg').attr('viewBox', `0 0 ${w} ${h}`);
    const proj = d3.geoNaturalEarth1().fitExtent([[4, 4], [w - 4, h - 4]], { type: 'FeatureCollection', features: world });
    const path = d3.geoPath(proj);
    const tip = $('#map-tip');
    svg.append('g').selectAll('path').data(world).join('path').attr('d', path)
      .on('mousemove', (ev, f) => {
        const l = byNumNow.get(f.id);
        const cc = l?.id || '';
        tip.innerHTML = `${cc ? `<img src="${flag(cc)}" alt="">` : ''}<span>${esc(l ? regionName(l.id, l.name) : f.properties.name)}</span><b>${l ? fmt(l.count) : 0}</b>`;
        tip.style.left = ev.clientX + 14 + 'px'; tip.style.top = ev.clientY + 14 + 'px';
        tip.classList.remove('hidden');
      })
      .on('mouseleave', () => tip.classList.add('hidden'));
  }
  byNumNow = byNum;
  svg.selectAll('path').attr('fill', (f) => (byNum.has(f.id) ? color(byNum.get(f.id).count) : '#1a1f27'));
}
let byNumNow = new Map();

// ---------- logos (simple-icons, tinted with each brand's colour through a CSS mask) ----------
const SI = 'https://cdn.jsdelivr.net/npm/simple-icons@16.38.0/icons/';
const WIN = "data:image/svg+xml," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M1 3.5l9-1.3v8.6H1zM11 2l12-1.7v10.5H11zM1 12.2h9v8.6l-9-1.3zM11 12.2h12v10.5L11 21z'/></svg>");
const ARROW = "data:image/svg+xml," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M5 19L19 5M9 5h10v10' stroke='black' stroke-width='3' fill='none' stroke-linecap='round'/></svg>");
const LOGOS = {
  x: ['x', '#ffffff'], instagram: ['instagram', '#E4405F'], youtube: ['youtube', '#FF0000'], facebook: ['facebook', '#1877F2'],
  reddit: ['reddit', '#FF4500'], discord: ['discord', '#5865F2'], whatsapp: ['whatsapp', '#25D366'], tiktok: ['tiktok', '#ffffff'],
  telegram: ['telegram', '#26A5E4'], google: ['google', '#4285F4'], github: ['github', '#ffffff'], threads: ['threads', '#ffffff'],
  pinterest: ['pinterest', '#E60023'], snapchat: ['snapchat', '#FFFC00'], duckduckgo: ['duckduckgo', '#DE5833'],
  chrome: ['googlechrome', '#4285F4'], safari: ['safari', '#1E90FF'], firefox: ['firefoxbrowser', '#FF7139'], opera: ['opera', '#FF1B2D'],
  samsung: ['samsung', '#7f9cff'], ios: ['apple', '#ffffff'], macos: ['apple', '#ffffff'], android: ['android', '#3DDC84'],
  linux: ['linux', '#FCC624'], windows: [WIN, '#00A4EF'], direct: [ARROW, '#8b93a1'],
};
function logo(key, size = 16) {
  const l = LOGOS[key];
  if (!l) return '';
  const url = l[0].startsWith('data:') ? l[0] : SI + l[0] + '.svg';
  return `<span class="logo-i" style="--c:${l[1]}; --m:url(&quot;${url}&quot;); width:${size}px; height:${size}px"></span>`;
}
const sysKey = (n) => ({ 'iOS': 'ios', 'Android': 'android', 'Windows': 'windows', 'macOS': 'macos', 'Linux': 'linux', 'Chrome OS': 'chrome' }[n]);
const brKey = (n) => { n = (n || '').toLowerCase(); return n.includes('chrome') ? 'chrome' : n.includes('safari') ? 'safari' : n.includes('firefox') ? 'firefox'
  : n.includes('opera') ? 'opera' : n.includes('samsung') ? 'samsung' : n.includes('instagram') ? 'instagram' : n.includes('facebook') ? 'facebook' : null; };

// ---------- referrers, devices, search types ----------
function refInfo(r) {
  const id = (r.id || r.name || '').toLowerCase();
  if (!id) return { name: 'Direct / unknown', logo: 'direct' };
  const rules = [[/(^|\.)t\.co$|(^|\.)x\.com$|twitter\.com$/, 'X (Twitter)', 'x'], [/instagram\.com$/, 'Instagram', 'instagram'],
    [/youtube\.com$|youtu\.be$/, 'YouTube', 'youtube'], [/facebook\.com$|fb\.me$/, 'Facebook', 'facebook'], [/reddit\.com$/, 'Reddit', 'reddit'],
    [/discord(app)?\.com$/, 'Discord', 'discord'], [/whatsapp\.com$/, 'WhatsApp', 'whatsapp'], [/tiktok\.com$/, 'TikTok', 'tiktok'],
    [/^t\.me$|telegram\.org$/, 'Telegram', 'telegram'], [/google\./, 'Google', 'google'], [/github\.com$/, 'GitHub', 'github'],
    [/threads\.(net|com)$/, 'Threads', 'threads'], [/pinterest\./, 'Pinterest', 'pinterest'], [/snapchat\.com$/, 'Snapchat', 'snapchat'],
    [/duckduckgo\.com$/, 'DuckDuckGo', 'duckduckgo']];
  for (const [re, name, key] of rules) if (re.test(id)) return { name, logo: key };
  if (r.ref_scheme === 'g' && /google/i.test(r.name || '')) return { name: 'Google', logo: 'google' };
  return { name: r.name || id, icon: /^[a-z0-9.-]+\.[a-z]{2,}$/.test(id) ? id : null };
}
function renderRefs(data) {
  // merge entries that map to the same site (t.co + x.com, ...)
  const merged = new Map();
  for (const r of data.gc.refs) {
    const i = refInfo(r);
    const m = merged.get(i.name) || { ...i, count: 0 };
    m.count += r.count; merged.set(i.name, m);
  }
  const list = [...merged.values()].sort((a, b) => b.count - a.count).slice(0, 9);
  const top = Math.max(1, ...list.map((r) => r.count));
  $('#refs').innerHTML = list.length ? list.map((r) => `<li>
      <span class="ico">${r.logo ? logo(r.logo) : r.icon ? `<img src="https://icons.duckduckgo.com/ip3/${esc(r.icon)}.ico" alt="" onerror="this.remove()">` : '↗'}</span>
      <span class="name">${esc(r.name)}</span><span class="num">${fmt(r.count)}</span>
      <span class="bar"><i style="width:${(r.count / top) * 100}%; --c:#5eb1ff"></i></span></li>`).join('') : '<li><span class="empty">No visits yet</span></li>';
}
function renderDevices(data) {
  const names = { phone: 'Phones', tablet: 'Tablets', desktop: 'Computers', desktophd: 'Large screens', unknown: 'Unknown' };
  const cols = { phone: '#c8ff5e', tablet: '#5eb1ff', desktop: '#f5a524', desktophd: '#c792ea', unknown: '#5d6573' };
  const s = data.gc.sizes.filter((x) => x.count > 0);
  chart('sizes', {
    type: 'doughnut',
    data: { labels: s.map((x) => names[x.id] || x.id), datasets: [{ data: s.map((x) => x.count), backgroundColor: s.map((x) => cols[x.id] || '#5d6573'), borderColor: '#141820', borderWidth: 3, hoverOffset: 6 }] },
    options: { cutout: '68%', plugins: { legend: { position: 'right' } } },
  });
  const chips = (list, key) => list.filter((x) => x.count > 0).map((x) => `<span class="chip">${logo(key(x.name), 13)}${esc(x.name || 'Other')}<b>${fmt(x.count)}</b></span>`).join('');
  $('#systems').innerHTML = chips(data.gc.systems, sysKey);
  $('#browsers').innerHTML = chips(data.gc.browsers, brKey);
}
function renderTypes(data) {
  const get = (prefix, t) => evCount(data, `${prefix}-${t}`);
  chart('types', {
    type: 'bar',
    data: {
      labels: TYPES.map((t) => TYPE_NAMES[t]),
      datasets: [
        { label: 'Searched', data: TYPES.map((t) => get('searched', t)), backgroundColor: TYPES.map((t) => TYPE_COLORS[t]), borderRadius: 4 },
        { label: 'Picked', data: TYPES.map((t) => get('picked', t)), backgroundColor: TYPES.map((t) => TYPE_COLORS[t] + '88'), borderRadius: 4 },
        { label: 'No results', data: TYPES.map((t) => get('no-results', t)), backgroundColor: '#e5484d', borderRadius: 4 },
      ],
    },
    options: { plugins: { legend: { position: 'top', align: 'end' } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#1b2029' } } } },
  });
}

// ---------- ratings (database) ----------
function renderRatings(data) {
  const site = data.site;
  if (!site) return;
  // stacked per-day, 90 days
  const days = [], labels = [], now = new Date();
  for (let i = 89; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); days.push(dayKey(d)); labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })); }
  const byDay = new Map((site.daily || []).map((d) => [d.day, d.by_type || {}]));
  const present = TYPES.concat('manual').filter((t) => (site.daily || []).some((d) => d.by_type?.[t]));
  chart('ratings-daily', {
    type: 'bar',
    data: { labels, datasets: present.map((t) => ({ label: TYPE_NAMES[t], data: days.map((k) => byDay.get(k)?.[t] || 0), backgroundColor: TYPE_COLORS[t], borderRadius: 2, maxBarThickness: 10 })) },
    options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'top', align: 'end' } },
      scales: { x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 10, maxRotation: 0 } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#1b2029' } } } },
  });

  const bt = Object.entries(site.by_type || {}).sort((a, b) => b[1] - a[1]);
  chart('by-type', {
    type: 'doughnut',
    data: { labels: bt.map(([t]) => TYPE_NAMES[t] || t), datasets: [{ data: bt.map(([, n]) => n), backgroundColor: bt.map(([t]) => TYPE_COLORS[t] || '#5d6573'), borderColor: '#141820', borderWidth: 3, hoverOffset: 6 }] },
    options: { cutout: '68%', plugins: { legend: { position: 'right' } } },
  });

  const split = (title, parts) => {
    const tot = sum(parts.map((p) => p[1])) || 1;
    return `<div class="split"><div class="row"><span>${title}</span><span>${parts.map(([n, v]) => `${n} ${pct(v, tot)}%`).join(' · ')}</span></div>
      <div class="bar">${parts.map(([, v, c]) => `<i style="width:${(v / tot) * 100}%; background:${c}"></i>`).join('')}</div></div>`;
  };
  const bl = site.by_lang || {}, bo = site.by_orientation || {}, ba = site.by_action || {}, bg = site.by_guide_version || {};
  $('#splits').innerHTML = [
    split('Language', [['Arabic', bl.ar || 0, '#c8ff5e'], ['English', bl.en || 0, '#5eb1ff']]),
    split('Card layout', [['Landscape', bo.horizontal || 0, '#f5a524'], ['Portrait', bo.vertical || 0, '#c792ea']]),
    split('Saved by', [['Export', ba.export || 0, '#ff6b9d'], ['Copy', ba.copy || 0, '#f2d53c']]),
    split('Guide', Object.keys(bg).sort().map((k, i) => [k, bg[k], ['#5d6573', '#c8ff5e', '#5eb1ff'][i] || '#8b93a1'])),
  ].join('');

  const t = site.tiles || {}, total = t.total || 0, games = site.by_type?.game || 0;
  $('#tiles-sub').textContent = `share of ${fmt(total)} ratings (game-only tiles: of ${fmt(games)} game ratings)`;
  const row = (id, name, n, of, c, icon, small) => `<div class="tile"><img src="${siteUrl}/assets/icons/en/${icon}.png" alt="" onerror="this.style.visibility='hidden'">
    <div><div class="t">${esc(name)}${small ? `<small>${small}</small>` : ''}</div><div class="bar"><i style="width:${pct(n, of)}%; --c:${c}"></i></div></div>
    <div class="pct">${pct(n, of)}%</div></div>`;
  $('#tiles').innerHTML = TILES.map(([id, name, only]) => row(id, name, t[id] || 0, only ? games : total, '#e5484d', `${id}1`, only ? 'games' : ''))
    .concat(BADGES.map(([id, name]) => row(id, name, t[id] || 0, total, '#c8ff5e', id, 'badge'))).join('');

  const top = site.top_works || [];
  const max = Math.max(1, ...top.map((w) => w.rater_count));
  $('#top').innerHTML = top.map((w, i) => `<li><span class="ico">${i + 1}</span>
      <span class="name" dir="auto">${esc(w.title)}<span class="tag" style="color:${TYPE_COLORS[w.content_type] || '#8b93a1'}">${esc(TYPE_NAMES[w.content_type] || w.content_type)}</span></span>
      <span class="num">${fmt(w.rater_count)}</span><span class="bar"><i style="width:${(w.rater_count / max) * 100}%; --c:${TYPE_COLORS[w.content_type] || '#8b93a1'}"></i></span></li>`).join('');
}

function renderPages(data) {
  const pages = data.gc.paths.filter((p) => !p.event).sort((a, b) => b.count - a.count).slice(0, 10);
  const top = Math.max(1, ...pages.map((p) => p.count));
  $('#pages').innerHTML = pages.length ? pages.map((p) => `<li><span class="ico">${p.path.startsWith('/en') ? 'EN' : 'AR'}</span>
      <span class="name">${esc(p.path)}</span><span class="num">${fmt(p.count)}</span>
      <span class="bar"><i style="width:${(p.count / top) * 100}%"></i></span></li>`).join('') : '<li><span class="empty">No page views yet</span></li>';
}

async function renderHealth() {
  $('#health-sub').textContent = 'checking…';
  try {
    const h = await fetch('/api/health').then((r) => r.json());
    const groups = [...new Set(h.checks.map((c) => c.group))];
    $('#health').innerHTML = groups.map((g) => `<li class="hg">${esc(g)}</li>` + h.checks.filter((c) => c.group === g).map((c) => {
      const cls = !c.ok ? 'bad' : (c.ms > 3000 ? 'slow' : '');
      let note = c.note || '';
      if (c.name === 'Last deploy' && c.ok) { const d = new Date(note); if (!isNaN(d)) note = d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
      return `<li class="${cls}"><span class="s"></span><span class="n">${esc(c.name)}<small>${esc(note)}</small></span><span class="m">${c.ms != null && c.name !== 'Last deploy' ? fmt(c.ms) + ' ms' : ''}</span></li>`;
    }).join('')).join('');
    const when = new Date(h.checked).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    $('#health-sub').innerHTML = h.failed ? `<span style="color:#ff8a8d">${h.failed} failing</span> · ${when}` : `all ${h.checks.length} OK · ${when}`;
  } catch { $('#health-sub').textContent = 'could not check'; }
}

// ---------- main loop ----------
async function load() {
  countdown = REFRESH;
  try {
    const r = await fetch(`/api/data?range=${range}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || r.status);
    lastData = data;
    siteUrl = data.site_url || siteUrl;
    render(data);
    $('#live-dot').classList.remove('bad');
    $('#updated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const err = $('#errors');
    if (data.errors?.length) { err.textContent = 'Some numbers are missing: ' + data.errors.join(' · '); err.classList.remove('hidden'); }
    else err.classList.add('hidden');
  } catch (e) {
    $('#live-dot').classList.add('bad');
    $('#updated').textContent = 'Offline: retrying…';
  }
}

function render(data) {
  const b = buckets(data), hourly = data.group === 'hour';
  const pages = data.gc.paths.filter((p) => !p.event);
  const series = (paths) => { const s = gcSeries(paths, b.keys, hourly); return { series: s, total: sum(paths.map((p) => p.count)) }; };
  const rated = dbSeries(data.site, b.keys, hourly);
  const s = {
    visits: { series: gcSeries(pages, b.keys, hourly), total: Math.max(0, data.gc.total - data.gc.total_events) },
    searched: series(evPaths(data, 'searched-')),
    picked: series(evPaths(data, 'picked-')),
    rated: { series: rated, total: sum(rated) },
    noResults: sum(evPaths(data, 'no-results-').map((p) => p.count)),
  };
  if (data.site?.db_now) $('#db-now').textContent = 'DB clock ' + data.site.db_now.slice(11, 16);
  renderKpis(data, b, s);
  renderTrend(data, b, s);
  renderMap(data);
  renderRefs(data);
  renderDevices(data);
  renderTypes(data);
  renderRatings(data);
  renderPages(data);
}

document.querySelectorAll('#ranges button').forEach((btn) => {
  btn.classList.toggle('on', btn.dataset.r === range);
  btn.addEventListener('click', () => {
    range = btn.dataset.r;
    try { localStorage.setItem('dash-range', range); } catch { /* private mode */ }
    document.querySelectorAll('#ranges button').forEach((x) => x.classList.toggle('on', x === btn));
    load();
  });
});

setInterval(() => {
  countdown = Math.max(0, countdown - 1);
  $('#ring').style.setProperty('--p', `${((REFRESH - countdown) / REFRESH) * 100}%`);
  if (countdown === 0) load();
}, 1000);
setInterval(renderHealth, 10 * 60 * 1000);
window.addEventListener('resize', () => { if (lastData) { d3.select('#map').selectAll('svg').remove(); renderMap(lastData); } });

load();
renderHealth();
