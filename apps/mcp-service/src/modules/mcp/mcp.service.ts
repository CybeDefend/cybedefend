import { Inject, Injectable, Optional } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { AbstractMcpService } from './shared/abstract-mcp.service';
import { PromptRegistry } from './prompts/registry';
import {
  AGENT_SESSION_REPORTER,
  type ToolCallReporter,
} from './session/agent-session-reporter.token';
import {
  MCP_EDITION_TEXTS,
  type McpEditionTexts,
} from '../../edition/ports/mcp-edition-texts.port';
import { SessionStore, SESSION_STORE } from './session/session-store.interface';
import { ToolRegistry } from './tools/registry';

/**
 * MCP session lifecycle on the public surface (`POST /mcp`).
 *
 * Consumed by external MCP clients (Claude Desktop, Cursor, third-party
 * integrations) — every session created here is pinned to
 * `surface: 'public'`, which the controller enforces on local hits and
 * cross-pod adoption.
 *
 * The public surface also serves MCP **prompts** (the CybeDefend
 * `cybe-init` / `cybe-review` workflow prompts): the {@link PromptRegistry}
 * is forwarded to {@link AbstractMcpService} so `buildMcpServer` wires the
 * `prompts/list` + `prompts/get` handlers and the edition's server
 * `instructions` string (`MCP_EDITION_TEXTS.serverInstructions`).
 *
 * When the edition provides a reporter (`AGENT_SESSION_REPORTER`), every
 * tool call also reports its session to Gateway.
 */
@Injectable()
export class McpService extends AbstractMcpService {
  protected readonly surface = 'public' as const;

  constructor(
    @Inject(SESSION_STORE) store: SessionStore,
    registry: ToolRegistry,
    promptRegistry: PromptRegistry,
    logger: Logger,
    // Optional: only the cloud edition provides it (AgentSessionsModule);
    // without it tool calls are served unreported.
    @Optional()
    @Inject(AGENT_SESSION_REPORTER)
    sessionReporter?: ToolCallReporter,
    // Optional so that a module compiled without the edition layer (specs)
    // still serves sessions; AppModule's EditionModule always provides it.
    @Optional()
    @Inject(MCP_EDITION_TEXTS)
    texts?: McpEditionTexts,
  ) {
    super(store, registry, logger, promptRegistry, sessionReporter, texts);
  }
}
