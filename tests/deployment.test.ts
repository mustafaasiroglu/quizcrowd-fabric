import { describe, expect, it } from 'vitest';
import { sqlConfiguration } from '../rayfin/functions/src/deployment';

describe('server-only Fabric SQL configuration', () => {
  it('accepts discovered FQDNs with the SQL metadata port suffix', () => {
    expect(sqlConfiguration(' sample.database.fabric.microsoft.com,1433 ', ' QuizCrowdData ')).toEqual({
      server: 'sample.database.fabric.microsoft.com', database: 'QuizCrowdData',
    });
    expect(sqlConfiguration('sample.database.windows.net', 'QuizCrowdData').server)
      .toBe('sample.database.windows.net');
  });
  it('fails closed for missing, placeholder or unsupported port configuration', () => {
    for (const [server, database] of [
      ['', 'QuizCrowdData'], ['host', ''], ['<server>', 'QuizCrowdData'],
      ['host', '<database>'], ['host,443', 'QuizCrowdData'],
    ]) expect(() => sqlConfiguration(server, database)).toThrow();
  });
});
