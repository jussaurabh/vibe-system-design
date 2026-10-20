import { DEFAULT_CORS_ORIGINS, resolveCorsOrigins } from './app-setup.js';

describe('resolveCorsOrigins', () => {
  it('falls back to the default origins when the env var is not set', () => {
    expect(resolveCorsOrigins({})).toEqual([...DEFAULT_CORS_ORIGINS]);
  });

  it('reads a comma separated list from the env var', () => {
    expect(
      resolveCorsOrigins({ CORS_ORIGINS: 'http://a.test, http://b.test' }),
    ).toEqual(['http://a.test', 'http://b.test']);
  });

  it('drops the empty entries of the env var', () => {
    expect(resolveCorsOrigins({ CORS_ORIGINS: ' , http://a.test, ' })).toEqual([
      'http://a.test',
    ]);
  });

  it('blocks every origin when the env var holds no entry', () => {
    expect(resolveCorsOrigins({ CORS_ORIGINS: '' })).toEqual([]);
  });
});
