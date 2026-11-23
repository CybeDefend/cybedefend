import { Module } from '@nestjs/common';
import { TokenCipherService } from './token-cipher.service';

/**
 * SecretsService comes from the global SecretsModule.
 */
@Module({
  providers: [TokenCipherService],
  exports: [TokenCipherService],
})
export class TokenCipherModule {}
