import {
  advisoryCwes,
  comparePackageVersions,
  formatReportDate,
  formatReportDay,
  groupBy,
  highestPackageVersion,
  isActiveState,
  isDistroVersion,
  isDuplicateAdvisory,
  isPrereleaseVersion,
  isWithdrawnAdvisory,
  redactQuotedSecrets,
  redactSecrets,
} from './report-findings';

describe('shared/report-findings', () => {
  // A dependency or container advisory is mapped to the CWE Top 25 through
  // the CWE ids of its OSV record, in the per-project and the organisation
  // CWE reports alike.
  describe('advisoryCwes', () => {
    it('reads database_specific.cwe_ids, normalised and deduplicated', () => {
      expect(
        advisoryCwes({ cwe_ids: ['CWE-22', 'cwe-22', 79, 'NVD-CWE-Other'] }),
      ).toEqual(['CWE-22', 'CWE-79']);
    });

    it('maps nothing without a CWE list', () => {
      expect(advisoryCwes(null)).toEqual([]);
      expect(advisoryCwes({ cwe_ids: 'CWE-22' })).toEqual([]);
      expect(advisoryCwes({})).toEqual([]);
    });
  });

  describe('isActiveState', () => {
    it('treats triaged-away states as inactive, like the dashboard overview and the report emails', () => {
      for (const s of ['ignored', 'RESOLVED', 'not_exploitable']) {
        expect(isActiveState(s)).toBe(false);
      }
      for (const s of ['to_verify', 'confirmed', '', undefined]) {
        expect(isActiveState(s)).toBe(true);
      }
    });
  });

  describe('groupBy', () => {
    it('groups items by key, keeping first-seen order', () => {
      const groups = groupBy(['b1', 'a1', 'b2'], (s) => s[0]);
      expect(groups.map((g) => [g.key, g.items])).toEqual([
        ['b', ['b1', 'b2']],
        ['a', ['a1']],
      ]);
    });
  });

  describe('package versions', () => {
    // The ImageMagick of an Ubuntu image: an epoch, then a Debian revision.
    const MAGICK = '8:6.9.11.60+dfsg-1.6ubuntu1.3';
    const MAGICK_FIX = '8:6.9.11.60+dfsg-1.6ubuntu1.4';
    const both = (a: string, b: string) => [
      highestPackageVersion([a, b]),
      highestPackageVersion([b, a]),
    ];

    it('never reads the epoch of a Debian or RPM version as its major version', () => {
      expect(both(MAGICK, MAGICK_FIX)).toEqual([MAGICK_FIX, MAGICK_FIX]);
      expect(comparePackageVersions(MAGICK, MAGICK_FIX)).toBeLessThan(0);
      // `1:2.3.4-1` is 2.3.4, never 1.0.0.
      expect(both('1:2.3.4-1', '1:2.3.10-1')).toEqual([
        '1:2.3.10-1',
        '1:2.3.10-1',
      ]);
      expect(comparePackageVersions('1:2.3.4-1', '1:1.9.0-1')).toBeGreaterThan(
        0,
      );
      expect(comparePackageVersions('1:2.3.4-1', '1:2.3.4-1')).toBe(0);
      // As in dpkg, a higher epoch wins whatever follows it.
      expect(comparePackageVersions('2:1.0-1', '1:9.9-1')).toBeGreaterThan(0);
    });

    it('orders distribution revisions as the package manager does', () => {
      for (const [lower, higher] of [
        ['3.0.13-0ubuntu3.4', '3.0.13-0ubuntu3.5'],
        ['1:1.2.11.dfsg-2+deb11u1', '1:1.2.11.dfsg-2+deb11u10'],
        ['1.2.5-r9', '1.2.5-r10'],
        ['2.31-13', '2.31-13+deb11u5'],
        // A backport sorts before the release it comes from.
        ['1.37.0-1~bpo11+1', '1.37.0-1'],
        ['1.2.3-4.el8', '1.2.3-4.el8_5.1'],
      ]) {
        expect(comparePackageVersions(lower, higher)).toBeLessThan(0);
        expect(comparePackageVersions(higher, lower)).toBeGreaterThan(0);
      }
    });

    it('keeps the semver order of a language package, a final release after its pre-releases', () => {
      expect(highestPackageVersion(['4.17.12', '4.17.21', '4.17.4'])).toBe(
        '4.17.21',
      );
      expect(both('1.0.10rc1', '1.0.10')).toEqual(['1.0.10', '1.0.10']);
      expect(both('2.13.4', '2.13.4.2')).toEqual(['2.13.4.2', '2.13.4.2']);
      expect(
        comparePackageVersions('1.0.0-alpha.8', '1.0.0-alpha.10'),
      ).toBeLessThan(0);
      expect(comparePackageVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0);
      expect(comparePackageVersions('7.1.2-15', '7.1.2-20')).toBeLessThan(0);
    });

    it('prefers a readable version, and has none in an empty list', () => {
      expect(highestPackageVersion(['', 'latest', '1.2.0'])).toBe('1.2.0');
      expect(highestPackageVersion(['', undefined])).toBeUndefined();
    });

    it('recognises the version of a distribution package', () => {
      for (const v of [
        MAGICK,
        '1:2.3.4-1',
        '3.0.13-0ubuntu3.4',
        '1.1.1n-0+deb11u5',
        '3.0.11-1~deb12u2',
        '1.2.11.dfsg-2',
        '8.32-4+b1',
        '1.2.3-4.el8',
        '2.0.1-1.amzn2023',
        '3.5.5-r0',
      ]) {
        expect(isDistroVersion(v)).toBe(true);
      }
      // An upstream version, whatever its suffix: the ImageMagick patch
      // level an advisory cites, a pre-release, a build.
      for (const v of [
        '7.1.2-15',
        '4.17.21',
        '1.0.0-alpha.10',
        '2.7.1-rc1',
        '1.0.10rc1',
        'v1.2.3',
        '1.0.0+build.1',
        '',
      ]) {
        expect(isDistroVersion(v)).toBe(false);
      }
    });

    it('recognises a pre-release, never in the revision of a distribution package', () => {
      for (const v of ['1.0.10rc1', '2.0.0-beta.1', '5.0.0rc3', '2.0~rc1-1']) {
        expect(isPrereleaseVersion(v)).toBe(true);
      }
      // `+b1` rebuilds a Debian package, `-r0` is an Alpine release.
      for (const v of ['1.0.10', '8.32-4+b1', '3.5.6-r0', '1.37.0-1~bpo11+1']) {
        expect(isPrereleaseVersion(v)).toBe(false);
      }
    });
  });

  describe('formatReportDate / formatReportDay', () => {
    it('formats in UTC, readable, never raw ISO', () => {
      expect(formatReportDate('2026-09-23T10:50:27.123Z')).toBe(
        '23 Sep 2026, 10:50 UTC',
      );
      expect(formatReportDay('2026-09-23T23:50:27.123Z')).toBe('23 Sep 2026');
    });

    it('returns an em dash for missing or invalid dates', () => {
      expect(formatReportDate(undefined)).toBe('—');
      expect(formatReportDay('not a date')).toBe('—');
    });
  });

  describe('redactSecrets', () => {
    it.each([
      ['sk_live_EXAMPLEKEYEXAMPLEKEY0000', 'sk_live_••••0000'],
      ['rk_test_51H8abcdefghijklmnopqrstu', 'rk_test_••••rstu'],
      ['AKIAIOSFODNN7EXAMPLE', 'AKIA••••MPLE'],
      ['ghp_1234567890abcdefghijklmnopqrstuvwxyz', 'ghp_••••wxyz'],
      [
        'github_pat_11ABCDEFG0123456789_abcdefghijklmnop',
        'github_pat_••••mnop',
      ],
      ['xoxb-1234567890-abcdefghijklmn', 'xoxb-••••klmn'],
      ['AIzaSyA1234567890abcdefghijklmnopqrstu', 'AIza••••rstu'],
    ])('masks %s', (secret, masked) => {
      expect(redactSecrets(`key = "${secret}";`)).toBe(`key = "${masked}";`);
    });

    it('masks the body of a private key block', () => {
      const out = redactSecrets(
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----',
      );
      expect(out).not.toContain('MIIEowIBAAKCAQEA');
      expect(out).toContain('-----BEGIN RSA PRIVATE KEY-----');
    });

    it('leaves ordinary text alone', () => {
      const text = 'Use sk_live_ keys only on the server (see docs).';
      expect(redactSecrets(text)).toBe(text);
    });
  });

  describe('redactQuotedSecrets', () => {
    it('keeps every redactSecrets pattern', () => {
      expect(redactQuotedSecrets('key AKIAIOSFODNN7EXAMPLE here')).toBe(
        'key AKIA••••MPLE here',
      );
      const pem = redactQuotedSecrets(
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----',
      );
      expect(pem).not.toContain('MIIEowIBAAKCAQEA');
    });

    it('masks a JWT, a bearer token and the password of a URL', () => {
      expect(
        redactQuotedSecrets(
          'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U sent',
        ),
      ).toBe('token eyJ•••• sent');
      expect(
        redactQuotedSecrets('Authorization: Bearer abcdef0123456789abcdef=='),
      ).toBe('Authorization: Bearer ••••');
      expect(
        redactQuotedSecrets('connect to mongodb://admin:s3cr3tPass@db:27017/x'),
      ).toBe('connect to mongodb://admin:••••@db:27017/x');
    });

    it.each([
      [
        'cookieSecret: "session_cookie_secret_key_here"',
        'cookieSecret: "••••"',
      ],
      ["API_KEY='abcd1234efgh'", "API_KEY='••••'"],
      ['password = "hunter22"', 'password = "••••"'],
      ['"client_secret": "0123-abcd"', '"client_secret": "••••"'],
      ['db.credentials = `root:toor`', 'db.credentials = `••••`'],
    ])('masks the literal assigned to a secret name: %s', (input, output) => {
      expect(redactQuotedSecrets(input)).toBe(output);
    });

    it('is idempotent', () => {
      const text =
        'cookieSecret: "session_cookie_secret_key_here", Bearer abcdef0123456789abcdef, ' +
        'mongodb://u:p4ss@h, eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N, ' +
        'AKIAIOSFODNN7EXAMPLE';
      const once = redactQuotedSecrets(text);
      expect(redactQuotedSecrets(once)).toBe(once);
    });

    it('leaves code and prose that only name a secret alone', () => {
      for (const text of [
        'const tokens = tokenize(input);',
        'The password field is rendered without autocomplete="off".',
        'Rotate the `cookieSecret` and move it to an environment secret.',
        'The token: none was found.',
      ]) {
        expect(redactQuotedSecrets(text)).toBe(text);
      }
    });
  });

  describe('isWithdrawnAdvisory / isDuplicateAdvisory', () => {
    it('recognises an advisory withdrawn by its publisher, from its title or its text', () => {
      for (const [title, description] of [
        [
          'Withdrawn Advisory: express improperly controls query properties',
          '',
        ],
        ['Withdrawn: ESLint dependencies are vulnerable', ''],
        ['Duplicate Advisory: uuid: Missing buffer bounds check', ''],
        [
          'High severity vulnerability that affects qs',
          'Withdrawn, accidental duplicate publish.\n\nThe qs module…',
        ],
        [
          'Moderate severity vulnerability that affects marked',
          '# Withdrawn\n\nThis advisory has been withdrawn, per NVD.',
        ],
        [
          'Out-of-Bounds read',
          'Versions less than 0.0.6 are vulnerable.\n\n# WITHDRAWN\n\nThis is a duplicate.',
        ],
        ['Anything', '**Withdrawn**\nGitHub has withdrawn this advisory.'],
      ]) {
        expect(isWithdrawnAdvisory(title, description)).toBe(true);
      }
      expect(
        isWithdrawnAdvisory(
          'express vulnerable to XSS via response.redirect()',
          'A redirect to an untrusted URL; the withdrawn parameter is ignored.',
        ),
      ).toBe(false);
      expect(isWithdrawnAdvisory(undefined, undefined)).toBe(false);
    });

    it('recognises a withdrawn advisory that repeats another one', () => {
      expect(
        isDuplicateAdvisory(
          'Duplicate Advisory: uuid: Missing buffer bounds check',
          '## Duplicate Advisory\nThis advisory has been withdrawn because it is a duplicate of GHSA-w5hq-g745-h8pq.',
        ),
      ).toBe(true);
      expect(
        isDuplicateAdvisory(
          'High severity vulnerability that affects qs',
          'Withdrawn, accidental duplicate publish.',
        ),
      ).toBe(true);
      // Withdrawn for another reason.
      expect(
        isDuplicateAdvisory(
          'Withdrawn Advisory: express improperly controls query properties',
          '## Withdrawn Advisory\nThis advisory has been withdrawn because it describes a correctness bug.',
        ),
      ).toBe(false);
      // Not withdrawn: a duplicate word alone flags nothing.
      expect(
        isDuplicateAdvisory(
          'Duplicate keys in a map',
          'A duplicate key is accepted.',
        ),
      ).toBe(false);
    });
  });
});
