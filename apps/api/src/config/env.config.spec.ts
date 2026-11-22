import 'reflect-metadata';
import { EnvConfig } from './env.config.js';

describe('EnvConfig defaults', () => {
  it('scores in rag mode unless SCORING_MODE says otherwise', () => {
    expect(new EnvConfig().SCORING_MODE).toBe('rag');
  });
});
