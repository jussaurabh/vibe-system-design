import { cutTitle } from './cut-title.js';

describe('cutTitle', () => {
  it('keeps a short title whole', () => {
    expect(cutTitle('How should we shard this?')).toBe('How should we shard this?');
  });

  it('cuts at a word boundary and stays inside the limit', () => {
    const title = cutTitle('one two three four five six seven eight nine ten eleven twelve');
    expect(title.length).toBeLessThanOrEqual(60);
    // The last whole word that fits stays. The next word does not.
    expect(title.endsWith('eleven')).toBe(true);
  });

  it('cuts a long word instead of returning nothing', () => {
    const title = cutTitle('a'.repeat(100));
    expect(title).toHaveLength(60);
  });

  it('collapses whitespace and never returns an empty title for a real message', () => {
    expect(cutTitle('  hello \n\n world  ')).toBe('hello world');
  });
});
