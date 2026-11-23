import { gitlabUrls } from './gitlab-urls';

describe('gitlabUrls', () => {
  it('defaults to gitlab.com', () => {
    const urls = gitlabUrls(undefined);
    expect(urls).toMatchObject({
      api: 'https://gitlab.com/api/v4',
      base: 'https://gitlab.com',
      oauthToken: 'https://gitlab.com/oauth/token',
      oauthRevoke: 'https://gitlab.com/oauth/revoke',
    });
    expect(urls.cloneUrl('g/r')).toBe('https://gitlab.com/g/r.git');
  });

  it('follows a self-managed GitLab', () => {
    const urls = gitlabUrls('https://git.acme.test/api/v4/');
    expect(urls.api).toBe('https://git.acme.test/api/v4');
    expect(urls.base).toBe('https://git.acme.test');
    expect(urls.oauthToken).toBe('https://git.acme.test/oauth/token');
    expect(urls.cloneUrl('g/r')).toBe('https://git.acme.test/g/r.git');
  });

  it('keeps a path prefix', () => {
    const urls = gitlabUrls('https://acme.test/gitlab/api/v4');
    expect(urls.base).toBe('https://acme.test/gitlab');
  });
});
