import { ConfigService } from '@nestjs/config';
import {
  SlackMessageService,
  SlackMessagePayload,
} from './slack-message.service';

// A branch name, a project name or a scanned value is shown to the channel as
// text. Slack reads `<…>` in mrkdwn as a mention (`<!here>`, `<!channel>`,
// `<@U…>`) or a link with a label of its own choosing (`<url|label>`), and a
// back-tick closes the code span a value is shown in. None of them may reach
// the message as markup.

const HOSTILE_BRANCH =
  'rel` <!here> *Security notice* <https://sso.example.test/x|Your session expired - sign in again> `x';
const HOSTILE_PROJECT =
  'VD <!channel> <https://sso.example.test/x|Acme SSO> & co';

function service(): SlackMessageService {
  const values: Record<string, string> = {
    APP_PUBLIC_URL: 'https://appsec.acme.test',
  };
  return new SlackMessageService({
    get: (key: string) => values[key],
  } as ConfigService);
}

/** Every text Slack renders from the payload (blocks, attachments, fields). */
function renderedTexts(message: SlackMessagePayload): string[] {
  const texts: string[] = [];
  const blocks = [
    ...(message.blocks ?? []),
    ...(message.attachments ?? []).flatMap((a) => a.blocks),
  ];
  for (const block of blocks) {
    if (block.text?.text) texts.push(block.text.text);
    for (const field of block.fields ?? []) texts.push(field.text);
    for (const element of block.elements ?? []) {
      if (block.type === 'actions') continue;
      if (typeof element.text === 'string') texts.push(element.text);
    }
  }
  return texts;
}

/** No mention, no link, no raw `&`, and every code span closed by us. */
function expectInert(text: string): void {
  expect(text).not.toMatch(/[<>]/);
  expect(text).not.toMatch(/&(?!amp;|lt;|gt;)/);
  // Code spans come in pairs that the value itself cannot add to.
  expect((text.match(/`/g) ?? []).length % 2).toBe(0);
}

describe('SlackMessageService — user and scanned values are inert text', () => {
  it('scan complete: a hostile branch and project name carry no mention, link or extra code span', () => {
    const payload = {
      projectId: 'p-1',
      projectName: HOSTILE_PROJECT,
      total: 1,
      scannerType: 'sast,<!here>',
      branch: HOSTILE_BRANCH,
      severities: { critical: 1 },
      types: { sast: 1, '<!everyone>': 1 },
    };

    const message = service().buildMessage('scan_complete', payload);
    const texts = renderedTexts(message);

    for (const text of texts) expectInert(text);
    const joined = texts.join('\n');
    expect(joined).toContain('&lt;!here&gt;');
    expect(joined).toContain('&lt;!channel&gt;');
    // The branch is shown whole, inside one code span of its own.
    expect(joined).toContain(
      "`rel' &lt;!here&gt; *Security notice* &lt;https://sso.example.test/x|Your session expired - sign in again&gt; 'x`",
    );
  });

  it('the fallback text escapes the project name', () => {
    const text = service().getFallbackText('scan_complete', {
      projectName: HOSTILE_PROJECT,
      total: 1,
    });

    expectInert(text);
    expect(text).toBe(
      'Scan completed for VD &lt;!channel&gt; &lt;https://sso.example.test/x|Acme SSO&gt; &amp; co: 1 vulnerabilities found',
    );
  });

  it.each(['zero_day_alert', 'weekly_report', 'monthly_report', 'other'])(
    'the fallback text of %s escapes the project name',
    (type) => {
      expectInert(
        service().getFallbackText(type, {
          projectName: HOSTILE_PROJECT,
          count: '<!here>',
        }),
      );
    },
  );

  it('zero-day alert: hostile project, title, package, version and branch stay text', () => {
    const payload = {
      projectId: 'p-1',
      projectName: HOSTILE_PROJECT,
      count: 1,
      vulnerabilities: [
        {
          id: 'GHSA-x',
          title: 'Bad <!here> <https://evil.example|Fix now>',
          severity: 'critical',
          cvss: '9.8 <!channel>',
          packageName: 'pkg`<!here>`',
          version: '1.0.0`<https://evil.example|x>',
          branch: HOSTILE_BRANCH,
        },
      ],
    };

    const texts = renderedTexts(
      service().buildMessage('zero_day_alert', payload),
    );

    for (const text of texts) expectInert(text);
    expect(texts.join('\n')).toContain('&lt;!here&gt;');
  });

  it('weekly report: a hostile project name stays text', () => {
    const texts = renderedTexts(
      service().buildMessage('weekly_report', {
        projectId: 'p-1',
        projectName: HOSTILE_PROJECT,
        total: 3,
        severities: { critical: '<!here>' },
        newCount: '<!channel>',
        resolvedCount: 0,
      }),
    );

    for (const text of texts) expectInert(text);
  });

  it('generic message: the message is shown as text', () => {
    const texts = renderedTexts(
      service().buildMessage('other', {
        message: 'Hello <!here> <https://evil.example|click>',
      }),
    );

    expect(texts).toEqual([
      'Hello &lt;!here&gt; &lt;https://evil.example|click&gt;',
    ]);
  });

  it('bidirectional controls are removed from names, so a branch or a package cannot be shown reordered', () => {
    const payload = {
      projectId: 'p-1',
      projectName: 'web\u202Etxt.exe',
      count: 1,
      total: 1,
      branch: 'fix\u2066\u202Enim\u2069',
      scannerType: 'sast',
      vulnerabilities: [
        {
          id: 'GHSA-x',
          title: 'Bad \u202Dthing',
          packageName: 'pkg\u200F',
          version: '1.0\u200E',
          branch: 'main\u202A',
        },
      ],
    };
    const bidi = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
    for (const type of ['scan_complete', 'zero_day_alert']) {
      for (const text of renderedTexts(service().buildMessage(type, payload))) {
        expect(text).not.toMatch(bidi);
      }
      expect(service().getFallbackText(type, payload)).not.toMatch(bidi);
    }
  });

  it('an ordinary branch and project name read as before', () => {
    const texts = renderedTexts(
      service().buildMessage('scan_complete', {
        projectId: 'p-1',
        projectName: 'VD-web',
        total: 0,
        scannerType: 'sast',
        branch: 'main',
      }),
    );

    expect(texts).toContain('*VD-web*  —  `main`  ·  SAST');
  });
});
