import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ContainerService } from './container.service';
import { ContainerDetectedImage } from '../../entities/container-detected-image.entity';
import { ContainerDetectedPackage } from '../../entities/container-detected-package.entity';
import { VulnerabilityDetectionsContainer } from '../../entities/container_vulnerability_detections.entity';
import { HistoryItem } from '../../entities/history-item.entity';
import { VulnerabilityOsv } from '../../entities/osv';
import { ResultService } from '../result/result.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import {
  createLoggerMock,
  createMockRepository,
  MockType,
} from '../../test-utils/typeorm-mock.util';
import { Logger } from 'nestjs-pino';
import { computeContainerFingerprint } from '../findings-export/fingerprint.util';

/**
 * Shadow-mode fingerprint on the container family. Task 3's contract is that
 * EVERY newly created detection carries a non-null fingerprint, and that a
 * re-detection produces evidence (a FINGERPRINT_MISMATCH warn) instead of
 * silently keeping a stale digest.
 */
describe('ContainerService — fingerprint (shadow mode)', () => {
  let service: ContainerService;
  let detRepo: MockType<any>;
  let histRepo: MockType<any>;
  let logger: ReturnType<typeof createLoggerMock>;

  const image = {
    id: 'img-1',
    projectId: 'p1',
    artifactName: 'registry/app:1.0.0',
    branch: 'main',
  } as any;

  const pkg = {
    id: 'pkg-1',
    projectId: 'p1',
    packageName: 'openssl',
    packageVersion: '1.1.1k',
    target: 'registry/app:1.0.0 (debian 12.5)',
    class: 'os-pkgs',
    arch: 'x86_64',
  } as any;

  const osvStub = { id: 'CVE-2021-1234' } as any;
  const vulnDto = {
    vulnerabilityId: 'CVE-2021-1234',
    severity: 'high',
    fixedVersion: '1.1.1l',
  } as any;

  const expectedFingerprint = computeContainerFingerprint({
    projectId: 'p1',
    branch: 'main',
    packageName: 'openssl',
    packageVersion: '1.1.1k',
    target: 'registry/app:1.0.0 (debian 12.5)',
    class: 'os-pkgs',
    arch: 'x86_64',
    vulnerabilityIdentifier: 'CVE-2021-1234',
  });

  beforeEach(async () => {
    detRepo = createMockRepository();
    histRepo = createMockRepository();
    logger = createLoggerMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContainerService,
        {
          provide: getRepositoryToken(ContainerDetectedImage),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(ContainerDetectedPackage),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionsContainer),
          useValue: detRepo,
        },
        { provide: getRepositoryToken(HistoryItem), useValue: histRepo },
        {
          provide: getRepositoryToken(VulnerabilityOsv),
          useValue: createMockRepository(),
        },
        {
          provide: ResultService,
          useValue: {
            addHistoryItem: jest.fn(),
            recalculatePriority: jest
              .fn()
              .mockResolvedValue({ priority: 'normal', priorityScore: 0.5 }),
            computeEnvironmentalForProject: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: CvssCalculatorService,
          useValue: {
            computeCvss4Base: jest
              .fn()
              .mockReturnValue({ vector: 'CVSS:4.0/x', baseScore: 8.1 }),
          },
        },
        {
          provide: CvssExplainerService,
          useValue: { buildExplanationForEntity: jest.fn() },
        },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: () => ({}) },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: { getService: () => ({}) },
        },
        { provide: Logger, useValue: logger },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(ContainerService);
    detRepo.save!.mockImplementation(async (x: any) => x);
    histRepo.save!.mockImplementation(async (x: any) => x);
  });

  const upsert = (branch?: string) =>
    (service as any).upsertDetection(
      'p1',
      image,
      pkg,
      osvStub,
      vulnDto,
      branch,
    );

  it('stores a non-null fingerprint on a newly created detection', async () => {
    detRepo.findOne!.mockResolvedValue(null);

    await upsert('main');

    const created = detRepo.create!.mock.calls[0][0];
    expect(created.fingerprint).toBe(expectedFingerprint);
  });

  /**
   * TAG SENSITIVITY — stated in full, because half of it is a gap.
   *
   * The digest's only image-bearing component is the package row's `target`, so
   * what a re-tag does to the fingerprint is exactly what it does to the row:
   *
   * - class='lang-pkgs': the Trivy target is a manifest path INSIDE the image
   *   (`app/package-lock.json`), which no tag touches. Same package row, same
   *   detection row, same fingerprint. This is the case the requirement "a tag
   *   bump is the same image line, not a new finding" describes, and it holds.
   * - class='os-pkgs': the Trivy target is the image reference WITH its tag
   *   (`registry/app:1.0.0 (debian 12.5)`), and `upsertPackage` keys on
   *   `target`. A tag bump is a NEW package row, a NEW detection row and a NEW
   *   fingerprint — the second test below.
   *
   * The previous version of this pair asserted stability while holding
   * `pkg.target` at the OLD tag and moving only `image.artifactName`. Ingestion
   * cannot produce that state: `target` comes straight off the Trivy result
   * section (`processPackagesWithConcurrency` -> `r.target`), so for os-pkgs it
   * moves with the tag. The test therefore asserted a property of an impossible
   * input and hid the gap below.
   *
   * THE GAP, stated so it is not mistaken for a digest bug: in a per-commit-tag
   * pipeline every OS-package finding gets a new row on every scan, so
   * first-seen and dismissal state cannot accumulate for that family — with or
   * without fingerprints, because the ROW is new. Closing it means keying
   * `container_detected_packages` on a tag-stripped image reference, which is a
   * migration and a change to user-visible dedup semantics. It must be decided
   * before fingerprints become authoritative, not after.
   */
  it('keeps ONE fingerprint across a re-tag when the row does not carry the tag (lang-pkgs)', async () => {
    const langPkg = {
      ...pkg,
      packageName: 'lodash',
      packageVersion: '4.17.20',
      target: 'app/package-lock.json',
      class: 'lang-pkgs',
      arch: null,
    };
    detRepo.findOne!.mockResolvedValue(null);

    await (service as any).upsertDetection(
      'p1',
      image,
      langPkg,
      osvStub,
      vulnDto,
      'main',
    );
    const first = detRepo.create!.mock.calls[0][0].fingerprint;

    detRepo.create!.mockClear();
    // Re-scanned after a re-tag: the manifest path is unchanged, so this is the
    // same package row and the same detection row.
    await (service as any).upsertDetection(
      'p1',
      { ...image, artifactName: 'registry/app:1.0.1' },
      langPkg,
      osvStub,
      vulnDto,
      'main',
    );

    expect(detRepo.create!.mock.calls[0][0].fingerprint).toBe(first);
  });

  it('gives an OS-package finding a NEW fingerprint on a re-tag, because it is a new row', async () => {
    detRepo.findOne!.mockResolvedValue(null);

    await upsert('main');
    const first = detRepo.create!.mock.calls[0][0].fingerprint;

    detRepo.create!.mockClear();
    await (service as any).upsertDetection(
      'p1',
      { ...image, artifactName: 'registry/app:1.0.1' },
      { ...pkg, id: 'pkg-2', target: 'registry/app:1.0.1 (debian 12.5)' },
      osvStub,
      vulnDto,
      'main',
    );

    // NOT a digest defect: `upsertPackage` keys on `target`, so this really is a
    // different package row and a different detection row. The digest mirroring
    // it is the contract. See the gap note above.
    expect(detRepo.create!.mock.calls[0][0].fingerprint).not.toBe(first);
  });

  /**
   * The digest must be a function of the ROW, never of the request that
   * happened to touch it.
   *
   * `upsertPackage` keys on {projectId, packageName, packageVersion, target,
   * class, arch} (container.service.ts) and `upsertDetection` on
   * {vulnerability, detectedPackage, projectId, branch} — NEITHER carries the
   * image, and the package lookup in `processVulnsWithConcurrency` is narrower
   * still ({projectId, packageName, target}). For class='lang-pkgs' the Trivy
   * target is a manifest path INSIDE the image (`app/package-lock.json`),
   * routinely identical across two images built from one repo, so image A and
   * image B share ONE package row and ONE detection row.
   *
   * Hashing the current scan's image gave that single row two digests: whoever
   * scanned first won, and every later scan of the other image logged a
   * FINGERPRINT_MISMATCH on unchanged code — destroying the only divergence
   * evidence shadow mode produces. Worse, `det.detectedImage = image` below
   * re-points the row at the latest scan, so the identity would have been a
   * function of a mutable pointer.
   *
   * The second assertion is the UNMET half of the requirement "two images in
   * one project produce different fingerprints", and the reason this test is
   * not a victory lap: two images really do collapse onto
   * ONE finding here, attributed to whichever image scanned last. No digest can
   * split one row in two. Closing it means scoping
   * `container_detected_packages` / `container_vulnerability_detections` per
   * image — a migration, and a change to what users see as one finding, which
   * has to be decided before fingerprints become authoritative.
   */
  it('never mismatches when two images share one detection row (and they share ONE finding)', async () => {
    const langPkg = {
      ...pkg,
      packageName: 'lodash',
      packageVersion: '4.17.20',
      target: 'app/package-lock.json',
      class: 'lang-pkgs',
      arch: null,
    };

    detRepo.findOne!.mockResolvedValue(null);
    await (service as any).upsertDetection(
      'p1',
      image,
      langPkg,
      osvStub,
      vulnDto,
      'main',
    );
    const stored = detRepo.create!.mock.calls[0][0].fingerprint;
    expect(stored).toMatch(/^[0-9a-f]{64}$/);

    // Second image of the same project re-finds THAT row: the where-clause has
    // no image in it.
    const existing = {
      id: 'det-1',
      branch: 'main',
      currentState: 'to_verify',
      fingerprint: stored,
    } as any;
    detRepo.findOne!.mockResolvedValue(existing);
    detRepo.create!.mockClear();

    await (service as any).upsertDetection(
      'p1',
      { ...image, id: 'img-2', artifactName: 'registry/other:1.0.0' },
      langPkg,
      osvStub,
      vulnDto,
      'main',
    );

    const warned = logger.warn.mock.calls.map((c: any[]) => String(c[0]));
    expect(warned.filter((m) => m.includes('FINGERPRINT_MISMATCH'))).toEqual(
      [],
    );
    expect(existing.fingerprint).toBe(stored);

    // The unmet half: the second image created NO second row, and the one row
    // now points at the second image. Two images, one finding.
    expect(detRepo.create).not.toHaveBeenCalled();
    expect(existing.detectedImage?.id).toBe('img-2');
  });

  /**
   * The requirement "two images in one project produce different
   * fingerprints" is met for os-pkgs and NOT met for lang-pkgs. Both halves
   * are asserted here rather than only the flattering one.
   *
   * The mechanism is the ROW, never the image name: the digest has no image
   * component, so two images separate exactly when their package rows separate.
   * A test that varies `artifactName` AND `target` together proves nothing about
   * image identity — it is the target doing all the work — which is what the
   * previous "separates two images whose OS packages carry the image in the
   * Trivy target" test did, making it a copy of the plain target test below.
   */
  it('separates two images only through the target their rows carry, never through the image name', async () => {
    detRepo.findOne!.mockResolvedValue(null);

    await upsert('main');
    const first = detRepo.create!.mock.calls[0][0].fingerprint;

    // os-pkgs: the target embeds the image reference, so two images are two
    // package rows and two digests.
    detRepo.create!.mockClear();
    await (service as any).upsertDetection(
      'p1',
      { ...image, id: 'img-2', artifactName: 'registry/other:1.0.0' },
      { ...pkg, id: 'pkg-2', target: 'registry/other:1.0.0 (debian 12.5)' },
      osvStub,
      vulnDto,
      'main',
    );
    expect(detRepo.create!.mock.calls[0][0].fingerprint).not.toBe(first);

    // Hold the row and change ONLY the image: the digest does not move. This is
    // the half of the requirement the digest cannot satisfy on its own.
    detRepo.create!.mockClear();
    await (service as any).upsertDetection(
      'p1',
      { ...image, id: 'img-3', artifactName: 'registry/third:1.0.0' },
      pkg,
      osvStub,
      vulnDto,
      'main',
    );
    expect(detRepo.create!.mock.calls[0][0].fingerprint).toBe(first);
  });

  it('separates two package rows that differ only by Trivy target', async () => {
    detRepo.findOne!.mockResolvedValue(null);
    await upsert('main');
    const first = detRepo.create!.mock.calls[0][0].fingerprint;

    detRepo.create!.mockClear();
    await (service as any).upsertDetection(
      'p1',
      image,
      { ...pkg, target: 'app/package-lock.json', class: 'lang-pkgs' },
      osvStub,
      vulnDto,
      'main',
    );

    expect(detRepo.create!.mock.calls[0][0].fingerprint).not.toBe(first);
  });

  it('backfills a NULL fingerprint on the re-detection (update) path', async () => {
    const existing = {
      id: 'det-1',
      branch: 'main',
      currentState: 'to_verify',
      fingerprint: null,
    } as any;
    detRepo.findOne!.mockResolvedValue(existing);

    await upsert('main');

    expect(existing.fingerprint).toBe(expectedFingerprint);
  });

  it('warns FINGERPRINT_MISMATCH and never overwrites a stored fingerprint', async () => {
    const existing = {
      id: 'det-1',
      branch: 'main',
      currentState: 'to_verify',
      fingerprint: 'stale-digest',
    } as any;
    detRepo.findOne!.mockResolvedValue(existing);

    await upsert('main');

    expect(existing.fingerprint).toBe('stale-digest');
    const warned = logger.warn.mock.calls.map((c: any[]) => String(c[0]));
    expect(
      warned.some(
        (m) =>
          m.includes('FINGERPRINT_MISMATCH') &&
          m.includes('det-1') &&
          m.includes(expectedFingerprint),
      ),
    ).toBe(true);
  });

  // ── the branch component must come from the ROW, not from the scan ─────

  /**
   * `branch` is legitimately undefined whenever the security-scanning getScan
   * call fails — container only logs a warning and carries on, unlike sast-iac
   * which throws a fail-safe. `upsertDetection`'s whereClause adds `branch`
   * only when the parameter is truthy, so a branchless scan still re-finds a
   * row created with branch='main'. Taking the branch component from the scan
   * then contradicts the row's own `branch` column.
   */
  it('takes the branch from the ROW when the scan could not resolve one', async () => {
    const existing = {
      id: 'det-1',
      branch: 'main',
      currentState: 'to_verify',
      fingerprint: expectedFingerprint,
    } as any;
    detRepo.findOne!.mockResolvedValue(existing);

    // Branchless scan: upsertImage would have produced branch='' on its own
    // image row, so neither the parameter nor image.branch says 'main'.
    await (service as any).upsertDetection(
      'p1',
      { ...image, branch: '' },
      pkg,
      osvStub,
      vulnDto,
      undefined,
    );

    const warned = logger.warn.mock.calls.map((c: any[]) => String(c[0]));
    expect(warned.some((m) => m.includes('FINGERPRINT_MISMATCH'))).toBe(false);
    expect(existing.fingerprint).toBe(expectedFingerprint);
  });

  it('stamps a branchless new detection with a branchless digest', async () => {
    // The create only sets `branch` when the parameter is truthy, so the row's
    // column is NULL — the digest must agree with the column it will be stored
    // next to, or the planned UNIQUE (projectId, branch, fingerprint) is built
    // on two contradictory values.
    detRepo.findOne!.mockResolvedValue(null);

    await (service as any).upsertDetection(
      'p1',
      { ...image, branch: '' },
      pkg,
      osvStub,
      vulnDto,
      undefined,
    );

    const created = detRepo.create!.mock.calls[0][0];
    expect(created.branch).toBeUndefined();
    expect(created.fingerprint).toBe(
      computeContainerFingerprint({
        projectId: 'p1',
        branch: null,
        packageName: 'openssl',
        packageVersion: '1.1.1k',
        target: 'registry/app:1.0.0 (debian 12.5)',
        class: 'os-pkgs',
        arch: 'x86_64',
        vulnerabilityIdentifier: 'CVE-2021-1234',
      }),
    );
  });
});
