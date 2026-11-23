import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import puppeteer, { Browser } from 'puppeteer';
import type { PDFOptions } from 'puppeteer';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { escapeHtml } from './html-escape';
import { hardenReportPage } from './pdf-page-hardening';
import {
  CYBEDEFEND_LOGO_BASE64,
  CYBEDEFEND_LOGO_MIME,
} from '../../modules/reports/shared/logo-base64';
import { getFooterFontFaceCss } from '../../modules/reports/shared/report-fonts';

interface PdfOptions {
  /**
   * Selector to wait on before capture. Defaults to `.footer`. Pass `null`
   * to opt out. There is no script-driven wait: the page runs no script
   * (`pdf-page-hardening.ts`), every template is static HTML and SVG.
   */
  waitForSelector?: string | null;
  timeout?: number;
  /**
   * Document name shown in the running footer (left side, next to the logo).
   * Each report passes its own title; absent → footer shows only the logo and
   * page numbers. PDF-only (Puppeteer print media) — not visible in the
   * dashboard iframe preview.
   */
  footerTitle?: string;
}

/**
 * HTML of the running footer stamped on every PDF page by Puppeteer.
 * Left: CybeDefend logo + document title. Right: `Page X / Y`.
 *
 * Puppeteer renders header/footer templates in an isolated context that does
 * NOT inherit the page CSS and defaults to a zero font-size — every style must
 * be inline and explicit. Only the `pageNumber`/`totalPages`/`title`/`date`/
 * `url` classes are interpolated by Chromium. The title is escaped: it can
 * carry tenant-controlled data (project/scope name). A title too long for
 * its line (a project name is a varchar(255)) is elided on one line; the
 * page count never shrinks nor wraps (the full name is on the cover).
 */
function renderRunningFooter(footerTitle?: string): string {
  const title = footerTitle ? escapeHtml(footerTitle) : '';
  return `<style>${getFooterFontFaceCss()}</style>
<div style="width: 100%; box-sizing: border-box; padding: 0 14mm; font-size: 8px; color: #736c7f; font-family: 'Rubik', 'FreeSans', Arial, sans-serif; -webkit-print-color-adjust: exact;">
  <div style="display: flex; align-items: center; justify-content: space-between; border-top: 0.5px solid #e7e3ee; padding-top: 5px;">
    <div style="display: flex; align-items: center; gap: 6px; flex: 1 1 auto; min-width: 0;">
      <img src="data:${CYBEDEFEND_LOGO_MIME};base64,${CYBEDEFEND_LOGO_BASE64}" style="height: 10px; width: auto; flex: none;" />
      <span style="flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">${title}</span>
    </div>
    <div style="flex: none; margin-left: 12px; white-space: nowrap;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>
  </div>
</div>`;
}

/**
 * Builds the option object passed to `page.pdf()`. Extracted as a pure function
 * so the running footer / margins are unit-testable without launching a real
 * browser (the test puppeteer stub ignores `page.pdf()` options). Page geometry
 * stays engine-driven (`preferCSSPageSize: false`); the bottom margin reserves
 * room for the footer band.
 */
export function buildPdfPageOptions(footerTitle?: string): PDFOptions {
  return {
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: false,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: renderRunningFooter(footerTitle),
    margin: {
      top: '14mm',
      right: '14mm',
      bottom: '17mm',
      left: '14mm',
    },
  };
}

/**
 * Service responsible for PDF generation using Puppeteer.
 * Handles proper cleanup of temporary Chrome profile directories to prevent
 * disk space issues (ENOSPC errors).
 */
@Injectable()
export class PdfGeneratorService implements OnModuleDestroy {
  private tempDirs: Set<string> = new Set();

  constructor(private readonly logger: Logger) {}

