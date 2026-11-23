import { getMetadataArgsStorage } from 'typeorm';
import { Scan } from './scan.entity';
import { Container } from './container.entity';

type EntityClass = new () => unknown;

function hasCompositeIndex(entity: EntityClass, columns: string[]): boolean {
  const indices = getMetadataArgsStorage().indices.filter(
    (i) => i.target === entity,
  );
  return indices.some((i) => {
    const cols =
      typeof i.columns === 'function'
        ? (i.columns as (o?: unknown) => unknown)(entity.prototype)
        : i.columns;
    if (!Array.isArray(cols) || cols.length !== columns.length) {
      return false;
    }
    return columns.every((c, idx) => cols[idx] === c);
  });
}

describe('security-scanning performance indexes', () => {
  describe('Scan entity', () => {
    const cases: Array<{ cols: string[] }> = [
      { cols: ['projectId', 'state'] },
      { cols: ['projectId', 'createAt'] },
      { cols: ['projectId', 'branch'] },
      { cols: ['organizationId', 'state'] },
      { cols: ['state', 'createAt'] },
    ];

    it.each(cases)('declares a composite index on $cols', ({ cols }) => {
      expect(hasCompositeIndex(Scan, cols)).toBe(true);
    });
  });

  describe('Container entity', () => {
    const cases: Array<{ cols: string[] }> = [
      { cols: ['scanId', 'status'] },
      { cols: ['podName', 'scanId'] },
      { cols: ['status', 'createdAt'] },
    ];

    it.each(cases)('declares a composite index on $cols', ({ cols }) => {
      expect(hasCompositeIndex(Container, cols)).toBe(true);
    });
  });
});
