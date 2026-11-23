import { SelectQueryBuilder } from 'typeorm';
import { applyPriorityFilter } from './priority-filter.helper';

describe('applyPriorityFilter', () => {
  let qb: jest.Mocked<SelectQueryBuilder<unknown>>;

  beforeEach(() => {
    qb = {
      andWhere: jest.fn().mockReturnThis(),
    } as unknown as jest.Mocked<SelectQueryBuilder<unknown>>;
  });

  it('does not constrain the query when priority is undefined', () => {
    applyPriorityFilter(qb, undefined, 'vulnDetection');
    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it('does not constrain the query when priority is null', () => {
    applyPriorityFilter(qb, null, 'vulnDetection');
    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it('does not constrain the query when priority is an empty array', () => {
    applyPriorityFilter(qb, [], 'vulnDetection');
    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it('emits a guarded clause that lets empty/NULL currentPriority pass through', () => {
    applyPriorityFilter(qb, ['urgent', 'normal'], 'vulnDetection');
    expect(qb.andWhere).toHaveBeenCalledTimes(1);
    expect(qb.andWhere).toHaveBeenCalledWith(
      `(vulnDetection.currentPriority IN (:...priority) OR vulnDetection.currentPriority = '' OR vulnDetection.currentPriority IS NULL)`,
      { priority: ['urgent', 'normal'] },
    );
  });

  it('honors the caller-supplied alias', () => {
    applyPriorityFilter(qb, ['urgent'], 'det');
    expect(qb.andWhere).toHaveBeenCalledWith(
      `(det.currentPriority IN (:...priority) OR det.currentPriority = '' OR det.currentPriority IS NULL)`,
      { priority: ['urgent'] },
    );
  });
});
