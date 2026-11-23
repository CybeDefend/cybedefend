import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { ResultController } from './result.controller';

/**
 * GET /project/:projectId/branches/list is the only branch
 * source of the dashboard's project pages. A team member (developer,
 * analyst_developer) has read_scan_result on the project but not
 * manage_integration on the organization (creator, administrator, manager
 * only, schema.perm), which the repository branch routes ask. The route must
 * keep asking read_scan_result on the project, never manage_integration, or
 * members lose the branches again.
 */
describe('ResultController — /branches/list authorization posture', () => {
  const fn = ResultController.prototype.getProjectBranchesList;

  it('asks read_scan_result on the project', () => {
    expect(Reflect.getMetadata('permissions', fn)).toEqual([
      'read_scan_result',
    ]);
    expect(Reflect.getMetadata('subjectTypes', fn)).toEqual(['project']);
    expect(Reflect.getMetadata(GUARDS_METADATA, fn) ?? []).toContain(
      PermissionsGuard,
    );
  });

  it('does not ask manage_integration', () => {
    expect(Reflect.getMetadata('permissions', fn)).not.toContain(
      'manage_integration',
    );
  });
});
