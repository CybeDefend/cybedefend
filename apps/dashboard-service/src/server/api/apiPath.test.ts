import { describe, expect, it } from 'vitest';
import { UNSAFE_API_PATH, UnsafeApiPathError, pathSegment, unsafeApiPath } from './apiPath';

const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

describe('unsafeApiPath', () => {
  // A value taken from the address bar and put in a request path must not move
  // the request to another route: the browser resolves `.` and `..` segments
  // (also when written `%2e`), and some servers read `\` or an encoded
  // separator as `/`.
  it.each([
    `/project/../../policies/${ID}`,
    `/project/${ID}/../../policies/x`,
    `/project/./${ID}`,
    `/project/..`,
    `..`,
    `../organization/x`,
    `/project/%2e%2e/policies/x`,
    `/project/%2E%2E/policies/x`,
    `/project/.%2e/policies/x`,
    `/project/%2e/x`,
    `/project/x%2e/y`,
    `/project/..%2Fpolicies%2Fx`,
    `/project/..%2fpolicies`,
    `/project/x%2F..%2Fy`,
    `/project/..%5Cpolicies`,
    `/project/x%5cy`,
    `/project/x\\y`,
    `/project/..\\policies`,
    `/project/x#/settings`,
    `//attacker.example/steal`,
    `/\\attacker.example/steal`,
    `https://attacker.example/project/../x`,
    // The URL parser strips tabs and line breaks before it resolves `..`.
    `/project/.\t./organization/${ID}/policies/${ID}`,
    `/project/.\n./organization/${ID}/policies/${ID}`,
    `/project/\t../organization/x`,
    `/project/..\r/organization/x`,
    `/project/.\t.%2Forganization%2Fx`,
    `/project/.\t/x`,
    `/\t/attacker.example/x`,
    `/project/x y`,
    `/project/x\u0000y`,
    `/project/x\u007fy`,
    `/project/x\u000by`,
    `/project/${ID}/results/sast/.\t./.\t./.\t./organization/${ID}/report/owasp/json?detailed=false`,
  ])('refuses %j', (url) => {
    expect(unsafeApiPath(url)).toBe(true);
  });

  // The second layer: the candidate is resolved the way the browser resolves
  // it, against the API base, and refused when the result is not the literal
  // path or leaves the base.
  describe('against the API base', () => {
    const BASE = 'https://app.example/api';
    it.each([
      [`/project/${ID}`, false],
      [`project/${ID}/results/sast?branch=a/../b`, false],
      [`/project/${pathSegment('feature/x')}/archive`, false],
      [`/project/.\t./x`, true],
      [`https://attacker.example/project/${ID}`, true],
      [`https://app.example/other/project/${ID}`, true],
      [`https://app.example/api/project/${ID}`, false],
    ])('%j → %s', (url, refused) => {
      expect(unsafeApiPath(url, BASE)).toBe(refused);
    });

    it('accepts a base given as a path of this origin', () => {
      expect(unsafeApiPath(`/project/${ID}`, '/api')).toBe(false);
      expect(unsafeApiPath(`/project/.\t./x`, '/api')).toBe(true);
    });
  });

  // The path shapes the application builds today: ids, nested resources, an
  // encoded value inside one segment (a branch `feature/x`, a registry
  // repository `library/nginx`, an SPDX id), and query strings, whose content
  // is never a path.
  it.each([
    `/project/${ID}`,
    `/project/${ID}/results/sast/${ID}`,
    `/organization/${ID}/projects`,
    `/organization/${ID}/licenses/classifications/Apache-2.0`,
    `/project/${ID}/branches/${encodeURIComponent('feature/x')}/archive`,
    `/project/${ID}/branches/${encodeURIComponent('release-1.0')}/archive`,
    `/integrations/acr/container-registry/project/${ID}/images/${encodeURIComponent('library/nginx')}/tags?page=1`,
    `/project/${ID}/results/sca/licenses/${encodeURIComponent('GPL-2.0+')}/packages`,
    `/project/${ID}/results/sast?branch=release/1.0&search=../x`,
    `/project/${ID}/scan/import/start`,
    `/auth/refresh`,
    `/me/chat/memory`,
    `project/${ID}`,
    ``,
  ])('accepts %s', (url) => {
    expect(unsafeApiPath(url)).toBe(false);
  });

  it('treats a missing url as the base path', () => {
    expect(unsafeApiPath(undefined)).toBe(false);
  });
});

describe('pathSegment', () => {
  it('encodes one value as one segment', () => {
    expect(pathSegment('feature/x')).toBe('feature%2Fx');
    expect(pathSegment(ID)).toBe(ID);
    expect(unsafeApiPath(`/project/${pathSegment('feature/x')}`)).toBe(false);
  });

  it('refuses a value that would be read as a dot segment', () => {
    expect(() => pathSegment('..')).toThrow(UnsafeApiPathError);
    expect(() => pathSegment('.')).toThrow(UnsafeApiPathError);
    expect(() => pathSegment('')).toThrow(UnsafeApiPathError);
  });

  it('carries a stable code', () => {
    try {
      pathSegment('..');
    } catch (error) {
      expect((error as UnsafeApiPathError).code).toBe(UNSAFE_API_PATH);
    }
  });
});
