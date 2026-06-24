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

/** Add a scheme to a bare URL/handle ("linkedin.com/in/x") so it's a valid clickable link. */
function href(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
  return `https://${s.replace(/^\/+/, '')}`;
}

/** Compact display text for a URL — drop the scheme and any trailing slash. */
function urlText(raw) {
  return String(raw ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/** A real anchor (clickable in the PDF), styled to read as plain résumé text. */
function link(url, text) {
  return `<a href="${esc(href(url))}">${esc(text ?? urlText(url))}</a>`;
}

/**
 * True only when the value can become a real link: it has a scheme, or it looks
 * like a domain (contains a dot, e.g. linkedin.com/in/you). Guards against an
 * incomplete value like a bare "portfolio" rendering as a broken https://portfolio.
 */
function linkable(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  if (/^(https?:|mailto:|tel:)/i.test(s)) return true;
  return /\.[a-z]{2,}/i.test(s);
}

function contactLine(b) {
  // Location first, then phone, email, profiles (LinkedIn/GitHub), portfolio — pipe-separated.
  // Everything but the location is a real clickable link (ADR 0032): phone → tel:,
  // email → mailto:, profiles/website → https. Profiles show the network name when
  // present (compact + recruiter-friendly) and link to the full URL.
  const parts = [];
  if (b.location) parts.push(esc(b.location));
  if (b.phone) parts.push(`<a href="tel:${esc(b.phone.replace(/[^+\d]/g, ''))}">${esc(b.phone)}</a>`);
  if (b.email) parts.push(`<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`);
  for (const p of b.profiles || []) {
    if (linkable(p.url)) parts.push(link(p.url, p.network || undefined));
  }
  if (linkable(b.url)) parts.push(link(b.url));
  return parts.join('&nbsp;&nbsp;|&nbsp;&nbsp;');
}

function section(title, inner) {
  if (!inner || !inner.trim()) return '';
  return `<section><h2>${esc(title)}</h2>${inner}</section>`;
}

function workEntry(w) {
  const date = [w.startDate, w.endDate].filter(Boolean).join(' – ');
  // Company + date on line 1 (bold); position + location on line 2 (italic).
  // If the location is embedded in the title as "… (USA)", pull it out to the right.
  let position = w.position || '';
  let location = w.location || '';
  const m = position.match(/\s*\(([^)]+)\)\s*$/);
  if (!location && m) {
    location = m[1];
    position = position.replace(/\s*\([^)]+\)\s*$/, '').trim();
  }
  const bullets = (w.highlights || []).filter(Boolean).map((h) => `<li>${esc(h)}</li>`).join('');
  return `
    <div class="entry">
      <div class="entry-head">
        <span class="entry-title">${esc(w.name || '')}</span>
        <span class="entry-meta">${esc(date)}</span>
      </div>
      <div class="entry-sub">
        <span class="entry-role">${esc(position)}</span>
        <span class="entry-loc">${esc(location)}</span>
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
        <span class="entry-meta">${p.url ? link(p.url) : ''}</span>
      </div>
      ${p.description ? `<div class="entry-sub"><span class="entry-role">${esc(p.description)}</span></div>` : ''}
      ${bullets ? `<ul>${bullets}</ul>` : ''}
    </div>`;
}

