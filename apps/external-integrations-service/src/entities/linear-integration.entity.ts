import { Entity, Column, OneToMany, Unique } from 'typeorm';
import {
  UuidPrimaryColumn,
  UpdatedAtColumn,
  columnType,
} from '@cybedefend/db-dialect';
import { LinearProjectMapping } from './linear-project-mapping.entity';

@Entity('linear_integrations')
@Unique('UQ_linear_integrations_organizationId', ['organizationId'])
@Unique('UQ_linear_integrations_linearOrganizationId', ['linearOrganizationId'])
export class LinearIntegration {
  @UuidPrimaryColumn()
  id: string;

  @Column({ length: 36 })
  organizationId: string; // CybeDefend organization (one Linear workspace each)

  @Column({ length: 64 })
  linearOrganizationId: string; // Linear workspace ID (one CybeDefend org each)

  @Column({ length: 255 })
  workspaceName: string; // e.g. "Acme"

  @Column({ length: 255 })
  workspaceUrlKey: string; // e.g. "acme" in linear.app/acme

  @Column({ type: 'text' })
  accessToken: string; // Encrypted OAuth access token

  @Column({ type: 'text', nullable: true })
  refreshToken: string; // Encrypted OAuth refresh token

  @Column({ type: columnType('datetime'), nullable: true })
  tokenExpiresAt: Date; // Linear access tokens expire (rotated with the refresh token)

  @Column({ type: columnType('tinyint'), default: 0 })
  needsReconnect: boolean; // Set when Linear revokes the app or refresh fails for good

  @Column({ type: 'varchar', length: 36, nullable: true })
  installedByUserId: string;

  @Column({ type: columnType('datetime'), default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @UpdatedAtColumn({
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;

  @OneToMany(() => LinearProjectMapping, (mapping) => mapping.integration, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  projectMappings: LinearProjectMapping[];
}
