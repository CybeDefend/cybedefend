import type { Provider } from '@nestjs/common';
import {
  CONFIGURED_FRONTEND_URL_RESOLVER,
  FRONTEND_URL_RESOLVER,
} from '../ports/frontend-url.port';

export const FRONTEND_URL_COMMUNITY_BINDINGS: Provider[] = [
  {
    provide: FRONTEND_URL_RESOLVER,
    useValue: CONFIGURED_FRONTEND_URL_RESOLVER,
  },
];
