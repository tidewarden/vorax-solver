// The private analytics page (/dashboard). It holds no data: it asks for the dashboard password once per
// browser, then reads /v1/stats with it, the smarter player's runs from the repo, and the automated
// loops' runs from GitHub's public API. The collector keeps more than is shown here (latest games, problems by
// setup, site versions; data/live/rules-check.json in the repo): /v1/stats still returns it.
// Design: a neutral palette that follows the system's light or dark mode, one accent colour, red and green
// kept for status, key numbers first, then health, trends and the detail tables, in a responsive grid.
export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<title>Vorax analytics</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<style>
  :root {
    --bg: #f6f6f7; --card: #ffffff; --border: #e5e5e8; --text: #18181b; --muted: #6b6b76; --faint: #a1a1aa;
    --accent: #4f46e5; --accent-2: #0891b2; --grid: #ececef;
    --ok: #15803d; --bad: #dc2626; --warn: #b45309;
    --radius: 12px; --shadow: 0 1px 2px rgb(0 0 0 / 0.04);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0b0b0d; --card: #131316; --border: #26262b; --text: #f4f4f5; --muted: #a1a1aa; --faint: #71717a;
      --accent: #8b8cf8; --accent-2: #22d3ee; --grid: #222227;
      --ok: #4ade80; --bad: #f87171; --warn: #fbbf24;
      --shadow: none;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; }
  main { max-width: 1240px; margin: 0 auto; padding: 32px 20px 64px; }
  header { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 8px 24px; margin-bottom: 24px; }
  h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
  .sub { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
  .live { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; }
  .live::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 20%, transparent); }

  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .kpi { padding: 16px 18px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card); box-shadow: var(--shadow); }
  .kpi span { display: block; color: var(--muted); font-size: 12.5px; font-weight: 500; }
  .kpi b { display: block; margin-top: 6px; font-size: 28px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .kpi small { display: block; margin-top: 2px; color: var(--faint); font-size: 12px; }

  .grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px; }
  .card { grid-column: span 12; min-width: 0; padding: 18px 20px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card); box-shadow: var(--shadow); }
  @media (min-width: 1000px) { .half { grid-column: span 6; } }
  .card h2 { margin: 0; font-size: 15px; font-weight: 600; }
  .card > .sub { margin: 2px 0 14px; }
  .scroll { overflow-x: auto; }
  .card .scroll + h2 { margin-top: 20px; }
  .lead { margin: 0 0 10px; font-size: 14px; }
  /* long lists show a page at a time, so no section runs the page long */
  .pager { display: flex; align-items: center; gap: 10px; margin-top: 10px; font-size: 13px; color: var(--muted); }
  .pager button { font: inherit; padding: 4px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--card); color: var(--text); cursor: pointer; }
  .pager button:disabled { opacity: 0.4; cursor: default; }

  table { width: 100%; border-collapse: collapse; font-size: 13.5px; font-variant-numeric: tabular-nums; }
  th { padding: 0 10px 8px; color: var(--muted); font-size: 12px; font-weight: 500; text-align: left; white-space: nowrap; border-bottom: 1px solid var(--border); }
  td { padding: 9px 10px; border-bottom: 1px solid var(--grid); vertical-align: top; }
  tr:last-child td { border-bottom: 0; }
  th:first-child, td:first-child { padding-left: 0; white-space: nowrap; }
  td.n, th.n { text-align: right; white-space: nowrap; }
  td.dim { color: var(--muted); }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  .pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 9px; border-radius: 999px; font-size: 12.5px; font-weight: 500; white-space: nowrap; }
  .pill::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .pill.ok { color: var(--ok); background: color-mix(in srgb, var(--ok) 12%, transparent); }
  .pill.bad { color: var(--bad); background: color-mix(in srgb, var(--bad) 12%, transparent); }
  .pill.warn { color: var(--warn); background: color-mix(in srgb, var(--warn) 14%, transparent); }
  .pill.idle { color: var(--muted); background: color-mix(in srgb, var(--muted) 12%, transparent); }

  .legend { display: flex; gap: 16px; margin: 0 0 10px; color: var(--muted); font-size: 12.5px; }
  .key { display: inline-block; width: 10px; height: 10px; margin-right: 6px; border-radius: 3px; vertical-align: -1px; }
  svg { display: block; width: 100%; height: auto; overflow: visible; }
  svg text { fill: var(--muted); font-size: 11px; font-family: inherit; }
  svg .grid-line { stroke: var(--grid); }
  svg .a { fill: var(--accent); }
  svg .b { fill: var(--accent-2); }
  svg .line { fill: none; stroke: var(--accent); stroke-width: 2.5; stroke-linejoin: round; }
  svg .dot { fill: var(--card); stroke: var(--accent); stroke-width: 2.5; }
  svg .goal { stroke: var(--ok); stroke-dasharray: 4 4; }
  svg .goal-text { fill: var(--ok); font-weight: 600; }


  .meters { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 18px 24px; margin-bottom: 14px; }
  .meter-head { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; color: var(--muted); font-size: 12.5px; }
  .meter-head b { color: var(--text); font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .meter-head b small { color: var(--faint); font-size: 12px; font-weight: 400; }
  .meter > small { display: block; margin-top: 4px; color: var(--faint); font-size: 12px; }
  .track { height: 8px; margin-top: 6px; border-radius: 4px; background: var(--grid); overflow: hidden; }
  .track i { display: block; height: 100%; border-radius: 4px; }
  .track i.ok { background: var(--ok); } .track i.warn { background: var(--warn); } .track i.bad { background: var(--bad); }

  form { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; max-width: 520px; padding: 20px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card); }
  form label { width: 100%; color: var(--muted); font-size: 13px; }
  input { flex: 1; min-width: 200px; padding: 9px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); font: inherit; }
  input:focus { outline: 2px solid color-mix(in srgb, var(--accent) 50%, transparent); outline-offset: 1px; }
  button { padding: 9px 16px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font: 600 14px inherit; cursor: pointer; }
  .err { width: 100%; color: var(--bad); font-size: 13px; }
  button.run { padding: 4px 12px; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: var(--accent); font: 500 13px inherit; cursor: pointer; white-space: nowrap; }
  button.run:hover:not(:disabled) { border-color: var(--accent); }
  button.run:disabled { color: var(--muted); cursor: default; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>Vorax analytics</h1>
      <p class="sub">Boards shared by the Solver and Vorax Overlay. Players are counted per day: the collector keeps no lasting ID of anyone.</p>
    </div>
    <span class="live" id="updated" hidden></span>
  </header>
  <form id="login" hidden>
    <label for="pw">Dashboard password</label>
    <input id="pw" type="password" autocomplete="current-password" required>
    <button type="submit">Open</button>
    <span class="err" id="err" role="alert"></span>
  </form>
  <div id="out" hidden>
    <div class="kpis" id="tiles"></div>
    <div class="grid">
      <section class="card">
        <h2>Automation health</h2>
        <p class="sub">The repo's loops: on GitHub, and the nightly jobs on the PC. Late: a loop hasn't run in 2.5 times its interval.</p>
        <div class="scroll" id="health"><p class="sub">Reading GitHub…</p></div>
      </section>
      <section class="card">
        <h2>Since each release</h2>
        <p class="sub">The average final score of the last 100 finished games, every few games: a release that breaks something shows as a drop after its line. 100 games say it within about ±60k, so small changes hide in the noise; the table below has each release's own games and margin. Read unsure and corrected count boards from Oct 25. The dashed line is 840k.</p>
        <div id="rolling"></div>
        <div class="scroll" id="releases"></div>
      </section>
      <section class="card half">
        <h2>Games and players per day</h2>
        <p class="sub">Players: different devices that day.</p>
        <p class="legend"><span><i class="key" style="background:var(--accent)"></i>Games</span><span><i class="key" style="background:var(--accent-2)"></i>Players</span></p>
        <div id="days"></div>
      </section>
      <section class="card half">
        <h2>Median final score per day</h2>
        <p class="sub">Games that finished that day (reached the round-13 Surgical Protocol), with round 13's last instrument effects. The median, so a few huge games don't pull it up. The dashed line is 840k: rainbow with the battle bonus.</p>
        <div id="scores"></div>
      </section>
      <section class="card">
        <h2>Smarter player</h2>
        <p class="sub">Each run trains a challenger and plays it against the current player on 240 games that are the same every run. It ships only if it clearly wins.</p>
        <div class="scroll" id="smarter"></div>
      </section>
      <section class="card" id="usage-card" hidden>
        <h2>Free plan usage</h2>
        <p class="sub" id="usage-sub"></p>
        <div id="usage"></div>
      </section>
      <section class="card">
        <h2>Cards read unsure</h2>
        <p class="sub">Each card on the boards shared from Oct 26: how many it was offered on, how many the reader wasn't sure of it on, and how many a player corrected a slot to it (it was misread as something else). The most unsure and corrected first: the cards to get more pictures of. A board is shared again on a reroll or a recheck, so a hand can count more than once.</p>
        <div class="scroll" id="cards"></div>
      </section>
    </div>
  </div>
</main>
<script>
const KEY = 'vorax.dashboard'
// the private repo's files and run lists, through the collector (worker/src/schedule.ts), with the password
const fromRepo = async name => {
  const r = await fetch('/v1/repo/' + name, { headers: { authorization: 'Bearer ' + password }, cache: 'no-store' })
  if (!r.ok) throw new Error(r.status)
  return (await r.text()).split('\\n').filter(Boolean).map(l => JSON.parse(l))
}
const $ = id => document.getElementById(id)
const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const pct = x => Math.round(100 * x) + '%'
const k = v => Math.round(v / 1000) + 'k'
const num = v => Math.round(v).toLocaleString('en-US')
// cells are escaped unless given as { html }
const cell = c => (c && typeof c === 'object' && 'html' in c ? c.html : esc(c))
const table = (head, rows, right = []) => '<table><thead><tr>' + head.map((h, i) => '<th' + (right.includes(i) ? ' class="n"' : '') + '>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map((c, i) => '<td' + (right.includes(i) ? ' class="n"' : '') + '>' + cell(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>'
// a long list, a page at a time: the newest rows first
const PAGE = 10
const pages = {}
function paged(id, head, rows, right) {
  pages[id] = { head, rows, right, at: 0 }
  drawPage(id)
}
function drawPage(id) {
  const p = pages[id]
  const n = Math.max(1, Math.ceil(p.rows.length / PAGE))
  p.at = Math.min(Math.max(0, p.at), n - 1)
  const button = (step, text, on) => '<button type="button" data-page="' + id + '" data-step="' + step + '"' + (on ? '' : ' disabled') + '>' + text + '</button>'
  $(id).innerHTML = table(p.head, p.rows.slice(p.at * PAGE, (p.at + 1) * PAGE), p.right)
    + (n > 1 ? '<div class="pager">' + button(-1, 'Previous', p.at > 0) + '<span>Page ' + (p.at + 1) + ' of ' + n + '</span>' + button(1, 'Next', p.at < n - 1) + '</div>' : '')
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-page]')
  if (!b) return
  pages[b.dataset.page].at += Number(b.dataset.step)
  drawPage(b.dataset.page)
})
const pill = (kind, text) => '<span class="pill ' + kind + '">' + esc(text) + '</span>'

