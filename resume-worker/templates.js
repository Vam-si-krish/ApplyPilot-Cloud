/**
 * Résumé HTML templates (ADR 0024 Phase 3). Single-column, semantic, ATS-readable:
 * real selectable text, standard fonts, proper <h*> section headings, no icons or
 * text-as-image, no multi-column. Everything sizes off a single `--scale` so the
 * renderer can shrink the whole document to fit one page (see render.js).
 *
 * `renderHtml(resume, { template, scale })` → a full HTML document string.
 */

const THEMES = {
  classic: {
    bodyFont: "Georgia, 'Times New Roman', serif",
    headFont: "Georgia, 'Times New Roman', serif",
    accent: '#1a1a1a',
    rule: '#333',
    muted: '#444',
  },
  modern: {
    bodyFont: "'Helvetica Neue', Arial, 'Segoe UI', sans-serif",
    headFont: "'Helvetica Neue', Arial, 'Segoe UI', sans-serif",
    accent: '#1f4e79',
    rule: '#1f4e79',
    muted: '#555',
  },
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function contactLine(b) {
  const parts = [];
  if (b.email) parts.push(esc(b.email));
  if (b.phone) parts.push(esc(b.phone));
  if (b.location) parts.push(esc(b.location));
  if (b.url) parts.push(esc(b.url));
  for (const p of b.profiles || []) {
    if (p.url) parts.push(esc(p.url));
  }
  return parts.join('&nbsp;&nbsp;·&nbsp;&nbsp;');
}

function section(title, inner) {
  if (!inner || !inner.trim()) return '';
  return `<section><h2>${esc(title)}</h2>${inner}</section>`;
}

function workEntry(w) {
  const right = [w.startDate, w.endDate].filter(Boolean).join(' – ');
  const bullets = (w.highlights || []).filter(Boolean).map((h) => `<li>${esc(h)}</li>`).join('');
  return `
    <div class="entry">
      <div class="entry-head">
        <span class="entry-title">${esc(w.name || '')}</span>
        <span class="entry-meta">${esc(w.location || '')}</span>
      </div>
      <div class="entry-sub">
        <span class="entry-role">${esc(w.position || '')}</span>
        <span class="entry-meta">${esc(right)}</span>
      </div>
      ${bullets ? `<ul>${bullets}</ul>` : ''}
    </div>`;
}

function projectEntry(p) {
  const bullets = (p.highlights || []).filter(Boolean).map((h) => `<li>${esc(h)}</li>`).join('');
  return `
    <div class="entry">
      <div class="entry-head">
        <span class="entry-title">${esc(p.name || '')}</span>
        <span class="entry-meta">${esc(p.url || '')}</span>
      </div>
      ${p.description ? `<div class="entry-sub"><span class="entry-role">${esc(p.description)}</span></div>` : ''}
      ${bullets ? `<ul>${bullets}</ul>` : ''}
    </div>`;
}

function eduEntry(e) {
  const right = [e.startDate, e.endDate].filter(Boolean).join(' – ');
  const degree = [e.studyType, e.area].filter(Boolean).join(', ');
  return `
    <div class="entry edu">
      <div class="entry-head">
        <span class="entry-title">${esc(e.institution || '')}</span>
        <span class="entry-meta">${esc(right)}</span>
      </div>
      ${degree || e.score ? `<div class="entry-sub"><span class="entry-role">${esc(degree)}${e.score ? ` · ${esc(e.score)}` : ''}</span></div>` : ''}
    </div>`;
}

function skillsBlock(skills) {
  const rows = (skills || [])
    .filter((s) => (s.keywords || []).length)
    .map((s) => `<div class="skill-row">${s.name ? `<span class="skill-group">${esc(s.name)}:</span> ` : ''}${esc((s.keywords || []).join(', '))}</div>`)
    .join('');
  return rows;
}

export function renderHtml(resume, { template = 'classic', scale = 1 } = {}) {
  const theme = THEMES[template] || THEMES.classic;
  const b = resume.basics || {};
  const work = (resume.work || []).map(workEntry).join('');
  const projects = (resume.projects || []).map(projectEntry).join('');
  const edu = (resume.education || []).map(eduEntry).join('');
  const skills = skillsBlock(resume.skills || []);

  const body = [
    section('Summary', b.summary ? `<p class="summary">${esc(b.summary)}</p>` : ''),
    section('Experience', work),
    section('Skills', skills),
    section('Projects', projects),
    section('Education', edu),
  ].join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  :root { --scale: ${scale}; --base: calc(var(--scale) * 10.5pt); --accent: ${theme.accent}; --rule: ${theme.rule}; --muted: ${theme.muted}; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #fff; }
  body {
    font-family: ${theme.bodyFont};
    font-size: var(--base);
    line-height: 1.28;
    color: #111;
    -webkit-font-smoothing: antialiased;
  }
  .name {
    font-family: ${theme.headFont};
    font-size: 2.05em;
    font-weight: 700;
    letter-spacing: 0.2px;
    color: var(--accent);
    line-height: 1.05;
  }
  .label { font-size: 1.05em; color: var(--muted); margin-top: 0.15em; font-weight: 600; }
  .contact { font-size: 0.86em; color: var(--muted); margin-top: 0.45em; }
  header { margin-bottom: 0.65em; }
  section { margin-top: 0.65em; }
  h2 {
    font-family: ${theme.headFont};
    font-size: 0.86em;
    text-transform: uppercase;
    letter-spacing: 1.4px;
    color: var(--accent);
    border-bottom: 1.3px solid var(--rule);
    padding-bottom: 0.15em;
    margin-bottom: 0.38em;
  }
  .summary { text-align: justify; }
  .entry { margin-bottom: 0.48em; }
  .entry:last-child { margin-bottom: 0; }
  .entry-head { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5em; }
  .entry-sub { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5em; margin-top: 0.02em; }
  .entry-title { font-weight: 700; }
  .entry-role { font-style: italic; color: #222; }
  .entry-meta { font-size: 0.85em; color: var(--muted); white-space: nowrap; }
  /* Native list markers (no positioned ::before) keep the PDF text stream in
     visual order → ATS parsers read bullets under their role, not dumped at the end. */
  ul { list-style: square; margin: 0.22em 0 0 0; padding-left: 1.05em; }
  li { margin-bottom: 0.13em; padding-left: 0.15em; text-align: justify; }
  li::marker { color: var(--accent); font-size: 0.8em; }
  .skill-row { margin-bottom: 0.16em; }
  .skill-group { font-weight: 700; color: #1a1a1a; }
  .edu .entry-role { font-style: normal; }
</style>
</head>
<body>
  <header>
    <div class="name">${esc(b.name || '')}</div>
    ${b.label ? `<div class="label">${esc(b.label)}</div>` : ''}
    <div class="contact">${contactLine(b)}</div>
  </header>
  ${body}
</body>
</html>`;
}

export const TEMPLATES = Object.keys(THEMES);
