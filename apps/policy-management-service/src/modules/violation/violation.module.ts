import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PolicyViolation } from '@entities/policy-violation.entity';
import { PolicyEvaluation } from '@entities/policy-evaluation.entity';
import { SecurityPolicy } from '@entities/security-policy.entity';
import { ViolationService } from './violation.service';
import { ViolationController } from './violation.controller';
import { PolicyModule } from '../policy/policy.module';
import { GrpcModule } from '@core/grpc/grpc.module';

/**
 * Violation module - handles policy violation records and statistics.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PolicyViolation,
      PolicyEvaluation,
      SecurityPolicy,
    ]),
    forwardRef(() => PolicyModule),
    GrpcModule.register(),
  ],
  controllers: [ViolationController],
  providers: [ViolationService],
  exports: [ViolationService],
})
export class ViolationModule {}