// A chart frame: gridlines at a few round values, labels on the left, days along the bottom.
function frame(w, h, top, fmt) {
  let s = ''
  for (let i = 0; i <= 4; i++) {
    const v = (top * i) / 4, y = h - 24 - (v / top) * (h - 40)
    s += '<line class="grid-line" x1="40" x2="' + w + '" y1="' + y + '" y2="' + y + '"/><text x="0" y="' + (y + 4) + '">' + fmt(v) + '</text>'
  }
  return s
}

function bars(days) {
  if (!days.length) return '<p class="sub">No games yet.</p>'
  const w = 560, h = 200, top = Math.max(4, ...days.map(d => Math.max(d.games, d.players)))
  const slot = (w - 50) / days.length, bw = Math.min(18, slot / 2 - 3)
  const x = i => 48 + i * slot + (slot - 2 * bw - 3) / 2
  const y = v => h - 24 - (v / top) * (h - 40)
  let s = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Games and players per day">' + frame(w, h, top, v => Math.round(v))
  days.forEach((d, i) => {
    s += '<rect class="a" rx="3" x="' + x(i) + '" y="' + y(d.games) + '" width="' + bw + '" height="' + Math.max(0, h - 24 - y(d.games)) + '"><title>' + d.day + ': ' + d.games + ' games</title></rect>'
    s += '<rect class="b" rx="3" x="' + (x(i) + bw + 3) + '" y="' + y(d.players) + '" width="' + bw + '" height="' + Math.max(0, h - 24 - y(d.players)) + '"><title>' + d.day + ': ' + d.players + ' players</title></rect>'
    s += '<text x="' + (x(i) + bw) + '" y="' + (h - 6) + '" text-anchor="middle">' + d.day.slice(5) + '</text>'
  })
  return s + '</svg>'
}

