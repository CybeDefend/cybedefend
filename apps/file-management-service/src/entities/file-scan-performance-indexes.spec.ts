import { getMetadataArgsStorage } from 'typeorm';
import { FileScan } from './file.entity';

type EntityClass = new (...args: never[]) => unknown;

function resolveColumns(
  entity: EntityClass,
  columns: unknown,
): string[] | undefined {
  const cols =
    typeof columns === 'function'
      ? (columns as (o?: unknown) => unknown)(
          (entity as { prototype: unknown }).prototype,
        )
      : columns;
  return Array.isArray(cols) ? (cols as string[]) : undefined;
}

function hasCompositeIndex(entity: EntityClass, expected: string[]): boolean {
  const indices = getMetadataArgsStorage().indices.filter(
    (i) => i.target === entity,
  );
  return indices.some((i) => {
    const cols = resolveColumns(entity, i.columns);
    return (
      Array.isArray(cols) &&
      cols.length === expected.length &&
      cols.every((c, idx) => c === expected[idx])
    );
  });
}

describe('FileScan — performance indexes', () => {
  // Without them, filtering by status with a createdAt/updatedAt
  // range/sort and lookups by scanId run full scans because only the PK
  // on `id` is indexed. These class-level @Index() decorators back the
  // AddPerformanceIndexes migration.
  it('declares a composite index on (status, createdAt)', () => {
    expect(hasCompositeIndex(FileScan, ['status', 'createdAt'])).toBe(true);
  });

  it('declares a composite index on (status, updatedAt)', () => {
    expect(hasCompositeIndex(FileScan, ['status', 'updatedAt'])).toBe(true);
  });

  it('declares a single-column index on (scanId)', () => {
    expect(hasCompositeIndex(FileScan, ['scanId'])).toBe(true);
  });

  it('declares a single-column index on (projectId) for the data purge', () => {
    expect(hasCompositeIndex(FileScan, ['projectId'])).toBe(true);
  });
});
