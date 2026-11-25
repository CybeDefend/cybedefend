/**
 * TEST-ONLY in-memory stand-in for a TypeORM repository and its
 * SelectQueryBuilder (grouped-view specs).
 *
 * It does not evaluate WHERE clauses — the fixtures all match the filters —
 * except the id lists a query is restricted to (`detectionIds`, `vulnIds`),
 * and it projects each row on what the query selects, the way TypeORM
 * hydrates: a relation only when joined AND selected, a column only when
 * selected (or when its alias is selected whole). Every call is recorded so a
 * spec can check the shape of the SQL a method builds.
 */

export type Row = Record<string, unknown>;

/** Property names the fixtures use for relations (everything else is a column). */
const RELATIONS = new Set([
  'vulnerability',
  'aliases',
  'affected',
  'ranges',
  'events',
  'scaDetectedPackage',
  'scaAutofixRecords',
  'autofixRecords',
  'historyItems',
  'references',
  'detectedPackage',
  'detectedImage',
]);

export interface JoinSpec {
  method: string;
  parentAlias: string;
  property: string;
  alias: string;
}

/**
 * Minimal TypeORM SelectQueryBuilder stand-in. It does not evaluate WHERE
 * clauses (the fixtures all match the filters), except the id lists a query
 * is restricted to, and it projects each row on what the query selects:
 * a relation is hydrated only when joined AND selected, a column only when
 * selected (or when the alias is selected whole).
 */
export class FakeQueryBuilder {
  readonly calls: { method: string; args: unknown[] }[] = [];
  readonly joins: JoinSpec[] = [];
  readonly params: Record<string, unknown> = {};
  private explicitSelect = false;
  private readonly selected = new Map<string, Set<string> | '*'>();

  constructor(
    readonly rootAlias: string,
    private readonly source: () => Row[],
  ) {
    this.selected.set(rootAlias, '*');
  }

  private record(method: string, args: unknown[]): this {
    this.calls.push({ method, args });
    return this;
  }

  private addSelection(selection: string | string[]): void {
    for (const path of Array.isArray(selection) ? selection : [selection]) {
      const [alias, column] = path.split('.');
      if (!column) {
        this.selected.set(alias, '*');
        continue;
      }
      const current = this.selected.get(alias);
      if (current === '*') continue;
      const set = current ?? new Set<string>();
      set.add(column);
      this.selected.set(alias, set);
    }
  }

  select(selection?: string | string[], rawAlias?: string): this {
    this.record('select', [selection, rawAlias]);
    if (rawAlias !== undefined || selection === undefined) return this;
    if (!this.explicitSelect) {
      this.explicitSelect = true;
      this.selected.clear();
    }
    this.addSelection(selection);
    return this;
  }

  addSelect(selection: string | string[], rawAlias?: string): this {
    this.record('addSelect', [selection, rawAlias]);
    if (rawAlias !== undefined) return this;
    this.addSelection(selection);
    return this;
  }

  private join(
    method: string,
    path: string,
    alias: string,
    selectAll: boolean,
  ): this {
    this.record(method, [path, alias]);
    const [parentAlias, property] = path.split('.');
    this.joins.push({ method, parentAlias, property, alias });
    if (selectAll) this.selected.set(alias, '*');
    return this;
  }

  leftJoin(path: string, alias: string): this {
    return this.join('leftJoin', path, alias, false);
  }
  leftJoinAndSelect(path: string, alias: string): this {
    return this.join('leftJoinAndSelect', path, alias, true);
  }
  innerJoin(path: string, alias: string): this {
    return this.join('innerJoin', path, alias, false);
  }
  innerJoinAndSelect(path: string, alias: string): this {
    return this.join('innerJoinAndSelect', path, alias, true);
  }

  private condition(method: string, args: unknown[]): this {
    this.record(method, args);
    const params = args[1];
    if (params && typeof params === 'object')
      Object.assign(this.params, params);
    return this;
  }
  where(...args: unknown[]): this {
    return this.condition('where', args);
  }
  andWhere(...args: unknown[]): this {
    return this.condition('andWhere', args);
  }
  orderBy(...args: unknown[]): this {
    return this.record('orderBy', args);
  }
  addOrderBy(...args: unknown[]): this {
    return this.record('addOrderBy', args);
  }
  groupBy(...args: unknown[]): this {
    return this.record('groupBy', args);
  }
  distinct(...args: unknown[]): this {
    return this.record('distinct', args);
  }
  skip(...args: unknown[]): this {
    return this.record('skip', args);
  }
  take(...args: unknown[]): this {
    return this.record('take', args);
  }

  /** The id list a query is restricted to, if any. */
  idFilter(): string[] | undefined {
    for (const key of ['detectionIds', 'vulnIds']) {
      if (Array.isArray(this.params[key])) return this.params[key] as string[];
    }
    return undefined;
  }

  private filteredRows(): Row[] {
    const ids = this.idFilter();
    const rows = this.source();
    return ids ? rows.filter((r) => ids.includes(r.id as string)) : rows;
  }

  private project(row: Row, alias: string): Row {
    const selection = this.selected.get(alias);
    const out: Row = {};
    for (const [key, value] of Object.entries(row)) {
      if (RELATIONS.has(key)) {
        const join = this.joins.find(
          (j) => j.parentAlias === alias && j.property === key,
        );
        if (!join || !this.selected.has(join.alias)) continue;
        out[key] = Array.isArray(value)
          ? value.map((v: Row) => this.project(v, join.alias))
          : value
            ? this.project(value as Row, join.alias)
            : value;
        continue;
      }
      if (selection === '*' || selection?.has(key)) out[key] = value;
    }
    return out;
  }

  async getMany(): Promise<Row[]> {
    this.record('getMany', []);
    return this.filteredRows().map((r) => this.project(r, this.rootAlias));
  }

  /** Page flags: ids of the restricted rows that own the inner-joined relation. */
  async getRawMany(): Promise<Row[]> {
    this.record('getRawMany', []);
    const join = this.joins.find(
      (j) => j.method === 'innerJoin' && j.parentAlias === this.rootAlias,
    );
    if (!join) return [];
    // The history userId a query asks for: a byte-exact literal
    // (`CAST(x.userId AS BINARY) = 'system'`), compared with `===` here too.
    const userId = this.calls
      .filter((c) => c.method === 'where' || c.method === 'andWhere')
      .map((c) =>
        /CAST\(\w+\.userId AS BINARY\) = '([^']*)'/.exec(String(c.args[0])),
      )
      .find((m) => m)?.[1];
    return this.filteredRows()
      .filter((r) =>
        ((r[join.property] as Row[] | undefined) ?? []).some(
          (child) => userId === undefined || child.userId === userId,
        ),
      )
      .map((r) => ({ id: r.id }));
  }

  async getCount(): Promise<number> {
    this.record('getCount', []);
    return 0;
  }
}

export class FakeRepository {
  readonly builders: FakeQueryBuilder[] = [];
  /** The entity manager the advisory reads use: no imported advisory. */
  readonly manager = { find: async (): Promise<Row[]> => [] };
  constructor(private readonly rows: () => Row[]) {}
  createQueryBuilder(alias: string): FakeQueryBuilder {
    const qb = new FakeQueryBuilder(alias, () => structuredClone(this.rows()));
    this.builders.push(qb);
    return qb;
  }
}
