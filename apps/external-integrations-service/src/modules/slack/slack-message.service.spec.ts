import { ConfigService } from '@nestjs/config';
import {
  SlackMessageService,
  SlackMessagePayload,
} from './slack-message.service';

function serviceWith(values: Record<string, string | undefined>) {
  const config = { get: (key: string) => values[key] } as ConfigService;
  return new SlackMessageService(config);
}

const scanCompletePayload = {
  projectId: 'p-1',
  projectName: 'Demo',
  total: 2,
  scannerType: 'semgrep',
  branch: '',
  severities: { critical: 1, high: 1, medium: 0, low: 0 },
  types: { sast: 2 },
};

function buttonUrlOf(message: SlackMessagePayload): string | undefined {
  for (const attachment of message.attachments ?? []) {
    for (const block of attachment.blocks) {
      if (block.type !== 'actions') continue;
      for (const element of block.elements ?? []) {
        if (element.type === 'button') return element.url as string;
      }
    }
  }
  return undefined;
}

describe('SlackMessageService — public app URL', () => {
  it('links to the configured app', () => {
    const service = serviceWith({ APP_PUBLIC_URL: 'https://appsec.acme.test' });

    const message = service.buildMessage('scan_complete', scanCompletePayload);

    const url = buttonUrlOf(message);
    expect(url).toBeDefined();
    expect(url!.startsWith('https://appsec.acme.test/project/p-1/sast')).toBe(
      true,
    );
  });

  // 'never links to the cloud when no URL is configured' is covered by the
  // closed edition's own spec.
});

describe('SlackMessageService — Community Edition instance URL', () => {
  const previous = process.env.CYBEDEFEND_EDITION;
  beforeEach(() => {
    process.env.CYBEDEFEND_EDITION = 'community';
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = previous;
  });

  it('links to the configured instance URL, one trailing slash stripped', () => {
    const service = serviceWith({
      FRONTEND_URL: 'https://appsec.example.org/',
    });

    const url = buttonUrlOf(
      service.buildMessage('scan_complete', scanCompletePayload),
    );

    expect(url).toBe('https://appsec.example.org/project/p-1/sast');
  });

  it('links to the compose default, never a cloud host, when no URL is set', () => {
    const service = serviceWith({});

    const message = service.buildMessage('scan_complete', scanCompletePayload);

    expect(buttonUrlOf(message)).toBe('http://localhost:8080/project/p-1/sast');
    expect(JSON.stringify(message)).not.toContain('cybedefend.com');
  });

  it('replaces a value that is not an http(s) URL with the compose default', () => {
    const service = serviceWith({ FRONTEND_URL: 'gopher://intranet' });

    expect(
      buttonUrlOf(service.buildMessage('scan_complete', scanCompletePayload)),
    ).toBe('http://localhost:8080/project/p-1/sast');
  });
});