function scoreChart(days) {
  const pts = days.filter(d => d.medianFinal !== null)
  if (!pts.length) return '<p class="sub">No finished games yet. Every game’s final board is shared from 2026-10-19, so this fills in as people play.</p>'
  const w = 560, h = 200, top = Math.max(1200000, ...pts.map(d => d.medianFinal)) * 1.05
  const x = i => 60 + (pts.length === 1 ? (w - 80) / 2 : (i * (w - 80)) / (pts.length - 1))
  const y = v => h - 24 - (v / top) * (h - 40)
  let s = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Median final score per day">' + frame(w, h, top, k)
  s += '<line class="goal" x1="40" x2="' + w + '" y1="' + y(840000) + '" y2="' + y(840000) + '"/><text class="goal-text" x="' + (w - 4) + '" y="' + (y(840000) - 6) + '" text-anchor="end">840k</text>'
  if (pts.length > 1) s += '<polyline class="line" points="' + pts.map((d, i) => x(i) + ',' + y(d.medianFinal)).join(' ') + '"/>'
  pts.forEach((d, i) => {
    s += '<circle class="dot" r="4.5" cx="' + x(i) + '" cy="' + y(d.medianFinal) + '"><title>' + d.day + ': ' + num(d.medianFinal) + ' median of ' + d.finished + ' finished</title></circle>'
    s += '<text x="' + x(i) + '" y="' + (y(d.medianFinal) - 12) + '" text-anchor="middle">' + k(d.medianFinal) + ' · ' + d.finished + '</text>'
    s += '<text x="' + x(i) + '" y="' + (h - 6) + '" text-anchor="middle">' + d.day.slice(5) + '</text>'
  })
  return s + '</svg>'
}

