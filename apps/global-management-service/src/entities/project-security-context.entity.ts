import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  Unique,
} from 'typeorm';
import { UpdatedAtColumn, UuidPrimaryColumn } from '@cybedefend/db-dialect';
import { Project } from './project.entity';

export enum ProjectEnvironment {
  PRODUCTION = 'production',
  STAGING = 'staging',
  DEVELOPMENT = 'development',
}

export enum InternetExposure {
  PUBLIC = 'public',
  INTERNAL = 'internal',
  AIRGAPPED = 'airgapped',
}

export enum DeploymentType {
  SAAS = 'saas',
  ONPREM = 'onprem',
  EMBEDDED = 'embedded',
  MOBILE = 'mobile',
}

export enum DataClassification {
  PUBLIC = 'public',
  INTERNAL = 'internal',
  CONFIDENTIAL = 'confidential',
  REGULATED = 'regulated',
}

export enum BusinessCriticality {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  MISSION_CRITICAL = 'mission_critical',
}

export enum UserBaseSize {
  SMALL = 'small',
  MEDIUM = 'medium',
  LARGE = 'large',
}

export enum NetworkSegmentation {
  FLAT = 'flat',
  SEGMENTED = 'segmented',
  MICROSEGMENTED = 'microsegmented',
}

@Entity('project_security_context')
@Unique(['projectId'])
export class ProjectSecurityContext {
  @UuidPrimaryColumn()
  id: string;

  @OneToOne(() => Project, (p) => p.securityContext, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project: Project;

  @Column({ type: 'varchar', length: 36 })
  projectId: string;

  @Column({
    type: 'enum',
    enum: ProjectEnvironment,
    default: ProjectEnvironment.PRODUCTION,
  })
  environment: ProjectEnvironment;

  @Column({
    type: 'enum',
    enum: InternetExposure,
    default: InternetExposure.PUBLIC,
  })
  internetExposure: InternetExposure;

  @Column({
    type: 'enum',
    enum: DeploymentType,
    default: DeploymentType.SAAS,
  })
  deploymentType: DeploymentType;

  @Column({
    type: 'enum',
    enum: DataClassification,
    default: DataClassification.CONFIDENTIAL,
  })
  dataClassification: DataClassification;

  @Column({ default: false })
  handlesPii: boolean;

  @Column({ default: false })
  handlesPaymentData: boolean;

  @Column({
    type: 'enum',
    enum: BusinessCriticality,
    default: BusinessCriticality.MEDIUM,
  })
  businessCriticality: BusinessCriticality;

  @Column({
    type: 'enum',
    enum: UserBaseSize,
    default: UserBaseSize.MEDIUM,
  })
  userBaseSize: UserBaseSize;

  @Column('simple-array', { nullable: true })
  complianceFrameworks: string[];

  @Column({ default: false })
  safetyCritical: boolean;

  @Column({
    type: 'enum',
    enum: NetworkSegmentation,
    default: NetworkSegmentation.FLAT,
  })
  networkSegmentation: NetworkSegmentation;

  @Column({ default: false })
  isCustomized: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdatedAtColumn({ precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  updatedAt: Date;
}
