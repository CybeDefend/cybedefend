import { Entity, Column, OneToMany } from 'typeorm';
import { UuidPrimaryColumn } from '@cybedefend/db-dialect';
import { SupportedLanguage } from './supported-language.entity';
import { Container } from './container.entity';

/**
 * [L4] Single source of truth for the scanner-type domain. We keep a
 * runtime tuple (`ScannerTypeValues`) — needed by the TypeORM enum: column
 * and by tests that iterate every supported type — and derive the
 * compile-time union from it via the standard `typeof tuple[number]`
 * pattern, so adding a scanner type only requires editing this tuple.
 */
export const ScannerTypeValues = [
  'sast',
  'iac',
  'sca',
  'container',
  'secret',
  'aibom',
  'cicd',
] as const;
export type ScannerType = (typeof ScannerTypeValues)[number];

@Entity()
export class Scanner {
  @UuidPrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column()
  imageName: string;

  @Column({ default: false })
  enabled: boolean;

  @Column({
    type: 'enum',
    enum: ScannerTypeValues,
    nullable: false,
  })
  scannerType: ScannerType;

  @Column({ nullable: true, default: '1Gi' })
  memoryRequest: string;

  @Column({ nullable: true, default: '500m' })
  cpuRequest: string;

  @Column({ nullable: true, default: '1Gi' })
  memoryLimit: string;

  @Column({ nullable: true, default: '500m' })
  cpuLimit: string;

  // When true (default), pods created by this scanner are deleted at the end of the scan.
  // Set to false to preserve pods for debugging purposes.
  @Column({ default: true })
  deletePodsOnFinish: boolean;

  // When true (default), pods in error state are deleted by the cron job.
  // Set to false to preserve error pods for debugging purposes.
  @Column({ default: true })
  deletePodsOnError: boolean;

  @OneToMany(() => SupportedLanguage, (lang) => lang.scanner)
  supportedLanguages: SupportedLanguage[];

  @OneToMany(() => Container, (container) => container.scanner)
  containers: Container[];
}
