import { findUnquotedCamelCaseSql } from '../index';

const kinds = (source: string) =>
  findUnquotedCamelCaseSql(source).map((h) => `${h.line} ${h.kind} ${h.identifier}`);

describe('findUnquotedCamelCaseSql', () => {
  it('reports a camelCase column after an alias declared inside the raw string', () => {
    const source = [
      "const qb = repo.createQueryBuilder('project').innerJoin('project.team', 'team');",
      'qb.andWhere(',
      "  'EXISTS (SELECT 1 FROM users_organizations_members uom WHERE uom.organizationId = :organizationId AND uom.role IN (:...roles))',",
      ');',
      "qb.orWhere('EXISTS (SELECT 1 FROM teams_members tm WHERE tm.teamId = team.id AND tm.userId = :userId)');",
    ].join('\n');

    expect(kinds(source)).toEqual([
      '3 alias-column uom.organizationId',
      '5 alias-column tm.teamId',
      '5 alias-column tm.userId',
    ]);
  });

  it('accepts a camelCase column after an alias the query builder registers', () => {
    const source = [
      "const qb = repo.createQueryBuilder('project')",
      "  .innerJoin('project.team', 'team')",
      "  .innerJoin(User, 'u', 'u.id = project.creatorId')",
      "  .leftJoinAndSelect(() => Scan, 's', 's.projectId = project.id')",
      "  .innerJoinAndMapOne('project.owner', User, 'owner', 'owner.id = project.ownerId')",
      "  .where('team.organizationId = :organizationId AND project.cyberRiskScore > 0');",
      "manager.createQueryBuilder().from(Team, 't').where('t.organizationId = :o');",
      "ds.createQueryBuilder().select('a.vulnerabilityOsvId', 'osvId').from('vulnerability_osv_alias', 'a')",
      "  .innerJoin('vulnerability_osv_affected_range', 'rng', 'rng.affectedId = a.id').where('a.vulnerabilityOsvId IN (:...ids)');",
    ].join('\n');

    expect(kinds(source)).toEqual([]);
  });

  it('reports a registered alias too when the text goes to .query() or a sql template', () => {
    const source = [
      "const qb = repo.createQueryBuilder('project');",
      "await runner.query('SELECT project.teamId FROM project WHERE id = ?', [id]);",
      'await run(ds, sql`UPDATE scan SET scan.endTime = NOW() WHERE scan.id = ${id}`);',
    ].join('\n');

    expect(kinds(source)).toEqual([
      '2 alias-column project.teamId',
      '3 alias-column scan.endTime',
    ]);
  });

  it('reports a bare camelCase column in raw SQL only', () => {
    const source = [
      "await ds.query('DELETE FROM project WHERE teamId = ? AND name = ?', [t, n]);",
      "repo.createQueryBuilder().update(Project).set({ a: 1 }).where('teamId = :t');",
    ].join('\n');

    expect(kinds(source)).toEqual(['1 bare-column teamId']);
  });

  it('reports an unquoted camelCase output alias, wherever it is', () => {
    const source = [
      "const qb = repo.createQueryBuilder('u').select(['u.id AS userId', 'u.email AS email']);",
      "await ds.query('SELECT COUNT(*) AS total, MAX(x) AS lastSeen FROM t');",
    ].join('\n');

    expect(kinds(source)).toEqual([
      '1 output-alias userId',
      '2 output-alias lastSeen',
      '2 bare-column lastSeen',
    ]);
  });

  it('accepts quoted identifiers, interpolations, parameters and SQL literals', () => {
    const source = [
      "const q = (name: string) => ident(name).text;",
      'const sub = `SELECT t.id AS ${q(\'teamId\')} FROM team t WHERE ${q(\'t.organizationId\')} = :organizationId AND t.kind = \'fooBar\'`;',
      'await ds.query(`SELECT "s"."createdAt" AS "createdAt" FROM scan s WHERE "s"."projectId" = $1`, [p]);',
      "qb.where('x.id = :projectId AND y.id IN (:...teamIds)');",
    ].join('\n');

    expect(kinds(source)).toEqual([]);
  });

  it('ignores comments and strings that are not SQL', () => {
    const source = [
      '// EXISTS (SELECT 1 FROM t uom WHERE uom.organizationId = :o)',
      '/* SELECT a.fooBar FROM a */',
      "throw new Error('A userId and organizationId must be provided.');",
      "logger.warn(`Failed for projectId=${id}: ${err.message}`);",
      "const path = 'project.teamId';",
      // a quote inside a regular expression opens no string
      "const name = cwe.shortName ?? cwe.name.match(/\\('([^']+)'\\)\\s*$/)?.[1];",
      "const half = (a.total + b.total) / 2; const x = 'SELECT 1 = 1';",
      "const value = meta.projectName || meta.projectId;",
    ].join('\n');

    expect(kinds(source)).toEqual([]);
  });

  it('reports a MySQL-quoted identifier inside a quoted string', () => {
    const source = [
      "const qb = repo.createQueryBuilder('det');",
      "qb.andWhere('EXISTS (SELECT 1 FROM autofix_records afr WHERE afr.id = `det`.`id`)');",
    ].join('\n');

    expect(kinds(source)).toEqual(['2 backtick-identifier `det`']);
  });

  it('reads a multi-line template and gives the line of the identifier', () => {
    const source = [
      'const readable = `(',
      '  SELECT t.id',
      '    FROM users_organizations_members uom',
      '   WHERE uom.userId = :userId',
      ')`;',
    ].join('\n');

    expect(kinds(source)).toEqual(['4 alias-column uom.userId']);
  });
});
