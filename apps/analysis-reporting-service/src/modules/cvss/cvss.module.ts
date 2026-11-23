import { Module } from '@nestjs/common';
import { CvssCalculatorService } from './cvss-calculator.service';
import { CvssExplainerService } from './cvss-explainer.service';

@Module({
  providers: [CvssCalculatorService, CvssExplainerService],
  exports: [CvssCalculatorService, CvssExplainerService],
})
export class CvssModule {}
