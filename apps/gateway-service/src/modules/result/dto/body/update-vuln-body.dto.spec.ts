import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateResultBodyDto } from './update-vuln-body.dto';

async function errorsFor(payload: Partial<Record<string, unknown>>) {
  const dto = plainToInstance(UpdateResultBodyDto, payload);
  return validate(dto);
}

describe('UpdateResultBodyDto status', () => {
  it.each(['not_exploitable', 'proposed_not_exploitable'])(
    'rejects legacy status %s',
    async (status) => {
      const errors = await errorsFor({ status });
      expect(errors.some((e) => e.property === 'status')).toBe(true);
    },
  );

  it.each(['to_verify', 'confirmed', 'ignored', 'resolved'])(
    'accepts settable status %s',
    async (status) => {
      const errors = await errorsFor({ status });
      expect(errors.some((e) => e.property === 'status')).toBe(false);
    },
  );

  it('accepts not_evaluated as exploitabilityVerdict (reset sentinel)', async () => {
    const errors = await errorsFor({ exploitabilityVerdict: 'not_evaluated' });
    expect(errors.some((e) => e.property === 'exploitabilityVerdict')).toBe(
      false,
    );
  });

  it('rejects a bogus exploitabilityVerdict', async () => {
    const errors = await errorsFor({ exploitabilityVerdict: 'banana' });
    expect(errors.some((e) => e.property === 'exploitabilityVerdict')).toBe(
      true,
    );
  });
});

/**
 * A finding may only be dismissed with a justification.
 * Deliberately a breaking change: `status: "ignored"` with no `dismissalReason`
 * used to be accepted, and an `ignored` finding reaching an auditor with no
 * stated reason is the single gap a GRC platform cannot paper over.
 *
 * This DTO is only the CLEAN 400. The control is `assertDismissalReason` in
 * analysis-reporting — the batch path and every other gRPC caller bypass this
 * class entirely.
 */
describe('UpdateResultBodyDto dismissalReason', () => {
  const reasonErrors = async (payload: Record<string, unknown>) =>
    (await errorsFor(payload)).filter((e) => e.property === 'dismissalReason');

  it('rejects status=ignored without a reason', async () => {
    expect(await reasonErrors({ status: 'ignored' })).not.toHaveLength(0);
  });

  it.each(['', '   ', '\t\n'])(
    'rejects status=ignored with a blank reason %j',
    async (dismissalReason) => {
      expect(
        await reasonErrors({ status: 'ignored', dismissalReason }),
      ).not.toHaveLength(0);
    },
  );

  it('accepts status=ignored with a reason', async () => {
    expect(
      await errorsFor({
        status: 'ignored',
        dismissalReason: 'Not reachable from any entry point',
      }),
    ).toHaveLength(0);
  });

  it.each(['to_verify', 'confirmed', 'resolved'])(
    'does not require a reason for status %s',
    async (status) => {
      expect(await errorsFor({ status })).toHaveLength(0);
    },
  );

  it('does not require a reason on a priority-only update', async () => {
    expect(await errorsFor({ priority: 'urgent' })).toHaveLength(0);
  });

  it('caps the reason at 512 characters', async () => {
    expect(
      await reasonErrors({
        status: 'ignored',
        dismissalReason: 'x'.repeat(513),
      }),
    ).not.toHaveLength(0);
    expect(
      await errorsFor({ status: 'ignored', dismissalReason: 'x'.repeat(512) }),
    ).toHaveLength(0);
  });

  // A reason volunteered alongside another status is harmless free text; it is
  // only ever PERSISTED on `ignored` (see applyTriageToDetection), so rejecting
  // it here would break a client that always sends the field.
  it('tolerates a reason supplied with a non-ignored status', async () => {
    expect(
      await errorsFor({ status: 'confirmed', dismissalReason: 'noted' }),
    ).toHaveLength(0);
  });
});
