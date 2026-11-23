// user-organization-membership.entity.ts
import { Organization } from './organization.entity';
import { User } from './user.entity';
import { Entity, Index, ManyToOne, Column } from 'typeorm';
import { UuidPrimaryColumn } from '@cybedefend/db-dialect';

@Entity('users_organizations_members')
// Composite index for membership lookups by (organizationId, userId).
// The PK is on the synthetic `id`; only single-column FK indexes exist on
// organizationId / userId, so this composite is NOT redundant.
@Index('IDX_uom_org_user', ['organization', 'user'])
export class UserOrganizationMembership {
  @UuidPrimaryColumn()
  id: string;

  @ManyToOne(() => User, (user) => user.organizationMemberships, {
    onDelete: 'CASCADE',
  })
  user: User;

  @ManyToOne(
    () => Organization,
    (organization) => organization.userMemberships,
    { onDelete: 'CASCADE' },
  )
  organization: Organization;

  @Column()
  role: string;

  /**
   * Per-member products: whether the member holds AppSec /
   * the second product in this organisation. Read only once the organisation's switch
   * (`organization.member_products`) is on; the creator and administrators
   * hold both whatever these say. `boolean`, never an explicit `tinyint`:
   * TypeORM hydrates only the former to a boolean.
   */
  @Column({ name: 'appsec_access', type: 'boolean', default: true })
  appsecAccess: boolean;

  @Column({ name: 'vibedefend_access', type: 'boolean', default: true })
  vibedefendAccess: boolean;
}