// The last 100 finished games' average, a point every few games, with a line where each listed release's games start.
function rollingChart(points, releases) {
  if (!points || points.length < 2) return '<p class="sub">This fills in once 100 games have finished.</p>'
  // zoomed to where the averages move, 100k steps, with 840k always in view
  const vals = points.map(p => p.average).concat([840000])
  const lo = Math.floor((Math.min(...vals) - 50000) / 100000) * 100000, hi = Math.ceil((Math.max(...vals) + 50000) / 100000) * 100000
  const w = 1100, h = 240
  const x = i => 48 + (i * (w - 60)) / (points.length - 1)
  const y = v => h - 24 - ((v - lo) / (hi - lo)) * (h - 40)
  let s = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Average final score of the last 100 finished games">'
  for (let v = lo; v <= hi; v += 100000) s += '<line class="grid-line" x1="40" x2="' + w + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text x="0" y="' + (y(v) + 4) + '">' + k(v) + '</text>'
  s += '<line class="goal" x1="40" x2="' + w + '" y1="' + y(840000) + '" y2="' + y(840000) + '"/><text class="goal-text" x="' + (w - 4) + '" y="' + (y(840000) - 6) + '" text-anchor="end">840k</text>'
  // a release's line: the first point at or after its first game, labelled for the newest few
  // a release's line: the first point at or after its first game; named when 100 of its games have finished (hover
  // names the others)
  const marks = (releases || []).filter(r => r.first > points[0].start).map(r => ({ r, i: points.findIndex(p => p.start >= r.first) })).filter(m => m.i > 0)
  let named = 0
  marks.forEach(m => {
    s += '<line class="grid-line" style="stroke-dasharray:2 3" x1="' + x(m.i) + '" x2="' + x(m.i) + '" y1="16" y2="' + (h - 24) + '"><title>' + esc(m.r.version) + ' from ' + m.r.first.replace('T', ' ').slice(5, 16) + ', ' + num(m.r.finished) + ' finished</title></line>'
    if (m.r.finished >= 100) s += '<text x="' + (x(m.i) + 3) + '" y="' + (12 + 11 * (named++ % 2)) + '">' + esc(m.r.version.slice(0, 7)) + '</text>'
  })
  s += '<polyline class="line" points="' + points.map((p, i) => x(i) + ',' + y(p.average)).join(' ') + '"/>'
  points.forEach((p, i) => {
    s += '<circle class="dot" r="2.5" cx="' + x(i) + '" cy="' + y(p.average) + '"><title>' + p.start.replace('T', ' ').slice(5, 16) + ' (' + esc(p.version) + '): ' + num(p.average) + ' average, ' + pct(p.reached) + ' reached 840k, of the last 100</title></circle>'
  })
  const last = points[points.length - 1]
  s += '<text x="' + (w - 4) + '" y="' + (h - 6) + '" text-anchor="end">Now: ' + k(last.average) + ' · ' + pct(last.reached) + ' reached 840k</text>'
  return s + '</svg>'
}

