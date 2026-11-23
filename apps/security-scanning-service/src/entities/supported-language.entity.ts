import { Column, Entity, ManyToOne } from 'typeorm';
import { UuidPrimaryColumn } from '@cybedefend/db-dialect';
import { Scanner } from './scanner.entity';

@Entity()
export class SupportedLanguage {
  @UuidPrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column()
  maturity: string;

  @ManyToOne(() => Scanner, (scanner) => scanner.supportedLanguages)
  scanner: Scanner;
}
