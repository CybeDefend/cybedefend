import { DECORATORS } from '@nestjs/swagger';
import {
  AgentLaneDto,
  ContainerDto,
  GitHistoryCoverageDto,
  GitHistoryGapDto,
  GitHistoryPassDto,
  ScannerLaneDto,
  ScanPipelineDto,
  ScanResponseDto,
} from './scan-response.dto';

interface PropertyMetadata {
  type?: unknown;
  required?: boolean;
  enum?: unknown[];
  format?: string;
}

/** The Swagger metadata of one property of a DTO class. */
const property = (dto: { prototype: object }, name: string): PropertyMetadata =>
  Reflect.getMetadata(DECORATORS.API_MODEL_PROPERTIES, dto.prototype, name);

/** The class a property is typed with, lazy (`() => X`) or not. */
const typeName = (meta: PropertyMetadata): string | undefined => {
  const type = meta?.type;
  if (typeof type !== 'function') return undefined;
  // A lazy arrow function has no prototype; a class does.
  const resolved = type.prototype ? type : (type as () => unknown)();
  return (resolved as { name?: string })?.name;
};

/** @ApiProperty leaves `required` unset, which the schema reads as true. */
const expectRequired = (meta: PropertyMetadata) => {
  expect(meta).toBeDefined();
  expect(meta.required).not.toBe(false);
};

/**
 * Scan pipeline: `GET /project/:projectId/scan/
 * :scanId` returns where the scan really is. The route passes the gRPC
 * response through untouched, so the OpenAPI document is where an API
 * consumer learns the block and the new container fields exist.
 */
describe('ScanResponseDto — Swagger (scan pipeline)', () => {
  it('documents the optional pipeline', () => {
    const pipeline = property(ScanResponseDto, 'pipeline');
    expect(pipeline).toMatchObject({ required: false });
    expect(typeName(pipeline)).toBe('ScanPipelineDto');
  });

  it('documents the pipeline: slot, queue and both lanes', () => {
    const slot = property(ScanPipelineDto, 'slotReleased');
    expectRequired(slot);
    expect(slot.type).toBe('boolean');
    expect(property(ScanPipelineDto, 'queuePosition')).toMatchObject({
      type: 'integer',
      required: false,
    });
    expect(property(ScanPipelineDto, 'queueReason')).toMatchObject({
      enum: ['org_limit', 'platform_limit', 'starting'],
      required: false,
    });
    const scanners = property(ScanPipelineDto, 'scanners');
    expectRequired(scanners);
    expect(typeName(scanners)).toBe('ScannerLaneDto');
    const agent = property(ScanPipelineDto, 'agent');
    expectRequired(agent);
    expect(typeName(agent)).toBe('AgentLaneDto');
  });

  it('documents the scanner lane counts', () => {
    for (const name of ['total', 'open', 'completed', 'failed']) {
      const count = property(ScannerLaneDto, name);
      expectRequired(count);
      expect(count.type).toBe('integer');
    }
  });

  it('documents the AI lane', () => {
    const stage = property(AgentLaneDto, 'stage');
    expectRequired(stage);
    expect(stage.enum).toEqual([
      'not_applicable',
      'ingesting',
      'waiting_for_scanners',
      'queued_for_ai',
      'analyzing',
      'done',
      'skipped',
      'interrupted',
      'failed',
    ]);
    for (const name of ['aiQueuePosition', 'processed', 'total']) {
      expect(property(AgentLaneDto, name)).toMatchObject({
        type: 'integer',
        required: false,
      });
    }
    for (const name of ['stageSince', 'stageDeadline']) {
      expect(property(AgentLaneDto, name)).toMatchObject({
        type: 'string',
        format: 'date-time',
        required: false,
      });
    }
    // A code of an open vocabulary: new codes may appear, so no enum.
    const outcome = property(AgentLaneDto, 'outcomeReason');
    expect(outcome).toMatchObject({ type: 'string', required: false });
    expect(outcome.enum).toBeUndefined();
  });

  it('documents the new container fields as optional', () => {
    expect(property(ContainerDto, 'scannerType')).toMatchObject({
      type: 'string',
      required: false,
    });
    for (const name of ['totalVulnerabilities', 'processedVulnerabilities']) {
      expect(property(ContainerDto, name)).toMatchObject({
        type: 'integer',
        required: false,
      });
    }
    expect(property(ContainerDto, 'outcomeReason')).toMatchObject({
      type: 'string',
      required: false,
    });
    for (const name of ['analysisQueuedAt', 'analysisStartedAt']) {
      expect(property(ContainerDto, name)).toMatchObject({
        type: 'string',
        format: 'date-time',
        required: false,
      });
    }
  });
});

/**
 * An import scan's read model. The route passes security-scanning's
 * answer through, so the OpenAPI
 * document is where a client learns the two import fields exist.
 */
describe('ScanResponseDto — Swagger (import scans)', () => {
  it('documents importFormat and importTool as optional strings', () => {
    for (const name of ['importFormat', 'importTool']) {
      expect(property(ScanResponseDto, name)).toMatchObject({
        type: 'string',
        required: false,
      });
    }
  });
});

describe('ScanResponseDto — Swagger (git history)', () => {
  it('documents historyPass and historyCoverage', () => {
    const pass = property(ScanResponseDto, 'historyPass');
    expect(pass).toMatchObject({ required: false });
    expect(typeName(pass)).toBe('GitHistoryPassDto');
    const coverage = property(ScanResponseDto, 'historyCoverage');
    expect(coverage).toMatchObject({ required: false });
    expect(typeName(coverage)).toBe('GitHistoryCoverageDto');

    expect(property(GitHistoryPassDto, 'mode')).toBeDefined();
    expect(property(GitHistoryPassDto, 'firstPass')).toBeDefined();
    expect(property(GitHistoryPassDto, 'repositoryKey')).toBeDefined();
    expect(property(GitHistoryPassDto, 'gap')).toMatchObject({
      required: false,
    });
    expect(property(GitHistoryCoverageDto, 'complete')).toBeDefined();
    expect(typeName(property(GitHistoryCoverageDto, 'gaps'))).toBe(
      'GitHistoryGapDto',
    );
    expect(property(GitHistoryGapDto, 'fromSha')).toBeDefined();
    expect(property(GitHistoryGapDto, 'toDate')).toMatchObject({
      required: false,
    });
  });
});
