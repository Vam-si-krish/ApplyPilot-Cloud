import { describe, expect, it } from 'vitest';
import { MAIL_CLASSIFY_BATCH, MAIL_SUBSCRIPTION_CLASSIFY_BATCH, mailClassifyBatchSize } from './mailSync';
import type { Settings } from './types';

function settings(scoreProvider: string, scoreModel = 'test-model'): Settings {
  return {
    score_provider: scoreProvider,
    score_model: scoreModel,
    llm_provider: 'openai',
    llm_model: 'gpt-4o-mini',
  } as Settings;
}

describe('mailClassifyBatchSize', () => {
  it.each(['subscription', 'chatgpt_subscription'])(
    'keeps %s classification to one worker call per serverless request',
    (provider) => {
      expect(mailClassifyBatchSize(settings(provider))).toBe(MAIL_SUBSCRIPTION_CLASSIFY_BATCH);
    },
  );

  it.each(['openai', 'anthropic', 'gemini', 'deepseek'])(
    'retains the normal batch for direct %s API calls',
    (provider) => {
      expect(mailClassifyBatchSize(settings(provider))).toBe(MAIL_CLASSIFY_BATCH);
    },
  );

  it('uses the complete legacy provider/model pair when the score lane is incomplete', () => {
    expect(mailClassifyBatchSize(settings('chatgpt_subscription', ''))).toBe(MAIL_CLASSIFY_BATCH);
  });
});
