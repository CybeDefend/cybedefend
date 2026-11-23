import { getMetadataArgsStorage } from 'typeorm';
import { DataFlowItem } from './data-flow-item.entity';

describe('DataFlowItem entity — nameHighlight column', () => {
  // Regression test:
  // "QueryFailedError: Data too long for column 'nameHighlight' at row 1".
  // Scanner-provided highlighted names/lines can exceed 255 chars (long or
  // minified code lines, highlight markup), which overflowed the original
  // varchar(255) column. Storing it as TEXT removes the hard limit.
  it('stores nameHighlight as TEXT so long highlighted lines do not overflow varchar(255)', () => {
    const column = getMetadataArgsStorage().columns.find(
      (c) => c.target === DataFlowItem && c.propertyName === 'nameHighlight',
    );

    expect(column).toBeDefined();
    expect(column.options.type).toBe('text');
  });
});
