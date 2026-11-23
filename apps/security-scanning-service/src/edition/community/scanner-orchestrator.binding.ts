import type { Provider } from '@nestjs/common';
import { SCANNER_ORCHESTRATOR_PORT } from '../ports/scanner-orchestrator.port';
import { CommunityScannerOrchestrator } from './scanner-orchestrator.community';

export const SCANNER_ORCHESTRATOR_COMMUNITY_BINDINGS: Provider[] = [
  {
    provide: SCANNER_ORCHESTRATOR_PORT,
    useClass: CommunityScannerOrchestrator,
  },
];
