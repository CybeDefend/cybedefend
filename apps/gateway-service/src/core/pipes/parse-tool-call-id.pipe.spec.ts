// src/core/pipes/parse-tool-call-id.pipe.spec.ts
//
// Tool-call ids on the global chat are NOT UUIDs.
// Devstral (and most OpenAI-style models) emit short alphanumeric
// identifiers (e.g. ``9iLfg92Zw``) as the ``tool_call.id`` of an
// assistant turn, and the agent persists them verbatim so the
// subsequent ``tool_result`` block can reference the same id.
// ParseUUIDPipe on these routes therefore rejected every legitimate
// confirm/reject call from the dashboard with a 400 — completely
// breaking the HITL flow.
//
// This pipe accepts the LLM-style id format while still rejecting any
// path-traversal / injection attempts (no slashes, dots, spaces,
// non-ASCII). UUIDs match the same regex by coincidence, so the
// loosening does NOT regress the existing UUID-path callers.
import { BadRequestException } from '@nestjs/common';

import { ParseToolCallIdPipe } from './parse-tool-call-id.pipe';

describe('ParseToolCallIdPipe', () => {
  const pipe = new ParseToolCallIdPipe();

  describe('accepts', () => {
    it('passes a Devstral-style short alphanumeric id', () => {
      // Real id captured from a Devstral-2512 streaming response.
      expect(pipe.transform('9iLfg92Zw')).toBe('9iLfg92Zw');
    });

    it('passes an OpenAI-style "call_xxx" id', () => {
      // GPT-4o / gpt-4-turbo tool_call ids look like ``call_<24 alnum>``.
      // The pipe must keep working if we ever swap the model.
      expect(pipe.transform('call_abc123def456ghi789jkl0')).toBe(
        'call_abc123def456ghi789jkl0',
      );
    });

    it('passes the agent fallback id "tc-<hex>"', () => {
      // ``llm_orchestrator._handle_write_pending`` falls back to
      // ``tc-{uuid4().hex}`` when the LLM emits an empty id. That
      // shape is 35 chars, alnum + one hyphen — well within bounds.
      expect(pipe.transform('tc-deadbeefdeadbeefdeadbeefdeadbeef')).toBe(
        'tc-deadbeefdeadbeefdeadbeefdeadbeef',
      );
    });

    it('passes a canonical v4 UUID (back-compat)', () => {
      // The existing UUID callers must not regress. UUIDs match the
      // alphanumeric+hyphen regex naturally.
      const u = '11111111-2222-3333-4444-555555555555';
      expect(pipe.transform(u)).toBe(u);
    });
  });

  describe('rejects', () => {
    it('throws BadRequestException on empty string', () => {
      // An empty id reaches the service as an empty path segment — the
      // route would not even match in practice, but we keep the
      // assertion in case a caller injects a manual call.
      expect(() => pipe.transform('')).toThrow(BadRequestException);
    });

    it('throws BadRequestException on slash (path traversal)', () => {
      // The whole reason we are not using ``string`` directly: a slash
      // would let a malicious caller forge a different route segment.
      expect(() => pipe.transform('foo/bar')).toThrow(BadRequestException);
    });

    it('throws BadRequestException on whitespace', () => {
      expect(() => pipe.transform('foo bar')).toThrow(BadRequestException);
    });

    it('throws BadRequestException on dot', () => {
      // Dots have semantic meaning in URLs (relative paths, dotfiles).
      // The LLM never emits them — refuse and surface a clear 400.
      expect(() => pipe.transform('foo.bar')).toThrow(BadRequestException);
    });

    it('throws BadRequestException on length > 64', () => {
      const tooLong = 'a'.repeat(65);
      expect(() => pipe.transform(tooLong)).toThrow(BadRequestException);
    });

    it('throws BadRequestException on non-ascii', () => {
      // Unicode confusables (cyrillic ``а`` vs latin ``a``) are a
      // classic spoofing vector. Restrict to ASCII alnum + ``_-``.
      expect(() => pipe.transform('café')).toThrow(BadRequestException);
    });
  });
});
