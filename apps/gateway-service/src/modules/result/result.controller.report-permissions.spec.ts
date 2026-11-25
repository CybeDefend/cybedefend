import { GUARDS_METADATA } from '@nestjs/common/constants';
import { FeatureGuard } from 'src/core/guards/feature/feature.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { ProjectsRealtimeController } from '../realtime/projects-realtime.controller';
import { ResultController } from './result.controller';

/**
 * The reports of a project have their own permissions in the permission
 * schema: `create_report` to generate one, `read_report` to read, list or
 * follow them, `archive_report` to delete one. A role that reads the findings
 * (`read_scan_result`, held by developers) is not granted the reports, so a
 * report route must never fall back on the findings permission.
 */
describe('ResultController — project report permissions', () => {
  const proto = ResultController.prototype;
  const meta = (fn: object) => ({
    subjectTypes: Reflect.getMetadata('subjectTypes', fn),
    permissions: Reflect.getMetadata('permissions', fn),
  });
  const guards = (fn: object): unknown[] =>
    Reflect.getMetadata(GUARDS_METADATA, fn) ?? [];

  it.each([['generateOwaspReport'], ['generateCweReport']])(
    '%s asks create_report on the project',
    (name) => {
      const fn = proto[name as keyof ResultController] as object;
      expect(meta(fn)).toEqual({
        subjectTypes: ['project'],
        permissions: ['create_report'],
      });
      // Permify answers before the plan is resolved.
      expect(guards(fn).indexOf(PermissionsGuard)).toBeGreaterThanOrEqual(0);
      expect(guards(fn).indexOf(PermissionsGuard)).toBeLessThan(
        guards(fn).indexOf(FeatureGuard),
      );
    },
  );

  it.each([
    ['getGeneratedReport'],
    ['listGeneratedReports'],
    ['getProjectReportUsage'],
  ])('%s asks read_report on the project', (name) => {
    const fn = proto[name as keyof ResultController] as object;
    expect(meta(fn)).toEqual({
      subjectTypes: ['project'],
      permissions: ['read_report'],
    });
    expect(guards(fn)).toContain(PermissionsGuard);
  });

  it('deleteGeneratedReport keeps archive_report on the project', () => {
    expect(meta(proto.deleteGeneratedReport)).toEqual({
      subjectTypes: ['project'],
      permissions: ['archive_report'],
    });
  });

  it('the project report event stream asks read_report', () => {
    const fn = ProjectsRealtimeController.prototype.reportsStream;
    expect(meta(fn)).toEqual({
      subjectTypes: ['project'],
      permissions: ['read_report'],
    });
    expect(guards(fn)).toContain(PermissionsGuard);
  });

  it('the other project event streams keep read_scan_result', () => {
    const p = ProjectsRealtimeController.prototype;
    for (const fn of [
      p.issuesStream,
      p.statsStream,
      p.policiesStream,
      p.issueDetailStream,
    ]) {
      expect(meta(fn).permissions).toEqual(['read_scan_result']);
    }
  });

  it('no project route whose path names a report asks read_scan_result', () => {
    const onFindingsPermission = Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor')
      .map((name) => ({
        name,
        path: Reflect.getMetadata(
          'path',
          proto[name as keyof ResultController] as object,
        ) as string | undefined,
        permissions: Reflect.getMetadata(
          'permissions',
          proto[name as keyof ResultController] as object,
        ) as string[] | undefined,
      }))
      .filter((r) => r.path?.startsWith('/project/') && /report/.test(r.path))
      .filter((r) => (r.permissions ?? []).includes('read_scan_result'))
      .map((r) => r.name);
    expect(onFindingsPermission).toEqual([]);
  });
});
