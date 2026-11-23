import { createHash } from 'node:crypto';
import {
  generateWebhookToken,
  gitlabProjectIdOf,
  hashWebhookToken,
  legacyWebhookTokenAccepted,
  webhookTokenMatches,
} from './gitlab-webhook-token';

describe('GitLab webhook secret token', () => {
  describe('generateWebhookToken', () => {
    it('draws 32 random bytes, hex encoded', () => {
      const token = generateWebhookToken();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('never returns the same token twice', () => {
      const tokens = new Set(
        Array.from({ length: 50 }, () => generateWebhookToken()),
      );
      expect(tokens.size).toBe(50);
    });
  });

  describe('hashWebhookToken', () => {
    it('is the SHA-256 of the token, hex encoded', () => {
      const token = 'a'.repeat(64);
      expect(hashWebhookToken(token)).toBe(
        createHash('sha256').update(token, 'utf8').digest('hex'),
      );
    });
  });

  describe('webhookTokenMatches', () => {
    const token = generateWebhookToken();
    const hash = hashWebhookToken(token);

    it('accepts the token whose hash is stored', () => {
      expect(webhookTokenMatches(token, [hash])).toBe(true);
    });

    it('accepts the token when one of several stored hashes is its own', () => {
      const other = hashWebhookToken(generateWebhookToken());
      expect(webhookTokenMatches(token, [other, hash])).toBe(true);
    });

    it('refuses another token', () => {
      expect(webhookTokenMatches(generateWebhookToken(), [hash])).toBe(false);
    });

    it('refuses the stored hash itself sent as the token', () => {
      expect(webhookTokenMatches(hash, [hash])).toBe(false);
    });

    it('refuses an empty or missing token, and an empty hash list', () => {
      expect(webhookTokenMatches('', [hash])).toBe(false);
      expect(webhookTokenMatches(undefined, [hash])).toBe(false);
      expect(webhookTokenMatches(token, [])).toBe(false);
    });

    it('ignores malformed stored hashes instead of throwing', () => {
      expect(webhookTokenMatches(token, ['', 'xyz', null, hash])).toBe(true);
      expect(webhookTokenMatches(token, ['', 'xyz', null])).toBe(false);
    });
  });

  describe('gitlabProjectIdOf', () => {
    it('reads project.id (push, merge request events)', () => {
      expect(gitlabProjectIdOf({ project: { id: 42 } })).toBe(42);
    });

    it('reads project_id (project lifecycle events)', () => {
      expect(gitlabProjectIdOf({ project_id: 42 })).toBe(42);
    });

    it('accepts both when they agree', () => {
      expect(gitlabProjectIdOf({ project_id: 42, project: { id: 42 } })).toBe(
        42,
      );
    });

    it('refuses a payload whose two project ids differ', () => {
      // One id would be verified and the other acted on.
      expect(gitlabProjectIdOf({ project_id: 7, project: { id: 42 } })).toBe(
        null,
      );
    });

    it('refuses a payload without a usable project id', () => {
      expect(gitlabProjectIdOf({})).toBe(null);
      expect(gitlabProjectIdOf(null)).toBe(null);
      expect(gitlabProjectIdOf({ project: { id: '42' } })).toBe(null);
      expect(gitlabProjectIdOf({ project_id: 0 })).toBe(null);
      expect(gitlabProjectIdOf({ project_id: -3 })).toBe(null);
      expect(gitlabProjectIdOf({ project_id: 1.5 })).toBe(null);
    });
  });

  describe('legacyWebhookTokenAccepted', () => {
    it('is off unless set to true', () => {
      expect(legacyWebhookTokenAccepted(undefined)).toBe(false);
      expect(legacyWebhookTokenAccepted('')).toBe(false);
      expect(legacyWebhookTokenAccepted('false')).toBe(false);
      expect(legacyWebhookTokenAccepted('1')).toBe(false);
      expect(legacyWebhookTokenAccepted(false)).toBe(false);
    });

    it('is on for true, as a boolean or a string', () => {
      expect(legacyWebhookTokenAccepted(true)).toBe(true);
      expect(legacyWebhookTokenAccepted('true')).toBe(true);
      expect(legacyWebhookTokenAccepted(' TRUE ')).toBe(true);
    });
  });
});
