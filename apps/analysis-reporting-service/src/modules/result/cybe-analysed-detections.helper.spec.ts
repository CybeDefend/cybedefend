import { Repository } from 'typeorm';
import { findCybeAnalysedDetectionIds } from './cybe-analysed-detections.helper';
import { FakeRepository } from '../../test-utils/fake-query-builder';

describe('findCybeAnalysedDetectionIds', () => {
  const asRepository = (fake: FakeRepository) =>
    fake as unknown as Repository<{ id: string }>;

  it('reads nothing for an empty page', async () => {
    const fake = new FakeRepository(() => []);

    const ids = await findCybeAnalysedDetectionIds(
      asRepository(fake),
      'p1',
      [],
    );

    expect(ids.size).toBe(0);
    expect(fake.builders).toHaveLength(0);
  });

  it('compares the history userId byte for byte, on the ids of the page, in the project', async () => {
    const fake = new FakeRepository(() => [
      { id: 'd1', historyItems: [{ userId: 'system' }] },
    ]);

    await findCybeAnalysedDetectionIds(asRepository(fake), 'p1', ['d1', 'd2']);

    const [query] = fake.builders;
    const clauses = query.calls
      .filter((c) => ['where', 'andWhere'].includes(c.method))
      .map((c) => String(c.args[0]));
    // A plain `=` would follow the column's case- and accent-insensitive
    // collation and count 'SYSTEM' as the AI agent; the JS rule was `===`.
    expect(clauses).toContain("CAST(history.userId AS BINARY) = 'system'");
    expect(clauses.some((c) => /userId\s*=\s*:/.test(c))).toBe(false);
    expect(query.idFilter()).toEqual(['d1', 'd2']);
    expect(clauses).toContain('analysed.projectId = :projectId');
    expect(query.params.projectId).toBe('p1');
    expect(
      query.joins.map((j) => `${j.method} ${j.parentAlias}.${j.property}`),
    ).toEqual(['innerJoin analysed.historyItems']);
  });

  it('returns the ids the query gives back', async () => {
    const fake = new FakeRepository(() => [
      { id: 'd1', historyItems: [{ userId: 'system' }] },
      { id: 'd2', historyItems: [] },
    ]);

    const ids = await findCybeAnalysedDetectionIds(asRepository(fake), 'p1', [
      'd1',
      'd2',
    ]);

    expect([...ids]).toEqual(['d1']);
  });
});
