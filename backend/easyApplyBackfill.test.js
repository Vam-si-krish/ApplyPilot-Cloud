import test from 'node:test';
import assert from 'node:assert/strict';
import { datasetJobUrl, explicitEasyApply } from './scripts/backfill-easy-apply-from-apify.mjs';

test('Easy Apply backfill accepts only explicit actor metadata', () => {
  assert.equal(explicitEasyApply({ easyApply: true }), true);
  assert.equal(explicitEasyApply({ isEasyApplyJob: false }), false);
  assert.equal(explicitEasyApply({ applyType: 'EASY_APPLY' }), true);
  assert.equal(explicitEasyApply({ applicationType: 'EXTERNAL' }), false);
  assert.equal(explicitEasyApply({ url: 'https://www.linkedin.com/jobs/view/1' }), null);
  assert.equal(explicitEasyApply({ applyType: 'UNKNOWN' }), null);
});

test('Easy Apply backfill uses the same actor URL field precedence as ingestion', () => {
  assert.equal(datasetJobUrl({ url: 'primary', jobUrl: 'secondary' }), 'primary');
  assert.equal(datasetJobUrl({ jobPostingUrl: 'posting' }), 'posting');
  assert.equal(datasetJobUrl({ title: 'no URL' }), null);
});
