import type { Provider } from '@nestjs/common';
import { AI_ANALYSIS_PORT } from '../ports/ai-analysis.port';
import { CommunityAiAnalysis } from './ai-analysis.community';

export const AI_ANALYSIS_COMMUNITY_BINDINGS: Provider[] = [
  { provide: AI_ANALYSIS_PORT, useClass: CommunityAiAnalysis },
];
