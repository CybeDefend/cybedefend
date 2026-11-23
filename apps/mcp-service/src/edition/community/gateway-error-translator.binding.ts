import type { Provider } from '@nestjs/common';
import { GATEWAY_ERROR_TRANSLATOR } from '../ports/gateway-error-translator.port';

// Community: no product-specific refusal exists, so every gateway failure
// follows the default wrapping path.
export const GATEWAY_ERROR_TRANSLATOR_COMMUNITY_BINDINGS: Provider[] = [
  { provide: GATEWAY_ERROR_TRANSLATOR, useValue: { translate: () => null } },
];