// The repo's automated loops. On GitHub: its list of workflow runs. On the PC (scripts/nightly.sh, started by hand
// after the evening reminder): the outcomes it adds to data/live/nightly.jsonl.
// every: how often it should run, in hours (null: only when something triggers it); late after 2.5x that.
const LOOPS = [
  { job: 'live-data', name: 'Odds from live data', every: 24 },
  { job: 'daily-check', name: 'Daily check (simulation)', every: 24 },
  { job: 'smarter-player', name: 'Smarter player (nightly learning)', every: 24 },
  { file: 'dashboard.yml', name: 'Dashboard numbers', every: 2 },
  { file: 'issue-fixer.yml', name: 'Issue fixer', every: 24 },
  { file: 'deploy.yml', name: 'Website deploy', every: null },
  { file: 'desktop.yml', name: 'Windows app release', every: null, noRun: true },
]
let password = ''
const ago = t => {
  const m = Math.round((Date.now() - new Date(t)) / 60000)
  return m < 60 ? m + ' min ago' : m < 48 * 60 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'
}
async function health() {
  const nightly = fromRepo('nightly').catch(() => null)
  const rows = await Promise.all(LOOPS.map(async l => {
    const every = { html: '<span class="sub">' + (l.job ? 'nightly, on the PC' : l.every ? 'every ' + (l.every === 1 ? 'hour' : l.every < 24 ? l.every + ' hours' : 'day') : 'when needed') + '</span>' }
    const late = t => l.every && Date.now() - new Date(t) > l.every * 2.5 * 3600000
    if (l.job) {
      const all = await nightly
      if (!all) return [l.name, { html: pill('idle', 'Unknown') }, { html: '<span class="sub">The repo couldn’t be read</span>' }, '', every, runButton(l)]
      const runs = all.filter(x => x.job === l.job).reverse()
      const last = runs[0], good = runs.find(x => x.result !== 'failure')
      let state = pill('ok', 'Healthy')
      if (!last) state = pill('idle', 'Not run yet')
      else if (last.result === 'failure') state = pill('bad', 'Failing')
      else if (late(last.started)) state = pill('warn', 'Late')
      const lastCell = last ? ago(last.started) + ' <span class="sub">· ' + esc(last.result) + (last.note ? ': ' + esc(last.note) : '') + ' · ' + last.minutes + ' min</span>' : '<span class="sub">–</span>'
      return [l.name, { html: state }, { html: lastCell }, good ? ago(good.started) : '–', every, runButton(l)]
    }
    try {
      const r = await fetch('/v1/runs/' + l.file, { headers: { authorization: 'Bearer ' + password }, cache: 'no-store' })
      if (!r.ok) throw new Error(r.status)
      const runs = (await r.json()).workflow_runs
      const last = runs[0], good = runs.find(x => x.conclusion === 'success')
      let state = pill('ok', 'Healthy')
      if (!last) state = pill('idle', 'Not run yet')
      else if (last.status !== 'completed') state = pill('warn', 'Running')
      else if (last.conclusion !== 'success') state = pill('bad', 'Failing')
      else if (late(last.created_at)) state = pill('warn', 'Late')
      const lastCell = last ? '<a href="' + esc(last.html_url) + '" target="_blank" rel="noopener">' + ago(last.created_at) + '</a> <span class="sub">· ' + esc(last.status === 'completed' ? last.conclusion : last.status) + '</span>' : '<span class="sub">–</span>'
      return [l.name, { html: state }, { html: lastCell }, good ? ago(good.created_at) : '–', every, runButton(l)]
    } catch (e) {
      return [l.name, { html: pill('idle', 'Unknown') }, { html: '<span class="sub">GitHub didn’t answer</span>' }, '', every, runButton(l)]
    }
  }))
  $('health').innerHTML = table(['Loop', 'Status', 'Last run', 'Last success', 'Runs', ''], rows)
}
const runButton = l => ({ html: l.job ? '<span class="sub">bash scripts/nightly.sh</span>' : l.noRun ? '<span class="sub">needs a version tag</span>' : '<button type="button" class="run" data-run="' + l.file + '">Run now</button>' })
// Run now: the collector asks GitHub to start the workflow; the table refreshes once GitHub lists it
document.addEventListener('click', async e => {
  const b = e.target.closest && e.target.closest('button[data-run]')
  if (!b) return
  b.disabled = true
  b.textContent = 'Starting…'
  try {
    const r = await fetch('/v1/run/' + b.dataset.run, { method: 'POST', headers: { authorization: 'Bearer ' + password } })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(body.error || ('The collector answered ' + r.status))
    b.textContent = 'Started'
    setTimeout(() => void health(), 6000)
  } catch (err) {
    b.textContent = 'Failed'
    b.title = err.message
    const note = document.createElement('div')
    note.className = 'err'
    note.textContent = err.message
    b.after(note)
  }
})

