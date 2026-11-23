import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SecretVulnerabilityDetections } from 'src/entities/secret-vulnerability-detections.entity';
import { HistoryItem } from 'src/entities/history-item.entity';
import { CryptoModule } from 'src/core/crypto/crypto.module';
import { SecretService } from './secret.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SecretVulnerabilityDetections, HistoryItem]),
    CryptoModule,
  ],
  providers: [SecretService],
  exports: [SecretService],
})
export class SecretModule {}
