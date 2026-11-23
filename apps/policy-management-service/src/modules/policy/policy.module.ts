import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SecurityPolicy } from '@entities/security-policy.entity';
import { PolicyService } from './policy.service';
import { PolicyController } from './policy.controller';
import { PolicyValidationService } from './policy-validation.service';
import { PolicyYamlService } from './policy-yaml.service';
import { GrpcModule } from '@core/grpc/grpc.module';

/**
 * Policy module - handles CRUD operations for security policies.
 * Provides gRPC endpoints for policy management.
 */
@Module({
  imports: [TypeOrmModule.forFeature([SecurityPolicy]), GrpcModule.register()],
  controllers: [PolicyController],
  providers: [PolicyService, PolicyValidationService, PolicyYamlService],
  exports: [PolicyService, PolicyValidationService],
})
export class PolicyModule {}
