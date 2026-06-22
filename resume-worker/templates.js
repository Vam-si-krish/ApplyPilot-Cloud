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
    .map((s) => `<li>${s.name ? `<span class="skill-group">${esc(s.name)}:</span> ` : ''}${esc((s.keywords || []).join(', '))}</li>`)
    .join('');
  return rows ? `<ul class="skills">${rows}</ul>` : '';
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
    section('Technical Skills', skills),
    section('Professional Experience', work),
    section('Projects', projects),
    section('Education', edu),
  ].join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  :root { --scale: ${scale}; --accent: ${theme.accent}; --rule: ${theme.rule}; --muted: ${theme.muted}; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #fff; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    color: #1a1a1a;
    -webkit-font-smoothing: antialiased;
    text-align: left;
    zoom: var(--scale);
  }
  .name {
    font-size: 18pt;
    line-height: 20pt;
    font-weight: bold;
    text-align: center;
    color: #1a1a1a;
  }
  .label { font-size: 11pt; color: #444; text-align: center; font-weight: bold; margin-top: 2pt; }
  .contact {
    font-size: 9.5pt;
    line-height: 12pt;
    font-weight: normal;
    text-align: center;
    color: #444444;
    margin-bottom: 3pt;
  }
  header { text-align: center; margin-bottom: 0; }
  section { margin-top: 0; }
  h2 {
    font-size: 11.5pt;
    line-height: 13pt;
    font-weight: bold;
    text-align: left;
    color: #1a1a1a;
    border-bottom: 0.8pt solid #1a1a1a;
    margin-top: 1.5pt;
    padding-bottom: 0.5pt;
    margin-bottom: 2pt;
    text-transform: uppercase;
  }
  .summary { 
    font-size: 9.8pt;
    line-height: 10.3pt;
    font-weight: normal;
    text-align: left;
    margin-bottom: 0.5pt;
  }
  .entry { margin-bottom: 0.5pt; }
  .entry-head { display: flex; justify-content: space-between; align-items: baseline; padding-top: 1pt; gap: 0.5em; }
  .entry-sub { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5em; }
  .entry-title { font-size: 10.5pt; line-height: 13pt; font-weight: bold; color: #1a1a1a; }
  .entry-role { font-size: 10.5pt; line-height: 13pt; font-weight: bold; color: #1a1a1a; font-style: normal; }
  .entry-meta { font-size: 10pt; line-height: 13pt; font-weight: bold; color: #444444; white-space: nowrap; }
  ul { list-style: disc; margin: 0; padding-left: 12pt; }
  li {
    font-size: 9.5pt;
    line-height: 9.5pt;
    margin-bottom: 1.2pt;
    padding-left: 1pt;
    text-align: left;
  }
  li::marker { color: #1a1a1a; }
  ul.skills { margin-top: 0; }
  ul.skills li { font-size: 9.8pt; line-height: 10.4pt; margin-bottom: 0.4pt; padding-left: 1pt; }
  .skill-group { font-weight: bold; color: #1a1a1a; }
  .edu { padding-top: 0.8pt; padding-bottom: 0.8pt; }
  .edu .entry-title { font-size: 9.8pt; line-height: 10.3pt; font-weight: bold; }
  .edu .entry-role { font-size: 9.8pt; font-weight: normal; }
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
