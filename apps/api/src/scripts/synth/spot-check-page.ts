/**
 * The single page served by `synth spot-check --ui`: no build step, no
 * external assets. All text from the API is escaped before it is rendered.
 */
export const SPOT_CHECK_PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spot-check</title>
<style>
  :root {
    --bg: #f6f6f4; --panel: #ffffff; --text: #1d1d1b; --muted: #6b6b66;
    --line: #e2e1dc; --accent: #2f5bd3;
    --strong: #1f8a4c; --partial: #c27c0e; --weak: #c23b3b;
    --strong-bg: #e3f3e9; --partial-bg: #fbf0dc; --weak-bg: #f9e3e3;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #161615; --panel: #1f1f1d; --text: #ecebe6; --muted: #9b9a93;
      --line: #33332f; --accent: #7b9cf5;
      --strong: #4cc47f; --partial: #e6a63a; --weak: #ec6b6b;
      --strong-bg: #1d3326; --partial-bg: #3a2e17; --weak-bg: #3b1f1f;
    }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    display: grid; grid-template-rows: auto 1fr auto; height: 100vh;
  }
  header {
    display: flex; align-items: center; gap: 16px; padding: 10px 16px;
    border-bottom: 1px solid var(--line); background: var(--panel);
  }
  header h1 { font-size: 15px; margin: 0; font-weight: 600; }
  .progress { flex: 1; display: flex; align-items: center; gap: 10px; color: var(--muted); }
  .bar { flex: 1; max-width: 320px; height: 6px; background: var(--line); border-radius: 3px; overflow: hidden; }
  .bar > div { height: 100%; background: var(--accent); width: 0; transition: width .2s; }
  .save-state { color: var(--muted); font-size: 12px; min-width: 70px; text-align: right; }
  button {
    font: inherit; border: 1px solid var(--line); background: var(--panel); color: var(--text);
    border-radius: 6px; padding: 6px 12px; cursor: pointer;
  }
  button:hover:not(:disabled) { border-color: var(--muted); }
  button:disabled { opacity: .45; cursor: not-allowed; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .layout { display: grid; grid-template-columns: 150px 1fr; min-height: 0; }
  nav { border-right: 1px solid var(--line); overflow-y: auto; padding: 8px; background: var(--panel); }
  nav button {
    display: flex; width: 100%; align-items: center; justify-content: space-between;
    border: 0; padding: 5px 8px; margin-bottom: 2px; text-align: left; background: transparent;
  }
  nav button.current { background: var(--bg); font-weight: 600; }
  .dot { width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid var(--line); }
  .dot.strong { background: var(--strong); border-color: var(--strong); }
  .dot.partial { background: var(--partial); border-color: var(--partial); }
  .dot.weak { background: var(--weak); border-color: var(--weak); }
  .dot.noted { box-shadow: 0 0 0 2px var(--panel), 0 0 0 3px var(--muted); }
  main { display: grid; grid-template-columns: 1fr 1fr; min-height: 0; }
  section { overflow-y: auto; padding: 16px 20px 24px; min-width: 0; }
  section + section { border-left: 1px solid var(--line); }
  .label { text-transform: uppercase; letter-spacing: .06em; font-size: 11px; color: var(--muted); margin-bottom: 4px; }
  h2 { font-size: 18px; margin: 0 0 12px; }
  h4 { margin: 14px 0 4px; font-size: 13px; }
  .md p { margin: 6px 0; }
  .md ul { margin: 4px 0; padding-left: 20px; }
  .md ul ul { margin: 2px 0; }
  .md em.section { display: block; font-style: normal; font-weight: 600; margin-top: 14px; color: var(--muted);
    text-transform: uppercase; letter-spacing: .05em; font-size: 11px; }
  .github { margin-top: 18px; padding-top: 12px; border-top: 1px dashed var(--line); }
  .tabs { display: flex; gap: 4px; margin-bottom: 12px; }
  .tabs button { padding: 3px 10px; font-size: 12px; }
  .tabs button.on { background: var(--bg); border-color: var(--muted); }
  iframe { width: 100%; height: calc(100vh - 220px); border: 1px solid var(--line); border-radius: 6px; background: #fff; }
  footer {
    display: flex; gap: 12px; align-items: center; padding: 10px 16px;
    border-top: 1px solid var(--line); background: var(--panel);
  }
  footer input {
    flex: 1; font: inherit; padding: 7px 10px; border: 1px solid var(--line); border-radius: 6px;
    background: var(--bg); color: var(--text);
  }
  .bands { display: flex; gap: 6px; }
  .bands button { min-width: 96px; }
  .bands kbd { font: 11px ui-monospace, monospace; color: var(--muted); margin-right: 6px; }
  .bands button.strong.on { background: var(--strong-bg); border-color: var(--strong); color: var(--strong); font-weight: 600; }
  .bands button.partial.on { background: var(--partial-bg); border-color: var(--partial); color: var(--partial); font-weight: 600; }
  .bands button.weak.on { background: var(--weak-bg); border-color: var(--weak); color: var(--weak); font-weight: 600; }
  .hint { color: var(--muted); font-size: 12px; white-space: nowrap; }
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: none; align-items: flex-start; justify-content: center; padding: 40px 16px; overflow-y: auto; }
  .overlay.open { display: flex; }
  .dialog { background: var(--panel); border-radius: 10px; padding: 20px 24px; max-width: 820px; width: 100%; }
  .dialog h3 { margin: 0 0 12px; }
  .stats { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
  .stat { border: 1px solid var(--line); border-radius: 8px; padding: 8px 14px; min-width: 140px; }
  .stat b { display: block; font-size: 22px; }
  .stat.pass b { color: var(--strong); } .stat.fail b { color: var(--weak); }
  table { border-collapse: collapse; margin-bottom: 16px; }
  td, th { border: 1px solid var(--line); padding: 4px 12px; text-align: right; }
  th:first-child, td:first-child { text-align: left; }
  td.diag { font-weight: 700; }
  .disagreement { border-top: 1px solid var(--line); padding: 10px 0; }
  .disagreement ul { margin: 6px 0 0; padding-left: 20px; color: var(--muted); font-size: 13px; }
  .error { color: var(--weak); }
  @media (max-width: 900px) {
    .layout { grid-template-columns: 1fr; }
    nav { display: none; }
    main { grid-template-columns: 1fr; overflow-y: auto; }
    section + section { border-left: 0; border-top: 1px solid var(--line); }
    section { overflow: visible; }
    footer { flex-wrap: wrap; }
    .hint { display: none; }
  }
</style>
</head>
<body>
<header>
  <h1>Spot-check</h1>
  <div class="progress"><span id="count">…</span><div class="bar"><div id="bar"></div></div></div>
  <span class="save-state" id="save"></span>
  <button id="score" class="primary" disabled>Score</button>
</header>
<div class="layout">
  <nav id="nav"></nav>
  <main>
    <section>
      <div class="label">Vacancy</div>
      <h2 id="v-title"></h2>
      <div class="md" id="v-body"></div>
    </section>
    <section>
      <div class="tabs"><span class="label" style="margin:4px 8px 0 0">Candidate</span>
        <button id="tab-text" class="on">Text</button><button id="tab-pdf">PDF</button></div>
      <div id="c-text"><div class="md" id="c-body"></div><div class="md github" id="c-github"></div></div>
      <div id="c-pdf" hidden><iframe id="pdf" title="CV PDF"></iframe></div>
    </section>
  </main>
</div>
<footer>
  <button id="prev" title="Previous (←)">←</button>
  <span id="pair-no" style="min-width:64px;font-weight:600"></span>
  <input id="note" placeholder="Note (optional) — press N to focus" maxlength="2000">
  <div class="bands">
    <button class="strong" data-band="strong"><kbd>1</kbd>Strong</button>
    <button class="partial" data-band="partial"><kbd>2</kbd>Partial</button>
    <button class="weak" data-band="weak"><kbd>3</kbd>Weak</button>
  </div>
  <button id="next" title="Next (→)">→</button>
  <span class="hint">1/2/3 label + next · ←/→ move · P PDF</span>
</footer>
<div class="overlay" id="overlay"><div class="dialog" id="dialog"></div></div>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Just enough Markdown for the blind renderers: bullets (nested by two
  // spaces), **bold**, whole-line _section_ labels, and a plain line
  // directly above a list as a subheading.
  function md(text) {
    const lines = text.split('\n');
    let html = '';
    let depth = 0;
    const close = (to) => { while (depth > to) { html += '</ul>'; depth--; } };
    lines.forEach((line, i) => {
      const m = /^(\s*)- (.*)$/.exec(line);
      if (m) {
        const level = Math.floor(m[1].length / 2) + 1;
        while (depth < level) { html += '<ul>'; depth++; }
        close(level);
        html += '<li>' + inline(m[2]) + '</li>';
        return;
      }
      close(0);
      if (!line.trim()) return;
      const section = /^_(.+)_$/.exec(line.trim());
      if (section) { html += '<em class="section">' + esc(section[1]) + '</em>'; return; }
      if (/^\s*- /.test(lines[i + 1] || '') && line.length < 60) { html += '<h4>' + inline(line) + '</h4>'; return; }
      html += '<p>' + inline(line) + '</p>';
    });
    close(0);
    return html;
  }

  let pairs = [];
  let labels = new Map();
  let index = 0;
  let view = 'text';
  let noteTimer = null;

  const done = () => [...labels.values()].filter((l) => l.band).length;

  function renderNav() {
    $('nav').innerHTML = pairs.map((p, i) => {
      const l = labels.get(p.pair);
      const cls = ['dot', l.band || '', l.note ? 'noted' : ''].join(' ');
      return '<button data-i="' + i + '" class="' + (i === index ? 'current' : '') + '">Pair ' + p.pair +
        '<span class="' + cls + '" title="' + esc(l.band || 'unlabelled') + '"></span></button>';
    }).join('');
    const n = done();
    $('count').textContent = n + ' / ' + pairs.length + ' labelled';
    $('bar').style.width = (100 * n / pairs.length) + '%';
    $('score').disabled = n !== pairs.length;
  }

  function renderPair() {
    const p = pairs[index];
    const l = labels.get(p.pair);
    $('pair-no').textContent = 'Pair ' + p.pair;
    $('v-title').textContent = p.vacancyTitle;
    $('v-body').innerHTML = md(p.vacancyText);
    $('c-body').innerHTML = md(p.cvMarkdown);
    $('c-github').innerHTML = p.githubMarkdown ? md(p.githubMarkdown) : '';
    $('c-github').hidden = !p.githubMarkdown;
    $('note').value = l.note;
    document.querySelectorAll('.bands button').forEach((b) => b.classList.toggle('on', b.dataset.band === l.band));
    $('prev').disabled = index === 0;
    $('next').disabled = index === pairs.length - 1;
    setView(view);
    document.querySelectorAll('main section').forEach((s) => { s.scrollTop = 0; });
    renderNav();
    try { localStorage.setItem('spot-check-index', String(index)); } catch {}
  }

  function setView(v) {
    view = v;
    $('tab-text').classList.toggle('on', v === 'text');
    $('tab-pdf').classList.toggle('on', v === 'pdf');
    $('c-text').hidden = v !== 'text';
    $('c-pdf').hidden = v !== 'pdf';
    const src = '/pdf/' + pairs[index].pair;
    if (v === 'pdf' && $('pdf').getAttribute('src') !== src) $('pdf').setAttribute('src', src);
  }

  async function save(pair, patch) {
    const current = labels.get(pair);
    const next = { ...current, ...patch };
    labels.set(pair, next);
    renderNav();
    $('save').textContent = 'Saving…';
    try {
      const res = await fetch('/api/labels/' + pair, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ band: next.band, note: next.note }),
      });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      $('save').textContent = 'Saved';
    } catch (err) {
      $('save').innerHTML = '<span class="error">Not saved: ' + esc(err.message) + '</span>';
    }
  }

  function flushNote() {
    if (noteTimer === null) return;
    clearTimeout(noteTimer);
    noteTimer = null;
    const pair = pairs[index].pair;
    const note = $('note').value;
    if (labels.get(pair).note !== note) save(pair, { note });
  }

  function go(i) {
    if (i < 0 || i >= pairs.length) return;
    flushNote();
    index = i;
    renderPair();
  }

  function pickBand(band) {
    flushNote();
    const pair = pairs[index].pair;
    save(pair, { band, note: $('note').value });
    // Move on to the next pair without a band, if any.
    const order = [...pairs.keys()].map((k) => (index + 1 + k) % pairs.length);
    const nextOpen = order.find((k) => !labels.get(pairs[k].pair).band);
    if (nextOpen !== undefined) go(nextOpen);
    else renderPair();
  }

  async function score() {
    flushNote();
    $('dialog').innerHTML = '<p>Scoring…</p>';
    $('overlay').classList.add('open');
    const res = await fetch('/api/score', { method: 'POST' });
    const a = await res.json();
    if (!res.ok) {
      $('dialog').innerHTML = '<p class="error">' + esc(a.error) + (a.missing ? ': pairs ' + esc(a.missing.join(', ')) : '') + '</p><button id="close">Close</button>';
      $('close').onclick = () => $('overlay').classList.remove('open');
      return;
    }
    const pct = (x) => (100 * x).toFixed(1) + '%';
    const pass = a.kappa >= 0.6;
    const rows = a.bands.map((b, i) => '<tr><th>' + b + '</th>' + a.confusion[i].map((n, j) => '<td class="' + (i === j ? 'diag' : '') + '">' + n + '</td>').join('') + '</tr>').join('');
    const dis = a.disagreements.map((d) => '<div class="disagreement"><b>Pair ' + d.pair + '</b> · ' + esc(d.vacancyId) + ' × ' + esc(d.personaId) +
      ' — rule <b>' + d.rule + '</b> (score ' + d.score + '), you <b>' + d.human + '</b>' + (d.note ? '<br><i>' + esc(d.note) + '</i>' : '') +
      '<ul>' + d.requirements.map((q) => '<li>' + esc(q.requirementId) + ': ' + esc(q.status) + (q.tag ? ' (' + esc(q.tag) + ')' : '') + (q.text ? ' — ' + esc(q.text) : '') + '</li>').join('') + '</ul></div>').join('');
    $('dialog').innerHTML =
      '<h3>Agreement with the rule</h3>' +
      '<div class="stats">' +
      '<div class="stat ' + (pass ? 'pass' : 'fail') + '"><span class="label">Cohen\'s κ</span><b>' + a.kappa.toFixed(3) + '</b>' + (pass ? 'meets ≥ 0.6' : 'below 0.6') + '</div>' +
      '<div class="stat"><span class="label">Quadratic κ</span><b>' + a.quadraticKappa.toFixed(3) + '</b></div>' +
      '<div class="stat"><span class="label">Exact agreement</span><b>' + pct(a.exactAgreement) + '</b>' + a.pairs + ' pairs</div></div>' +
      '<div class="label">Confusion (rows: rule, columns: you)</div>' +
      '<table><tr><th></th>' + a.bands.map((b) => '<th>' + b + '</th>').join('') + '</tr>' + rows + '</table>' +
      '<div class="label">Disagreements (' + a.disagreements.length + ')</div>' + (dis || '<p>None.</p>') +
      '<p style="color:var(--muted)">Written to spot-check/agreement.md and agreement.json.</p>' +
      '<button id="close">Close</button>';
    $('close').onclick = () => $('overlay').classList.remove('open');
  }

  $('nav').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (b) go(Number(b.dataset.i));
  });
  document.querySelectorAll('.bands button').forEach((b) => b.addEventListener('click', () => pickBand(b.dataset.band)));
  $('prev').onclick = () => go(index - 1);
  $('next').onclick = () => go(index + 1);
  $('tab-text').onclick = () => setView('text');
  $('tab-pdf').onclick = () => setView('pdf');
  $('score').onclick = score;
  $('note').addEventListener('input', () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { noteTimer = 0; flushNote(); }, 600);
  });
  $('note').addEventListener('blur', flushNote);
  document.addEventListener('keydown', (e) => {
    if ($('overlay').classList.contains('open')) {
      if (e.key === 'Escape') $('overlay').classList.remove('open');
      return;
    }
    if (e.target === $('note')) {
      if (e.key === 'Escape' || e.key === 'Enter') { flushNote(); $('note').blur(); }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const band = { 1: 'strong', 2: 'partial', 3: 'weak' }[e.key];
    if (band) pickBand(band);
    else if (e.key === 'ArrowRight' || e.key === 'j') go(index + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'k') go(index - 1);
    else if (e.key === 'n') { e.preventDefault(); $('note').focus(); }
    else if (e.key === 'p') setView(view === 'pdf' ? 'text' : 'pdf');
    else return;
    e.preventDefault();
  });
  window.addEventListener('beforeunload', flushNote);

  fetch('/api/sample').then((r) => r.json()).then((data) => {
    pairs = data.pairs;
    labels = new Map(data.labels.map((l) => [l.pair, { band: l.band, note: l.note || '' }]));
    let start = 0;
    try { start = Number(localStorage.getItem('spot-check-index')) || 0; } catch {}
    const firstOpen = pairs.findIndex((p) => !labels.get(p.pair).band);
    index = firstOpen >= 0 ? firstOpen : Math.min(start, pairs.length - 1);
    renderPair();
  }).catch((err) => { document.body.innerHTML = '<p class="error" style="padding:20px">Cannot load sample: ' + esc(err.message) + '</p>'; });
})();
</script>
</body>
</html>
`;
