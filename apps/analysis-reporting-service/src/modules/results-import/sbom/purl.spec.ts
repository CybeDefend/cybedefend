import { ecosystemOfPurlType, packageOfPurl, parsePurl } from './purl';

describe('parsePurl', () => {
  it('decodes a scoped npm purl', () => {
    expect(parsePurl('pkg:npm/%40babel/code-frame@7.12.13')).toEqual({
      type: 'npm',
      namespace: ['@babel'],
      name: 'code-frame',
      version: '7.12.13',
    });
  });

  it('takes a raw @ in an npm scope, and the version after the last segment', () => {
    expect(parsePurl('pkg:npm/@types/node@20.11.0')).toEqual({
      type: 'npm',
      namespace: ['@types'],
      name: 'node',
      version: '20.11.0',
    });
  });

  it('drops the qualifiers and the subpath', () => {
    expect(
      parsePurl('pkg:maven/org.apache.commons/commons-lang3@3.12.0?type=jar'),
    ).toEqual({
      type: 'maven',
      namespace: ['org.apache.commons'],
      name: 'commons-lang3',
      version: '3.12.0',
    });
    expect(parsePurl('pkg:cargo/serde@1.0.193#src/lib.rs')).toMatchObject({
      name: 'serde',
      version: '1.0.193',
    });
    expect(
      parsePurl('pkg:deb/debian/curl@7.88.1-10?arch=amd64&distro=debian-12'),
    ).toEqual({
      type: 'deb',
      namespace: ['debian'],
      name: 'curl',
      version: '7.88.1-10',
    });
  });

  it('lower-cases the type and keeps a purl without version', () => {
    expect(parsePurl('pkg:PyPI/requests')).toEqual({
      type: 'pypi',
      namespace: [],
      name: 'requests',
      version: undefined,
    });
  });

  it('accepts the scheme followed by slashes', () => {
    expect(parsePurl('pkg://golang/github.com/gin-gonic/gin@v1.9.1')).toEqual({
      type: 'golang',
      namespace: ['github.com', 'gin-gonic'],
      name: 'gin',
      version: 'v1.9.1',
    });
  });

  it.each([
    'npm/lodash@1.0.0',
    'pkg:',
    'pkg:npm',
    'pkg:npm/',
    'pkg:npm/%E0%A4%A@1.0.0',
    'pkg:/lodash@1.0.0',
    'pkg:n pm/lodash@1.0.0',
  ])('refuses %s', (purl) => {
    expect(parsePurl(purl)).toBeNull();
  });
});

describe('packageOfPurl', () => {
  const of = (purl: string) => packageOfPurl(parsePurl(purl)!);

  it('names an npm package with its scope, as the SARIF does', () => {
    expect(of('pkg:npm/%40babel/code-frame@7.12.13')).toEqual({
      name: '@babel/code-frame',
      ecosystem: 'npm',
    });
  });

  it('names a Maven package group:artifact, as Trivy does', () => {
    expect(of('pkg:maven/org.apache.commons/commons-lang3@3.12.0')).toEqual({
      name: 'org.apache.commons:commons-lang3',
      ecosystem: 'Maven',
    });
  });

  it('names a Go module by its whole path', () => {
    expect(of('pkg:golang/github.com/gin-gonic/gin@v1.9.1')).toEqual({
      name: 'github.com/gin-gonic/gin',
      ecosystem: 'Go',
    });
  });

  it('names a distribution package without its distribution', () => {
    expect(of('pkg:deb/debian/curl@7.88.1-10')).toEqual({
      name: 'curl',
      ecosystem: 'Debian',
    });
    expect(of('pkg:apk/alpine/musl@1.2.5-r0')).toEqual({
      name: 'musl',
      ecosystem: 'Alpine',
    });
    expect(of('pkg:rpm/redhat/openssl@3.0.7')).toEqual({
      name: 'openssl',
      ecosystem: 'Red Hat',
    });
  });

  it('keeps a namespace in the name of the other types', () => {
    expect(of('pkg:composer/laravel/framework@10.0.0')).toEqual({
      name: 'laravel/framework',
      ecosystem: 'Packagist',
    });
  });
});

describe('ecosystemOfPurlType', () => {
  it.each([
    ['npm', 'npm'],
    ['pypi', 'PyPI'],
    ['golang', 'Go'],
    ['cargo', 'crates.io'],
    ['maven', 'Maven'],
    ['composer', 'Packagist'],
    ['gem', 'RubyGems'],
    ['nuget', 'NuGet'],
    ['pub', 'Pub'],
    ['hex', 'Hex'],
    ['apk', 'Alpine'],
    ['deb', 'Debian'],
    ['rpm', 'Red Hat'],
  ])('%s is %s, the name the SARIF path writes', (type, ecosystem) => {
    expect(ecosystemOfPurlType(type)).toBe(ecosystem);
  });

  it('keeps any other type as it is', () => {
    expect(ecosystemOfPurlType('cocoapods')).toBe('cocoapods');
  });
});
