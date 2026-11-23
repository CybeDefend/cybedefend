import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BatchUpdateVulnerabilityItemDto } from './batch-update-vuln-body.dto';

const VULN_ID = '00000000-0000-4000-8000-000000000001';

async function statusErrors(status: string) {
  const dto = plainToInstance(BatchUpdateVulnerabilityItemDto, {
    vulnerabilityId: VULN_ID,
    status,
  });
  const errors = await validate(dto);
  return errors.some((e) => e.property === 'status');
}

describe('BatchUpdateVulnerabilityItemDto status', () => {
  it.each(['not_exploitable', 'proposed_not_exploitable'])(
    'rejects legacy status %s',
    async (status) => {
      expect(await statusErrors(status)).toBe(true);
    },
  );

  it.each(['to_verify', 'confirmed', 'ignored', 'resolved'])(
    'accepts settable status %s',
    async (status) => {
      expect(await statusErrors(status)).toBe(false);
    },
  );
});

/**
 * The batch item carries its OWN `dismissalReason`.
 * Without it the analysis-reporting guard would make bulk dismissal impossible
 * rather than merely audited: `BatchUpdateVulnerabilityItem` is a separate
 * message and the async job never touches `UpdateResultBodyDto`.
 */
describe('BatchUpdateVulnerabilityItemDto dismissalReason', () => {
  const errorsFor = async (payload: Record<string, unknown>) =>
    validate(
      plainToInstance(BatchUpdateVulnerabilityItemDto, {
        vulnerabilityId: VULN_ID,
        ...payload,
      }),
    );

  const reasonErrors = async (payload: Record<string, unknown>) =>
    (await errorsFor(payload)).filter((e) => e.property === 'dismissalReason');

  it('rejects status=ignored without a reason', async () => {
    expect(await reasonErrors({ status: 'ignored' })).not.toHaveLength(0);
  });

  it.each(['', '   '])(
    'rejects status=ignored with a blank reason %j',
    async (dismissalReason) => {
      expect(
        await reasonErrors({ status: 'ignored', dismissalReason }),
      ).not.toHaveLength(0);
    },
  );

  it('accepts status=ignored with a reason', async () => {
    expect(
      await errorsFor({ status: 'ignored', dismissalReason: 'accepted risk' }),
    ).toHaveLength(0);
  });

  it('does not require a reason on a priority-only item', async () => {
    expect(await errorsFor({ priority: 'urgent' })).toHaveLength(0);
  });

  it('caps the reason at 512 characters', async () => {
    expect(
      await reasonErrors({
        status: 'ignored',
        dismissalReason: 'x'.repeat(513),
      }),
    ).not.toHaveLength(0);
  });
});
