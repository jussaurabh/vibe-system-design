import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { DbModule, DB, DB_CONNECTION } from './db.module.js';

const mockClose = vi.fn().mockResolvedValue(undefined);
const mockDb = { select: vi.fn() };

vi.mock('./db.client.js', () => ({
  createDb: vi.fn((url: string) => {
    if (!url) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    return { db: mockDb, close: mockClose };
  }),
}));

describe('DbModule', () => {
  it('provides the database instance and closes on module destroy', async () => {
    const originalUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db';

    const moduleRef = await Test.createTestingModule({
      imports: [DbModule],
    }).compile();

    const db = moduleRef.get(DB);
    expect(db).toBe(mockDb);

    await moduleRef.close();
    expect(mockClose).toHaveBeenCalled();

    process.env.DATABASE_URL = originalUrl;
  });

  it('rejects when DATABASE_URL is missing', async () => {
    const originalUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    await expect(
      Test.createTestingModule({
        imports: [DbModule],
      }).compile(),
    ).rejects.toThrow(/DATABASE_URL/);

    process.env.DATABASE_URL = originalUrl;
  });
});