// The free plans' use (scripts/live/usage.ts): today's share of each limit, amber from 70%, red from 90%, then
// the last days. Cloudflare counts per UTC day.
const mb = v => Math.round(v / 1e6) + ' MB'
function usage(u) {
  if (!u) return
  const meter = (label, used, limit, fmt, note) => {
    const share = limit ? used / limit : 0
    const kind = share >= 0.9 ? 'bad' : share >= 0.7 ? 'warn' : 'ok'
    return '<div class="meter"><div class="meter-head"><span>' + esc(label) + '</span><b>' + esc(fmt(used)) + ' <small>of ' + esc(fmt(limit)) + '</small></b></div>'
      + '<div class="track"><i class="' + kind + '" style="width:' + Math.min(100, Math.max(1, Math.round(100 * share))) + '%"></i></div><small>' + esc(note) + '</small></div>'
  }
  const L = u.limits, cf = u.cloudflare, gh = u.github
  let s = '<div class="meters">'
  const today = cf && cf[cf.length - 1]
  if (today) {
    // the database grows by about its last day's growth each day: when it would be full at that rate
    const before = cf.length > 1 ? cf[cf.length - 2].bytes : today.bytes
    const grow = today.bytes - before
    const full = grow > 0 ? Math.floor((L.bytes - today.bytes) / grow) : null
    s += meter('Rows written', today.rowsWritten, L.rowsWritten, num, 'D1 today, resets 00:00 UTC. Past the limit, uploads wait in the players’ Solvers.')
      + meter('Rows read', today.rowsRead, L.rowsRead, num, 'D1 today, resets 00:00 UTC')
      + meter('Requests', today.requests, L.requests, num, 'the collector Worker today, resets 00:00 UTC')
      + meter('Database', today.bytes, L.bytes, mb, (grow > 0 ? '+' + mb(grow) + ' since yesterday' : 'not growing') + (full !== null ? ' · full in about ' + full + ' day' + (full === 1 ? '' : 's') + ' at that rate' : ''))
  } else s += '<p class="sub">Cloudflare usage isn’t set up or didn’t answer (CF_ANALYTICS_TOKEN).</p>'
  if (gh) {
    const runners = Object.entries(gh.runners).map(([k, v]) => k.replace(/^actions[_ ]/i, '').replace(/^./, c => c.toUpperCase()) + ' ' + Math.round(v)).join(' · ')
    s += meter('Actions minutes', gh.minutes, L.minutes, num, 'GitHub this month, this repo: ' + (runners || 'no runs yet') + ' · Windows counts twice' + (gh.others ? ' · ' + num(gh.others) + ' more in other repos' : '') + (gh.charged ? ' · charged $' + gh.charged.toFixed(2) : ''))
  } else s += '<p class="sub">GitHub usage isn’t set up or didn’t answer (GH_BILLING_TOKEN).</p>'
  s += '</div>'
  if (cf && cf.length > 1) s += '<div class="scroll">' + table(['Day (UTC)', 'Rows written', 'Rows read', 'Requests', 'Database'], cf.slice().reverse().map(d => [d.day, num(d.rowsWritten), num(d.rowsRead), num(d.requests), mb(d.bytes)]), [1, 2, 3, 4]) + '</div>'
  $('usage').innerHTML = s
  $('usage-sub').textContent = 'Checked ' + u.checked.replace('T', ' ').slice(0, 16) + ' UTC, every 2 hours. Free limits: Cloudflare D1 and Workers per day, GitHub minutes per month.'
  $('usage-card').hidden = false
}

