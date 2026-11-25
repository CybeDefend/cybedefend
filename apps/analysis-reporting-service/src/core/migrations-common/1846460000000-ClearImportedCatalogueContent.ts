import { MigrationInterface, QueryRunner } from 'typeorm';
import { isCommunityEdition } from '../../edition/edition';

/**
 * Community Edition only: empties the shared advisory catalogue once.
 *
 * The Community Edition runs no advisory synchronisation, so every row of
 * `vulnerability_osv` and of its child tables was written by a results
 * import, before imports kept their content in each project's own
 * `imported_advisory` row. That content was chosen by one project and shown
 * to others: this migration deletes every child row (aliases, references,
 * severities, affected packages with their ranges and events) and empties the
 * text of every root (summary, details, database_specific, related,
 * upstream), keeping each root so the detections keep their key. A finding
 * imported before then shows no advisory text until its project imports or
 * scans it again.
 *
 * In any other edition `up` returns before issuing a single statement: the
 * catalogue there is the advisory synchronisation's, and is neither read nor
 * scanned. `down` cannot bring the content back and does nothing.
 *
 * Portable statements only (plain DELETE and UPDATE without engine syntax).
 */
export class ClearImportedCatalogueContent1846460000000 implements MigrationInterface {
  name = 'ClearImportedCatalogueContent1846460000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!isCommunityEdition()) return;
    // Children first, the deepest first, so no cascade is relied upon.
    for (const table of [
      'vulnerability_osv_affected_event',
      'vulnerability_osv_affected_range',
      'vulnerability_osv_affected',
      'vulnerability_osv_alias',
      'vulnerability_osv_reference',
      'vulnerability_osv_severity',
    ]) {
      await queryRunner.query(`DELETE FROM ${table}`);
    }
    await queryRunner.query(
      'UPDATE vulnerability_osv SET summary = NULL, details = NULL, database_specific = NULL, related = NULL, upstream = NULL',
    );
  }

  async down(): Promise<void> {
    // The content cannot be restored.
  }
}
