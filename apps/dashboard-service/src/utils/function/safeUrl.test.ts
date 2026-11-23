import { describe, it, expect } from 'vitest';
import { isSafeExternalUrl } from './safeUrl';

describe('isSafeExternalUrl', () => {
    it('accepts absolute https URLs', () => {
        expect(isSafeExternalUrl('https://docs.cybedefend.com/guide')).toBe(
            true,
        );
        expect(isSafeExternalUrl('https://example.com')).toBe(true);
    });

    it('accepts absolute http URLs', () => {
        expect(isSafeExternalUrl('http://example.org/path?q=1#frag')).toBe(true);
    });

    it('rejects javascript: / data: / vbscript: / blob: / file: schemes', () => {
        expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
        expect(isSafeExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(
            false,
        );
        expect(isSafeExternalUrl('vbscript:msgbox(1)')).toBe(false);
        expect(isSafeExternalUrl('blob:https://x/y')).toBe(false);
        expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
    });

    it('rejects non-web schemes (mailto:, tel:, ftp:)', () => {
        expect(isSafeExternalUrl('mailto:foo@bar.com')).toBe(false);
        expect(isSafeExternalUrl('tel:+15551234')).toBe(false);
        expect(isSafeExternalUrl('ftp://files.example.com/x')).toBe(false);
    });

    it('rejects protocol-relative URLs', () => {
        expect(isSafeExternalUrl('//evil.com/x')).toBe(false);
    });

    it('rejects relative paths and bare internal paths', () => {
        expect(isSafeExternalUrl('/project/p1')).toBe(false);
        expect(isSafeExternalUrl('foo/bar')).toBe(false);
    });

    it('rejects empty and overly long hrefs (>2048 chars)', () => {
        expect(isSafeExternalUrl('')).toBe(false);
        expect(isSafeExternalUrl('https://example.com/' + 'a'.repeat(2048))).toBe(
            false,
        );
    });

    it('rejects unparseable hrefs', () => {
        expect(isSafeExternalUrl('http://')).toBe(false);
        expect(isSafeExternalUrl('not a url')).toBe(false);
    });
});
