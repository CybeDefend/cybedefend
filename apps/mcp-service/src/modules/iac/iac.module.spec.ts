import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';

import { IacModule } from './iac.module';
import { ToolRegistry } from '../mcp/tools/registry';
import { SESSION_STORE } from '../mcp/session/session-store.interface';
import { InMemorySessionStore } from '../mcp/session/session.store';

describe('IacModule', () => {
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
        IacModule,
      ],
    }).compile();

    registry = moduleRef.get(ToolRegistry);
    sessionStore = moduleRef.get<InMemorySessionStore>(SESSION_STORE);
    await moduleRef.init();
  });

  afterEach(() => {
    sessionStore.stop();
  });

  it('registers list_vulnerabilities_iac and get_vulnerability_iac', () => {
    const names = registry.all().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'list_vulnerabilities_iac',
        'get_vulnerability_iac',
      ]),
    );
  });
});
