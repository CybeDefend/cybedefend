import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PolicyEvaluation } from '@entities/policy-evaluation.entity';
import { EvaluationService } from './evaluation.service';
import { EvaluationController } from './evaluation.controller';
import { EvaluationQueueModule } from '@modules/evaluation-queue/evaluation-queue.module';
import { PolicyModule } from '@modules/policy/policy.module';

/**
 * Evaluation module - handles triggering and checking policy evaluations.
 * Uses BullMQ for asynchronous processing.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PolicyEvaluation]),
    EvaluationQueueModule,
    PolicyModule,
  ],
  controllers: [EvaluationController],
  providers: [EvaluationService],
  exports: [EvaluationService],
})
export class EvaluationModule {}