  /**
   * Cleanup all tracked temporary directories on module destroy
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log('Cleaning up PDF generator temporary directories...');
    await this.cleanupAllTempDirs();
  }

  /**
   * Generate PDF from HTML content
   * Properly manages Chrome profile directories to prevent disk space issues
   */
  async generatePDF(html: string, options: PdfOptions = {}): Promise<Buffer> {
    const { timeout = 30000, footerTitle } = options;
    const waitForSelector =
      options.waitForSelector === undefined
        ? '.footer'
        : options.waitForSelector;

    let browser: Browser | null = null;
    let userDataDir: string | null = null;

    try {
      // Create a unique temporary directory for this Chrome instance
      userDataDir = await this.createTempDir();
      this.logger.log(`Created temporary Chrome profile at: ${userDataDir}`);

      this.logger.log('Launching browser for PDF generation');
      browser = await puppeteer.launch({
        headless: 'shell',
        executablePath:
          process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        userDataDir, // Use our managed temporary directory
        protocolTimeout: 60000,
        // `--no-sandbox`: the containers run with no-new-privileges and no
        // capability, so neither Chromium sandbox can start there (see
        // pdf-page-hardening.ts); the page lock below holds a hostile document.
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-extensions',
          '--disable-features=VizDisplayCompositor',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-breakpad',
          '--disable-background-networking',
          '--disable-component-extensions-with-background-pages',
          '--disable-ipc-flooding-protection',
          '--mute-audio',
          '--no-first-run',
          '--no-default-browser-check',
        ],
        dumpio: false,
        ignoreDefaultArgs: ['--enable-automation'],
      });

      const page = await browser.newPage();

      const blocked = new Map<string, number>();
      await hardenReportPage(page, (scheme) => {
        blocked.set(scheme, (blocked.get(scheme) ?? 0) + 1);
      });

      await page.setContent(html, {
        waitUntil: 'domcontentloaded',
        timeout,
      });

      await page.evaluate(() => document.fonts.ready);

      if (waitForSelector) {
        this.logger.log(
          `Waiting for selector '${waitForSelector}' to be visible...`,
        );
        await page.waitForSelector(waitForSelector, { visible: true, timeout });
      }

      // `setContent` writes into `about:blank`; any other URL means the
      // document was replaced (a navigation that got through), so whatever
      // would be printed is not the report
      if (page.url() !== 'about:blank') {
        throw new Error('the report page left its document');
      }

      this.logger.log('Generating PDF from HTML content');
      const pdfBuffer = await page.pdf(buildPdfPageOptions(footerTitle));

      if (blocked.size > 0) {
        // the schemes and counts only: a URL can carry an internal host or
        // the data an injected document tried to send
        const summary = [...blocked]
          .map(([scheme, count]) => `${scheme}${count}`)
          .join(',');
        this.logger.warn(`PDF_RENDER_REQUEST_BLOCKED schemes=${summary}`);
      }

      this.logger.log('PDF generation completed successfully');
      return Buffer.from(pdfBuffer);
    } catch (error) {
      this.logger.error(
        `Failed to generate PDF: ${error.message}`,
        error.stack,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: `PDF generation failed: ${error.message}`,
      });
    } finally {
      // Always close the browser first
      if (browser) {
        try {
          await browser.close();
          this.logger.log('Browser closed successfully');
        } catch (closeError) {
          this.logger.warn('Error closing browser', {
            error: closeError.message,
          });
        }
      }

      // Then cleanup the temporary directory
      if (userDataDir) {
        await this.cleanupTempDir(userDataDir);
      }
    }
  }

  /**
   * Create a unique temporary directory for Chrome profile
   */
  private async createTempDir(): Promise<string> {
    const tempBase = await fs.realpath(os.tmpdir());
    const prefix = 'cybedefend_puppeteer_';
    const uniqueDir = path.join(
      tempBase,
      `${prefix}${Date.now()}_${Math.random().toString(36).substring(2, 10)}`,
    );

    await fs.mkdir(uniqueDir, { recursive: true });
    this.tempDirs.add(uniqueDir);

    return uniqueDir;
  }

  /**
   * Cleanup a specific temporary directory
   */
  private async cleanupTempDir(dirPath: string): Promise<void> {
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
      this.tempDirs.delete(dirPath);
      this.logger.log(`Cleaned up temporary directory: ${dirPath}`);
    } catch (error) {
      this.logger.warn(`Failed to cleanup temporary directory: ${dirPath}`, {
        error: error.message,
      });
    }
  }

  /**
   * Cleanup all tracked temporary directories
   */
  private async cleanupAllTempDirs(): Promise<void> {
    const cleanupPromises = Array.from(this.tempDirs).map((dir) =>
      this.cleanupTempDir(dir),
    );
    await Promise.allSettled(cleanupPromises);
  }

  /**
   * Cleanup stale Puppeteer temporary directories
   * Call this periodically or on startup to clean up orphaned directories
   */
  async cleanupStaleTempDirs(maxAgeMs: number = 3600000): Promise<number> {
    const tempBase = await fs.realpath(os.tmpdir());
    let cleanedCount = 0;

    try {
      const entries = await fs.readdir(tempBase, { withFileTypes: true });
      const now = Date.now();

      for (const entry of entries) {
        // Match both our custom prefix and Puppeteer's default prefix
        if (
          entry.isDirectory() &&
          (entry.name.startsWith('cybedefend_puppeteer_') ||
            entry.name.startsWith('puppeteer_dev_chrome_profile-'))
        ) {
          const dirPath = path.join(tempBase, entry.name);
          try {
            const stats = await fs.stat(dirPath);
            const age = now - stats.mtimeMs;

            if (age > maxAgeMs) {
              await fs.rm(dirPath, { recursive: true, force: true });
              cleanedCount++;
              this.logger.log(
                `Cleaned up stale temp directory: ${dirPath} (age: ${Math.round(age / 60000)}min)`,
              );
            }
          } catch {
            // Directory might have been deleted already, ignore
          }
        }
      }
    } catch (error) {
      this.logger.warn('Error during stale temp directory cleanup', {
        error: error.message,
      });
    }

    if (cleanedCount > 0) {
      this.logger.log(
        `Cleaned up ${cleanedCount} stale Puppeteer temp directories`,
      );
    }

    return cleanedCount;
  }
}
