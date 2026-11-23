import { Column, type ColumnType, Entity, PrimaryColumn } from 'typeorm';
import { columnType } from '@cybedefend/db-dialect';

/**
 * An ES256 signing key of the Community Edition's local auth,
 * identified by its `kid`: the private key is stored encrypted
 * (AES-256-GCM), the public key as a JWK for GetJwks. Instance-level: no
 * user key. The table comes from the common migration
 * 1786300000000-CreateLocalIdentityTables; only LocalAuthModule reads or
 * writes it.
 */
@Entity('auth_signing_key')
export class AuthSigningKey {
  @PrimaryColumn({ name: 'kid', type: 'varchar', length: 64 })
  kid: string;

  /** The ES256 private key, AES-256-GCM encrypted; never logged. */
  @Column({ name: 'private_key_encrypted', type: 'text' })
  privateKeyEncrypted: string;

  /** The public key as a JSON Web Key, served by GetJwks. */
  @Column({ name: 'public_jwk', type: 'text' })
  publicJwk: string;

  @Column({
    name: 'created_at',
    type: columnType('datetime') as ColumnType,
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  createdAt: Date;

  @Column({
    name: 'retired_at',
    type: columnType('datetime') as ColumnType,
    precision: 3,
    nullable: true,
  })
  retiredAt: Date | null;
}