async function load(pw) {
  password = pw
  const r = await fetch('/v1/stats', { headers: { authorization: 'Bearer ' + pw } })
  if (r.status === 401) throw new Error('Wrong password.')
  if (!r.ok) throw new Error('The collector answered ' + r.status + '.')
  const s = await r.json()
  const appGames = s.days.reduce((n, d) => n + d.app, 0)
  const f = s.finished
  $('tiles').innerHTML = [
    ['Games shared', num(s.totals.games), s.totals.boards + ' boards read'],
    ['Players today', num(s.totals.playersToday), 'different devices'],
    ['Players ever', s.totals.countedSince ? num(s.totals.playersEver) : '–', (s.totals.countedSince ? 'since ' + s.totals.countedSince + ' · ' : '') + num(s.totals.playerDays) + ' player-days in all'],
    ['Median final score', f.games ? k(f.median) : '–', f.games ? 'average counted to 840k: ' + k(f.capped) + ' · ' + f.games + ' finished' : 'no finished games'],
    ['Reached 840k', f.games ? pct(f.reached / f.games) : '–', 'of finished games'],
    ['In Vorax Overlay', pct(s.totals.games ? appGames / s.totals.games : 0), 'of games'],
    ['Corrected by hand', pct(s.corrected), 'of boards'],
    ['Read unsure', pct(s.unsure), 'of boards'],
  ].map(([label, value, note]) => '<div class="kpi"><span>' + esc(label) + '</span><b>' + esc(value) + '</b><small>' + esc(note) + '</small></div>').join('')
  $('updated').textContent = 'Updated ' + s.generated.replace('T', ' ').slice(0, 16) + ' UTC'
  $('updated').hidden = false
  void health()
  usage(s.usage)
  $('days').innerHTML = bars(s.days)
  $('scores').innerHTML = scoreChart(s.days)
  $('rolling').innerHTML = rollingChart(s.rolling, s.releases)
  // the newest 20 releases, 10 a page
  if (s.releases && s.releases.length) paged('releases', ['Release', 'First game (UTC)', 'Finished', 'Average', 'Reached 840k', 'Read unsure', 'Corrected'], s.releases.slice(0, 20).map(r => [
        r.version, r.first.replace('T', ' ').slice(0, 16), num(r.finished),
        r.finished ? k(r.average) + (r.finished > 1 ? ' ± ' + k(r.margin) : '') : '–', r.finished ? pct(r.reached) : '–',
        r.boards ? pct(r.unsure / r.boards) : '–', r.boards ? pct(r.corrected / r.boards) : '–',
      ]), [2, 3, 4, 5, 6])
  else $('releases').innerHTML = ''
  if (s.cards && s.cards.length) paged('cards', ['Card', 'Offered', 'Unsure', 'Share unsure', 'Corrected to it'], s.cards.map(c => [c.name, num(c.shown), num(c.unsure), c.shown ? pct(c.unsure / c.shown) : '–', num(c.corrected)]), [1, 2, 3, 4])
  else $('cards').innerHTML = '<p class="sub">No boards with their cards yet.</p>'
  try {
    const h = (await fromRepo('smarter')).filter(e => e.fixed).reverse()
    // reached 840k on the fixed games: "166 (69%)"
    const hit = (x, n) => x.reached + ' (' + pct(x.reached / n) + ')'
    const signed = (v, unit) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v) + unit
    if (h.length) {
      const now = h[0]
      $('smarter').innerHTML = '<p class="lead">The current player reaches 840k in <b>' + hit(now.pass ? now.fixed.challenger : now.fixed.shipped, now.fixed.games) + '</b> of the ' + now.fixed.games + ' fixed games.</p><div id="smarter-runs"></div>'
      paged('smarter-runs', ['Date', 'Current player', 'Challenger', 'Difference', 'Result'], h.map(e => {
        const n = e.fixed.games, a = e.fixed.shipped, b = e.fixed.challenger
        return [e.date, hit(a, n), hit(b, n), signed(b.reached - a.reached, ' games') + ' · avg ' + signed(Math.round((b.average - a.average) / 1000), 'k'), { html: e.pass ? pill('ok', 'Shipped') : pill('idle', 'Kept current') }]
      }), [1, 2, 3])
    } else $('smarter').innerHTML = '<p class="sub">No runs yet.</p>'
  } catch (e) {
    $('smarter').innerHTML = '<p class="sub">The smarter player’s history couldn’t be read from the repo.</p>'
  }
  $('login').hidden = true
  $('out').hidden = false
}

async function start(pw) {
  try {
    await load(pw)
    try { localStorage.setItem(KEY, pw) } catch (e) {}
  } catch (e) {
    try { localStorage.removeItem(KEY) } catch (x) {}
    $('login').hidden = false
    $('err').textContent = e.message
  }
}
$('login').addEventListener('submit', e => { e.preventDefault(); $('err').textContent = ''; start($('pw').value) })
let saved = null
try { saved = localStorage.getItem(KEY) } catch (e) {}
if (saved) start(saved); else $('login').hidden = false
</script>
</body>
</html>
`
