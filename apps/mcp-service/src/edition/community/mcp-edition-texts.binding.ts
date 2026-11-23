import type { Provider } from '@nestjs/common';
import { MCP_EDITION_TEXTS } from '../ports/mcp-edition-texts.port';
import { COMMUNITY_MCP_EDITION_TEXTS } from './mcp-edition-texts.community';

export const MCP_EDITION_TEXTS_COMMUNITY_BINDINGS: Provider[] = [
  { provide: MCP_EDITION_TEXTS, useValue: COMMUNITY_MCP_EDITION_TEXTS },
];
