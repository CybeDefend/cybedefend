import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { StartScanBodyDto } from 'src/modules/scan/dto/body/start-scan-body.dto';
import {
  PRODUCT_KEYS,
  assertLinkScanPermission,
  isGraphOnlyProduct,
  productCreateScanFields,
  registerProduct,
  registerScanKindPolicy,
  resetProductRegistryForTests,
  scanReadPermission,
  startScanPermission,
} from './products';

/**
 * The core product registry: one mutable array (`PRODUCT_KEYS`, the reference
 * `@IsIn` keeps) plus the policies the closed side registers at
 * instantiation time. Alone, the core serves `appsec` only and refuses any
 * other product at validation.
 */
describe('product registry (core seam)', () => {
  afterEach(() => resetProductRegistryForTests());

  it('starts with appsec only', () => {
    expect(PRODUCT_KEYS).toEqual(['appsec']);
  });

  it('refuses a product nobody registered', async () => {
    const errors = await validate(
      plainToInstance(StartScanBodyDto, { product: 'closed-product' }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('product');
    expect(errors[0].constraints?.isIn).toBe(
      'product must be one of the following values: appsec',
    );
  });

  it('maps an absent or unknown product to start_scan', () => {
    expect(startScanPermission(undefined)).toBe('start_scan');
    expect(startScanPermission('nope')).toBe('start_scan');
    expect(isGraphOnlyProduct(undefined)).toBe(false);
    expect(isGraphOnlyProduct('nope')).toBe(false);
  });

  it('reads a registered product', () => {
    const ref = PRODUCT_KEYS;
    registerProduct('x', {
      startScanPermission: 'use_x',
      graphOnly: true,
      createScanFields: { xOnly: true },
    });
    expect(startScanPermission('x')).toBe('use_x');
    expect(isGraphOnlyProduct('x')).toBe(true);
    expect(productCreateScanFields('x')).toEqual({ xOnly: true });
    expect(productCreateScanFields(undefined)).toEqual({});
    // One array object for the process: @IsIn keeps its reference.
    expect(PRODUCT_KEYS).toBe(ref);
    expect(PRODUCT_KEYS).toEqual(['appsec', 'x']);
    // Idempotent: registering twice appends the key once.
    registerProduct('x', {
      startScanPermission: 'use_x',
      graphOnly: true,
      createScanFields: { xOnly: true },
    });
    expect(PRODUCT_KEYS).toEqual(['appsec', 'x']);
  });

  it('answers read_scan_result for a scan no policy owns, then the owning policy', () => {
    expect(scanReadPermission({})).toBe('read_scan_result');
    registerScanKindPolicy({
      owns: (s) => !!(s as { isDiffScan?: boolean }).isDiffScan,
      readPermission: 'use_x',
    });
    expect(scanReadPermission({ isDiffScan: true })).toBe('use_x');
    expect(scanReadPermission({})).toBe('read_scan_result');
  });

  describe('assertLinkScanPermission', () => {
    it('throws ForbiddenException without a user', async () => {
      const promise = assertLinkScanPermission(
        { checkPermission: jest.fn() },
        {},
        'p1',
        undefined,
      );
      await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
      await expect(promise).rejects.toThrow('Permission denied');
    });

    it('throws ForbiddenException when the checker says no', async () => {
      const checker = { checkPermission: jest.fn().mockResolvedValue(false) };
      const promise = assertLinkScanPermission(
        checker,
        { user: { sub: 'u1' } },
        'p1',
        undefined,
      );
      await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
      await expect(promise).rejects.toThrow('Permission denied');
    });

    it('checks (projectId, project, start_scan, userId) for an absent product', async () => {
      const checker = { checkPermission: jest.fn().mockResolvedValue(true) };
      await assertLinkScanPermission(
        checker,
        { user: { sub: 'u1' } },
        'p1',
        undefined,
      );
      expect(checker.checkPermission).toHaveBeenCalledTimes(1);
      expect(checker.checkPermission).toHaveBeenCalledWith(
        'p1',
        'project',
        'start_scan',
        'u1',
      );
    });
  });
});
