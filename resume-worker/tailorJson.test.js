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

const locationBase = () => normalizeResume({
  basics: { name: 'Taylor Candidate', location: 'Denver, CO' },
  work: [{ name: 'Acme', position: 'Engineer', highlights: ['Built products'] }],
});
const locationJob = { title: 'Engineer', company: 'Example', location: 'Remote — Austin Metropolitan Area', full_description: 'Build products.' };
const locationPolicy = { skillAdditionMode: 'learnable', skillLearningHorizonDays: 15, titleAlignment: 'honest_reframe', evidenceStandard: 'plausible_with_review', useJobLocation: true };
const locationResponse = (extra = '') =>
  `{"basics":{"summary":"Relevant engineer"},"work":[{"name":"Acme","highlights":["Built relevant products"]}],"skills":[],"projects":[],"customSections":[]${extra}}`;
const clientFor = (response) => ({ model: 'sonnet', lastUsage: null, chat: async () => response });

test('opt-in location uses the model-judged resume_location on only the generated copy (ADR 0112)', async () => {
  const base = locationBase();
  const result = await tailorResume(
    base, locationJob, {}, clientFor(locationResponse(',"resume_location":"Austin, TX"')), '', locationPolicy,
  );
  // The model's judged city is used — NOT the raw job string ("Remote — Austin Metropolitan Area").
  assert.equal(result.resume.basics.location, 'Austin, TX');
  assert.equal(base.basics.location, 'Denver, CO');
});

test('opt-in location keeps the home location when the model withholds or returns junk', async () => {
  const withheld = await tailorResume(locationBase(), locationJob, {}, clientFor(locationResponse()), '', locationPolicy);
  assert.equal(withheld.resume.basics.location, 'Denver, CO');

  const junk = `,"resume_location":"${'x'.repeat(80)}"`;
  const overlong = await tailorResume(locationBase(), locationJob, {}, clientFor(locationResponse(junk)), '', locationPolicy);
  assert.equal(overlong.resume.basics.location, 'Denver, CO');
});

test('resume_location is ignored entirely when the preference is off', async () => {
  const result = await tailorResume(
    locationBase(), locationJob, {}, clientFor(locationResponse(',"resume_location":"Austin, TX"')), '',
    { ...locationPolicy, useJobLocation: false },
  );
  assert.equal(result.resume.basics.location, 'Denver, CO');
});

test('tailoring prompt demonstrates escaped JSON newlines, not raw ones', () => {
  assert.match(TAILOR_PROMPT, /"cover_letter": "Dear Hiring Manager,\\n\\n<3 paragraphs>/);
  assert.doesNotMatch(TAILOR_PROMPT, /"cover_letter": "Dear Hiring Manager,\n\n<3 paragraphs>/);
  assert.match(TAILOR_PROMPT, /NEVER place a literal line break inside a quoted JSON value/);
});
