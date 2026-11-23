/**
 * Jest stub for `puppeteer`.
 *
 * Puppeteer v25 ships as native ESM (`puppeteer.js` does
 * `export * from 'puppeteer-core'`). ts-jest does not transpile files under
 * `node_modules` (default `transformIgnorePatterns`), so importing the real
 * package throws `SyntaxError: Unexpected token 'export'` and crashes every
 * suite that transitively pulls in `core/utils/pdf-generator.service.ts`.
 *
 * No unit test launches a real browser — every report spec injects a mocked
 * `PdfGeneratorService` (`useValue: { generatePDF: jest.fn() }`) — so a no-op
 * stub fully satisfies the static import. Wired via `moduleNameMapper` in the
 * Jest config (`^puppeteer$`).
 */
export type Browser = unknown;

const puppeteer = {
  launch: async () => ({
    newPage: async () => ({
      setContent: async () => undefined,
      pdf: async () => Buffer.from(''),
      close: async () => undefined,
    }),
    close: async () => undefined,
  }),
};

export default puppeteer;
