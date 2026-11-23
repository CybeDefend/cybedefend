import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getMetadataArgsStorage } from 'typeorm';
import { Organization } from 'src/entities/organization.entity';
import { Team } from 'src/entities/team.entity';
import { Project } from 'src/entities/project.entity';
import {
  DELETED_WITH_THE_SUBJECT,
  KEPT_TABLES,
  ORGANIZATION_PURGE_TABLES,
} from './data-purge.tables';

/** A column named like a project, team or organization key. */
const KEY =
  /^(project_?id|internal_id|team_?ids?|organization_?id|org_?id|scope_?id)$/i;

/** The subjects of a purge: a relation to one of them is a key too. */
const SUBJECTS: unknown[] = [Organization, Team, Project];

function entityFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    // cybedefend-ignore[CD-SAST-1455]: the test joins its own source directory with the file names readdir returns there; no input reaches it
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      // The closed edition's entities belong to its own inventory spec.
      if (name === 'ee') return [];
      return entityFiles(path);
    }
    return name.endsWith('.entity.ts') ? [path] : [];
  });
}

// Every entity of the service, loaded so that its decorators register.
beforeAll(async () => {
  for (const file of entityFiles(join(__dirname, '..', '..'))) {
    await import(file);
  }
});

interface Table {
  name: string;
  target: unknown;
  columns: string[];
  /** The subjects this table references through a ManyToOne / owning OneToOne. */
  subjects: unknown[];
}

function tables(): Table[] {
  const storage = getMetadataArgsStorage();
  return storage.tables
    .filter((t) => typeof t.target === 'function' && t.name)
    .map((t) => {
      const target = t.target;
      const owning = storage.relations.filter(
        (r) =>
          r.target === target &&
          (r.relationType === 'many-to-one' ||
            (r.relationType === 'one-to-one' &&
              storage.joinColumns.some(
                (j) => j.target === target && j.propertyName === r.propertyName,
              ))),
      );
      return {
        name: t.name as string,
        target,
        columns: storage.columns
          .filter((c) => c.target === target)
          .flatMap((c) => [
            c.propertyName,
            (c.options.name as string) ?? c.propertyName,
          ]),
        subjects: owning
          .map((r) =>
            typeof r.type === 'function'
              ? (r.type as () => unknown)()
              : undefined,
          )
          .filter((type) => SUBJECTS.includes(type)),
      };
    });
}

const keyed = () =>
  tables().filter(
    (t) => t.subjects.length > 0 || t.columns.some((c) => KEY.test(c)),
  );

describe('global-management data purge inventory', () => {
  it('every table keyed by a project, a team or an organization is purged or kept with a reason', () => {
    const handled = new Set([
      ...Object.keys(DELETED_WITH_THE_SUBJECT),
      ...ORGANIZATION_PURGE_TABLES.map((t) => t.table),
      ...Object.keys(KEPT_TABLES),
    ]);
    const found = keyed();
    // A relation counts as a key: without it most tables here would be missed.
    expect(found.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'project',
        'team',
        'teams_members',
        'users_organizations_members',
        'organization_invitations',
        'project_branch_ingestion',
        'archived_branch',
        'project_security_context',
        'data_purge_job',
        'organization_deletion_code',
      ]),
    );
    expect(found.map((t) => t.name).filter((n) => !handled.has(n))).toEqual([]);
  });

  it('every table said to go with its subject is deleted by the FK cascade of that subject', () => {
    const byName = new Map(tables().map((t) => [t.name, t]));
    for (const [table, reason] of Object.entries(DELETED_WITH_THE_SUBJECT)) {
      expect(reason).toMatch(/^deleted by the FK cascade of /);
      const t = byName.get(table)!;
      expect(t).toBeDefined();
      // It references a subject through a cascading relation.
      const cascades = getMetadataArgsStorage().relations.filter(
        (r) =>
          r.target === t.target &&
          r.options?.onDelete === 'CASCADE' &&
          typeof r.type === 'function' &&
          SUBJECTS.includes((r.type as () => unknown)()),
      );
      expect(cascades.length).toBeGreaterThan(0);
    }
  });

  it('no core table is purged by an edition step', () => {
    expect(ORGANIZATION_PURGE_TABLES).toEqual([]);
  });

  it('every kept table says why, and the ledger is kept as the erasure evidence', () => {
    expect(Object.keys(KEPT_TABLES).sort()).toEqual([
      'data_purge_job',
      'data_purge_step',
    ]);
    expect(Object.values(KEPT_TABLES).every((r) => r.length > 20)).toBe(true);
  });
});
