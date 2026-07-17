import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonObject, normalizeResume, tailorResume, TAILOR_PROMPT } from './tailor.js';

test('worker repairs raw paragraph breaks inside an otherwise-valid JSON string', () => {
  const response = '{"cover_letter":"Dear Hiring Manager,\n\nFirst paragraph.\n\nSincerely,\nTaylor"}';
  assert.deepEqual(extractJsonObject(response), {
    cover_letter: 'Dear Hiring Manager,\n\nFirst paragraph.\n\nSincerely,\nTaylor',
  });
});

test('worker repair remains narrow and rejects other malformed JSON', () => {
  assert.equal(extractJsonObject('{"cover_letter": unquoted}'), null);
});

test('tailoring completes from a response whose cover letter contains raw paragraphs', async () => {
  const base = normalizeResume({
    basics: { name: 'Taylor Candidate' },
    work: [{ name: 'Acme', position: 'Engineer', highlights: ['Built products'] }],
  });
  const response =
    '{"basics":{"summary":"Relevant engineer"},"work":[{"name":"Acme","highlights":["Built relevant products"]}],"skills":[],"projects":[],"customSections":[],"cover_letter":"Dear Hiring Manager,\n\nI build relevant products.\n\nI would welcome a conversation.\n\nSincerely,\nTaylor Candidate","_changes":["Focused the résumé on the role."]}';
  const client = { model: 'sonnet', lastUsage: null, chat: async () => response };

  const result = await tailorResume(
    base,
    { title: 'Engineer', company: 'Example', full_description: 'Build and maintain relevant products for customers.' },
    {},
    client,
  );

  assert.equal(result.resume.work[0].name, 'Acme');
  assert.deepEqual(result.resume.work[0].highlights, ['Built relevant products']);
  assert.match(result.coverLetter, /I would welcome a conversation/);
});

test('opt-in job location changes only the generated résumé copy', async () => {
  const base = normalizeResume({
    basics: { name: 'Taylor Candidate', location: 'Denver, CO' },
    work: [{ name: 'Acme', position: 'Engineer', highlights: ['Built products'] }],
  });
  const response = '{"basics":{"summary":"Relevant engineer"},"work":[{"name":"Acme","highlights":["Built relevant products"]}],"skills":[],"projects":[],"customSections":[]}';
  const client = { model: 'sonnet', lastUsage: null, chat: async () => response };
  const result = await tailorResume(
    base,
    { title: 'Engineer', company: 'Example', location: 'Austin, TX', full_description: 'Build products.' },
    {},
    client,
    '',
    { skillAdditionMode: 'learnable', skillLearningHorizonDays: 15, titleAlignment: 'honest_reframe', evidenceStandard: 'plausible_with_review', useJobLocation: true },
  );

  assert.equal(result.resume.basics.location, 'Austin, TX');
  assert.equal(base.basics.location, 'Denver, CO');
});

test('tailoring prompt demonstrates escaped JSON newlines, not raw ones', () => {
  assert.match(TAILOR_PROMPT, /"cover_letter": "Dear Hiring Manager,\\n\\n<3 paragraphs>/);
  assert.doesNotMatch(TAILOR_PROMPT, /"cover_letter": "Dear Hiring Manager,\n\n<3 paragraphs>/);
  assert.match(TAILOR_PROMPT, /NEVER place a literal line break inside a quoted JSON value/);
});
