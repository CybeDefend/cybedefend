import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import {
  PasswordHashGate,
  passwordHashGateFromEnv,
} from './password-hash-gate';

/**
 * argon2id parameters: m=19456 KiB, t=2, p=1, so every hash starts
 * with `$argon2id$v=19$m=19456,t=2,p=1$`. `algorithm: 2` is Argon2id; the
 * library's `Algorithm` is a `const enum`, which isolatedModules cannot read,
 * so the literal is used.
 */
export const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  algorithm: 2,
} as const;

/** Injection token of the gate; without a provider, the process-wide one. */
export const PASSWORD_HASH_GATE = 'PASSWORD_HASH_GATE';

/** One gate per process, whatever the number of PasswordHasher instances. */
const processGate = passwordHashGateFromEnv();

/**
 * Every hash and verification goes through the PasswordHashGate: a flood of
 * logins cannot run more than its bound of argon2id runs at once, and the
 * overflow is refused UNAVAILABLE `PASSWORD_VERIFICATION_BUSY` (never `false`,
 * which the caller would read as a wrong password).
 */
@Injectable()
export class PasswordHasher {
  /**
   * A hash of random bytes, made once at construction: verifying any real
   * password against it fails but costs one argon2 run, so a login with an
   * unknown e-mail takes the same time as one with a known e-mail.
   */
  private readonly dummyHash: Promise<string>;

  private readonly gate: PasswordHashGate;

  constructor(@Optional() @Inject(PASSWORD_HASH_GATE) gate?: PasswordHashGate) {
    this.gate = gate ?? processGate;
    // Once, at construction: not behind the gate.
    this.dummyHash = hash(
      randomBytes(32).toString('base64url'),
      ARGON2_OPTIONS,
    );
  }

  hash(password: string): Promise<string> {
    return this.gate.run(() => hash(password, ARGON2_OPTIONS));
  }

  /**
   * False on a malformed hash. Throws only the gate's UNAVAILABLE refusal,
   * outside the catch, so a busy verifier is never read as a wrong password.
   */
  async verify(hash: string, password: string): Promise<boolean> {
    return this.gate.run(async () => {
      try {
        return await verify(hash, password);
      } catch {
        return false;
      }
    });
  }

  /** Runs one verification against the dummy hash and always answers false. */
  async verifyAgainstDummy(password: string): Promise<false> {
    await this.verify(await this.dummyHash.catch(() => ''), password);
    return false;
  }
}
