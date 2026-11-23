import { Project } from 'src/entities/project.entity';
import {
  CapturedStatement,
  createSqlCaptureDataSource,
} from 'src/test-utils/sql-capture.util';
import { MailService } from './mail.service';

/**
 * Per-member products: the AppSec e-mails (weekly,
 * monthly and daily-critical reports) go only to members with AppSec once the
 * organisation's switch is on. A team member without AppSec is no recipient;
 * the creator and administrators always hold AppSec; an organisation whose
 * switch is off keeps today's recipients. The real-MySQL proof is in
 * `organization/member-products.race.live.spec.ts`.
 */
describe('MailService: AppSec report recipients follow the member products', () => {
  let statements: CapturedStatement[];
  let svc: MailService;

  beforeEach(async () => {
    const capture = await createSqlCaptureDataSource(() => []);
    statements = capture.statements;
    svc = new MailService(
      {} as never, // secretsService
      { get: () => '' } as never, // configService
      {} as never, // organizationRepo
      capture.dataSource.getRepository(Project) as never,
      { log: jest.fn(), error: jest.fn(), warn: jest.fn() } as never,
    );
  });

  const recipientsSql = async () => {
    await (
      svc as unknown as {
        fetchProjectAccessPairs: (ids: string[]) => Promise<unknown>;
      }
    ).fetchProjectAccessPairs(['p1']);
    expect(statements).toHaveLength(1);
    // Compared without TypeORM's identifier quoting (`org`.`id`).
    return statements[0].sql.replace(/`/g, '').replace(/\s+/g, ' ');
  };

  it('keeps the creator and administrators of the organisation, whatever the switch', async () => {
    const sql = await recipientsSql();

    expect(sql).toContain(
      "EXISTS (SELECT 1 FROM users_organizations_members uom WHERE uom.organizationId = org.id AND uom.userId = u.id AND uom.role IN ('creator', 'administrator'))",
    );
  });

  it('a team member is a recipient only while the switch is off, or when they hold AppSec', async () => {
    const sql = await recipientsSql();

    expect(sql).toContain(
      'EXISTS (SELECT 1 FROM teams_members tm WHERE tm.teamId = team.id AND tm.userId = u.id) AND (org.member_products = FALSE OR EXISTS (SELECT 1 FROM users_organizations_members uap WHERE uap.organizationId = org.id AND uap.userId = u.id AND uap.appsec_access = TRUE))',
    );
  });
});
