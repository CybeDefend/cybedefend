import { DEFAULT_GITLAB_API_URL, gitlabWebOrigin } from './gitlab-origin';

describe('gitlabWebOrigin', () => {
  it('gives gitlab.com when the variable is unset', () => {
    expect(gitlabWebOrigin(undefined)).toBe('https://gitlab.com');
    expect(gitlabWebOrigin('')).toBe('https://gitlab.com');
  });

  it('drops /api/v4 and trailing slashes', () => {
    expect(gitlabWebOrigin('https://git.example.org/api/v4/')).toBe(
      'https://git.example.org',
    );
  });

  it('keeps a path prefix of the instance', () => {
    expect(gitlabWebOrigin('https://example.org/gitlab/api/v4')).toBe(
      'https://example.org/gitlab',
    );
  });

  it('exposes the default API URL of the public instance', () => {
    expect(DEFAULT_GITLAB_API_URL).toBe('https://gitlab.com/api/v4');
  });
});
