import { isLocalUrl } from './is-local-url';
import { JiraController } from '../jira/jira.controller';

describe('isLocalUrl', () => {
  it.each([
    'http://localhost:3000',
    'http://LOCALHOST:3000',
    'http://127.0.0.1:3000',
    'http://127.0.1.1',
    'http://0.0.0.0:3000',
    'http://[::1]:3000',
    'http://myhost.local',
    'http://myhost.local:8080',
    'http://myhost.local/path',
  ])('flags %s as local', (url) => {
    expect(isLocalUrl(url)).toBe(true);
  });

  it.each([
    'https://app.example.com',
    'https://staging.example.com',
    'https://app.example.com/integrations/linear/callback',
  ])('does not flag %s', (url) => {
    expect(isLocalUrl(url)).toBe(false);
  });

  it('answers like the Jira rule it was taken from, on the same inputs', () => {
    for (const url of [
      'http://localhost:3000',
      'http://127.0.0.1',
      'http://0.0.0.0',
      'http://[::1]',
      'http://dev.local:3000',
      'https://app.example.com',
      'https://staging.example.com',
      '',
    ]) {
      expect(isLocalUrl(url)).toBe(JiraController.isLocalUrl(url));
    }
  });
});