function eduEntry(e) {
  const right = [e.startDate, e.endDate].filter(Boolean).join(' – ');
  const degree = [e.studyType, e.area].filter(Boolean).join(', ');
  // Degree first (bold), institution below (italic) — matches the reference.
  return `
    <div class="entry edu">
      <div class="entry-head">
        <span class="entry-title">${esc(degree)}${e.score ? ` · ${esc(e.score)}` : ''}</span>
        <span class="entry-meta">${esc(right)}</span>
      </div>
      ${e.institution ? `<div class="entry-sub"><span class="entry-role">${esc(e.institution)}</span></div>` : ''}
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
  /* Links are clickable in the PDF but read as plain résumé text (no blue underline). */
  a { color: inherit; text-decoration: none; }
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
  header { text-align: center; margin-bottom: 3pt; }
  section { margin-top: 0; }
  h2 {
    font-size: 11.5pt;
    line-height: 13pt;
    font-weight: bold;
    text-align: left;
    color: #1a1a1a;
    border-bottom: 0.8pt solid #1a1a1a;
    margin-top: 5.5pt;
    padding-bottom: 0.5pt;
    margin-bottom: 3pt;
    text-transform: uppercase;
  }
  .summary {
    font-size: 9.8pt;
    line-height: 12pt;
    font-weight: normal;
    text-align: left;
    margin-bottom: 1pt;
  }
  .entry { margin-bottom: 5pt; }
  .entry-head { display: flex; justify-content: space-between; align-items: baseline; padding-top: 0; gap: 0.5em; }
  .entry-sub { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5em; margin-bottom: 1.5pt; }
  .entry-title { font-size: 10.5pt; line-height: 13pt; font-weight: bold; color: #1a1a1a; }
  .entry-role { font-size: 10pt; line-height: 12pt; font-weight: normal; font-style: italic; color: #1a1a1a; }
  .entry-loc { font-size: 10pt; line-height: 12pt; font-weight: normal; font-style: italic; color: #444444; white-space: nowrap; }
  .entry-meta { font-size: 10pt; line-height: 13pt; font-weight: bold; color: #444444; white-space: nowrap; }
  ul { list-style: disc; margin: 0; padding-left: 12pt; }
  li {
    font-size: 9.5pt;
    line-height: 11.5pt;
    margin-bottom: 2.4pt;
    padding-left: 1pt;
    text-align: left;
  }
  li::marker { color: #1a1a1a; }
  ul.skills { margin-top: 0; }
  ul.skills li { font-size: 9.8pt; line-height: 12pt; margin-bottom: 1.5pt; padding-left: 1pt; }
  .skill-group { font-weight: bold; color: #1a1a1a; }
  .edu { margin-bottom: 6pt; }
  .edu .entry-title { font-size: 10.5pt; line-height: 13pt; font-weight: bold; }
  .edu .entry-role { font-size: 9.8pt; line-height: 12pt; font-weight: normal; font-style: italic; color: #444444; }
</style>
</head>
<body>
  <header>
    <div class="name">${esc(b.name || '')}</div>
    <div class="contact">${contactLine(b)}</div>
  </header>
  ${body}
</body>
</html>`;
}

export const TEMPLATES = Object.keys(THEMES);

/**
 * Cover letter → a clean, ATS-readable one-page business letter (ADR 0035). Reuses the
 * candidate's contact header (name + contact line), adds today's date and the company,
 * then renders the LLM-written body (blank-line-separated paragraphs; single newlines
 * become line breaks so "Sincerely," sits above the name). No auto-fit — a cover letter
 * is naturally about a page; render.js prints it with letter margins.
 */
export function renderCoverLetterHtml(text, basics = {}, job = {}, template = 'classic') {
  const theme = THEMES[template] || THEMES.classic;
  const b = basics || {};
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const company = job && job.company ? esc(job.company) : '';
  const paras = String(text || '')
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  :root { --accent: ${theme.accent}; --rule: ${theme.rule}; --muted: ${theme.muted}; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #fff; }
  a { color: inherit; text-decoration: none; }
  body { font-family: ${theme.bodyFont}; color: #1a1a1a; -webkit-font-smoothing: antialiased; }
  header { text-align: center; margin-bottom: 14pt; }
  .name { font-family: ${theme.headFont}; font-size: 17pt; line-height: 20pt; font-weight: bold; color: var(--accent); }
  .contact { font-size: 9.5pt; line-height: 13pt; color: #444; margin-top: 3pt; }
  .rule { border-bottom: 0.8pt solid var(--rule); margin-bottom: 14pt; }
  .meta { font-size: 10.5pt; line-height: 15pt; color: #1a1a1a; margin-bottom: 14pt; }
  .meta .company { font-weight: bold; }
  .body p { font-size: 10.8pt; line-height: 15.5pt; margin-bottom: 11pt; text-align: left; }
</style>
</head>
<body>
  <header>
    <div class="name">${esc(b.name || '')}</div>
    <div class="contact">${contactLine(b)}</div>
  </header>
  <div class="rule"></div>
  <div class="meta">
    ${esc(date)}${company ? `<br/><span class="company">${company}</span>` : ''}
  </div>
  <div class="body">${paras}</div>
</body>
</html>`;
}
