import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';

import { VulnerabilitiesModule } from './vulnerabilities.module';
import { ToolRegistry } from '../mcp/tools/registry';
import { SESSION_STORE } from '../mcp/session/session-store.interface';
import { InMemorySessionStore } from '../mcp/session/session.store';

describe('VulnerabilitiesModule', () => {
  let sessionStore: InMemorySessionStore;
  let registry: ToolRegistry;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({ CYBEDEFEND_API_RESOURCE: 'http://gateway.test.local' }),
          ],
        }),
        LoggerModule.forRoot({ pinoHttp: { level: 'silent' } }),
        VulnerabilitiesModule,
      ],
    }).compile();

    registry = moduleRef.get(ToolRegistry);
    sessionStore = moduleRef.get<InMemorySessionStore>(SESSION_STORE);
    await moduleRef.init();
  });

  afterEach(() => {
    sessionStore.stop();
  });

  it('registers update_vulnerability and set_exploitability (get_similar_vulnerabilities is not registered)', () => {
    const names = registry.all().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['update_vulnerability', 'set_exploitability']),
    );
    expect(names).not.toContain('get_similar_vulnerabilities');
  });
});
