import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The Cybe autofix (StartAutoFix, StartBatchAutoFix,
 * FinalizeAutoFix) is a closed module, with the only callers of the
 * agent and billing gRPC clients. The core ResultService must not name either
 * client anymore: they are closed domains.
 */
describe('ResultService without closed gRPC clients', () => {
  it('ResultService imports no agent or billing client', () => {
    const source = readFileSync(join(__dirname, 'result.service.ts'), 'utf8');
    expect(source).not.toMatch(
      /@grpc\/agent|core\/grpc\/billing|AGENT_SERVICE|BILLING_SERVICE/,
    );
  });
});
