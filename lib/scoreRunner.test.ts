import { describe, expect, it } from 'vitest';
import { taskProviderModel } from './scoreRunner';
import type { Settings } from './types';

function settings(over: Record<string, unknown> = {}): Settings {
  return {
    llm_provider: 'deepseek',
    llm_model: 'deepseek-chat',
    score_provider: 'subscription',
    score_model: 'haiku',
    tailor_provider: 'anthropic',
    tailor_model: 'claude-sonnet-4-6',
    chat_provider: 'openai',
    chat_model: 'gpt-4o-mini',
    ...over,
  } as Settings;
}

describe('taskProviderModel (ADR 0069)', () => {
  it('uses the independent chat provider/model pair', () => {
    expect(taskProviderModel(settings({ chat_provider: 'chatgpt_subscription', chat_model: 'gpt-5.4' }), 'chat'))
      .toEqual({ provider: 'chatgpt_subscription', model: 'gpt-5.4' });
  });

  it('preserves pre-migration chat behavior by falling back to the complete score pair', () => {
    expect(taskProviderModel(settings({ chat_provider: '', chat_model: '' }), 'chat'))
      .toEqual({ provider: 'subscription', model: 'haiku' });
  });

  it('never mixes an incomplete chat provider with a score model', () => {
    expect(taskProviderModel(settings({ chat_provider: 'chatgpt_subscription', chat_model: '' }), 'chat'))
      .toEqual({ provider: 'subscription', model: 'haiku' });
  });
});
