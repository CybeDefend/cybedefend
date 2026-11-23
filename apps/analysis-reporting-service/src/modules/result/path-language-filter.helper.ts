import { SelectQueryBuilder } from 'typeorm';
import { ilike } from '@cybedefend/db-dialect';

/**
 * Applies the `language` (multi-value, exact match) and `sourcePath`
 * (substring "contains" match) filters to a vulnerability detection query builder.
 *
 * Both clauses use parameterised placeholders — the `%...%` wildcards for the
 * LIKE are built inside the params object, never interpolated into the SQL
 * string (owasp-2025-a05: no template-literal SQL).
 */
export function applyLanguageAndSourcePathFilters(
  qb: SelectQueryBuilder<unknown>,
  language: string[] | null | undefined,
  sourcePath: string | null | undefined,
  detectionAlias: string,
): void {
  if (language && language.length > 0) {
    qb.andWhere(`${detectionAlias}.language IN (:...languages)`, {
      languages: language,
    });
  }

  if (sourcePath) {
    qb.andWhere(ilike(`${detectionAlias}.path`, ':sourcePath').text, {
      sourcePath: `%${sourcePath}%`,
    });
  }
}
