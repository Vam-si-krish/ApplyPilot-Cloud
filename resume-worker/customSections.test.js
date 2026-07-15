import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResume, mergeTailored } from './tailor.js';
import { renderHtml } from './templates.js';

const base = normalizeResume({
  basics: { name: 'Candidate' },
  work: [{ name: 'Acme', startDate: '2020', endDate: 'Present', highlights: ['Built products'] }],
  customSections: [
    {
      title: 'Certifications & Leadership',
      items: [
        {
          name: 'AWS Developer <Professional>',
          description: 'Amazon',
          date: '2025',
          location: 'Remote',
          url: 'https://example.com/cert',
          highlights: ['Led a 20-person study group'],
        },
      ],
    },
  ],
});

test('custom sections survive worker normalization and render as escaped ATS text', () => {
  const html = renderHtml(base);
  assert.match(html, /CERTIFICATIONS &amp; LEADERSHIP/i);
  assert.match(html, /AWS Developer &lt;Professional&gt;/);
  assert.match(html, /Led a 20-person study group/);
  assert.match(html, /href="https:\/\/example.com\/cert"/);
});

test('worker tailoring anchors custom facts and only rewrites existing bullet slots', () => {
  const patch = normalizeResume({
    customSections: [
      {
        title: 'Changed',
        items: [
          { name: 'Changed', description: 'Changed', highlights: ['Reframed leadership', 'Overflow'] },
        ],
      },
    ],
  });
  const merged = mergeTailored(base, patch);
  assert.equal(merged.customSections[0].title, 'Certifications & Leadership');
  assert.equal(merged.customSections[0].items[0].name, 'AWS Developer <Professional>');
  assert.equal(merged.customSections[0].items[0].description, 'Amazon');
  assert.deepEqual(merged.customSections[0].items[0].highlights, ['Reframed leadership']);
});
