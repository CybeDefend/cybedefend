import { CommunityProductLinks } from './product-links.community';

function linksWith(values: Record<string, string | undefined>) {
  return new CommunityProductLinks({ get: (key: string) => values[key] });
}

// A self-hosted instance links its tickets and its GitHub App return to its
// own dashboard, never to a vendor website.
describe('CommunityProductLinks', () => {
  describe('ticketFooterUrl', () => {
    it("is the instance's dashboard URL, without a trailing slash", () => {
      expect(
        linksWith({
          FRONTEND_URL: 'https://appsec.example.org/',
        }).ticketFooterUrl(),
      ).toBe('https://appsec.example.org');
      expect(
        linksWith({
          APP_PUBLIC_URL: 'https://scan.example.org',
        }).ticketFooterUrl(),
      ).toBe('https://scan.example.org');
    });

    it('is undefined, so the footer carries no link, when no public URL is set', () => {
      expect(linksWith({}).ticketFooterUrl()).toBeUndefined();
      expect(
        linksWith({ FRONTEND_URL: '  ' }).ticketFooterUrl(),
      ).toBeUndefined();
    });

    it('is undefined for a value that is not an http(s) URL', () => {
      expect(
        linksWith({ FRONTEND_URL: 'javascript:alert(1)' }).ticketFooterUrl(),
      ).toBeUndefined();
      expect(
        linksWith({ FRONTEND_URL: 'not a url' }).ticketFooterUrl(),
      ).toBeUndefined();
    });
  });

  describe('githubInstallReturnUri', () => {
    it("is the instance's dashboard URL", () => {
      expect(
        linksWith({
          FRONTEND_URL: 'https://appsec.example.org/',
        }).githubInstallReturnUri(),
      ).toBe('https://appsec.example.org');
    });

    it("is the Community compose's default when nothing is set", () => {
      expect(linksWith({}).githubInstallReturnUri()).toBe(
        'http://localhost:8080',
      );
    });
  });
});

describe('PRODUCT_LINKS_COMMUNITY_BINDINGS', () => {
  it('resolves without the configuration module, from the process environment', async () => {
    const { Test } = await import('@nestjs/testing');
    const { PRODUCT_LINKS_COMMUNITY_BINDINGS } =
      await import('./product-links.binding');
    const { PRODUCT_LINKS_PORT } = await import('../ports/product-links.port');
    const previous = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://appsec.example.org';
    try {
      const moduleRef = await Test.createTestingModule({
        providers: PRODUCT_LINKS_COMMUNITY_BINDINGS,
      }).compile();
      expect(moduleRef.get(PRODUCT_LINKS_PORT).githubInstallReturnUri()).toBe(
        'https://appsec.example.org',
      );
    } finally {
      if (previous === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = previous;
    }
  });
});
