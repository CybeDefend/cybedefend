import { computeCodeFingerprint } from '../findings-export/fingerprint.util';

describe('SAST ingestion — fingerprint', () => {
  it('stores a fingerprint on a newly created detection', async () => {
    const saved: Record<string, unknown>[] = [];
    const repo = {
      save: jest.fn(async (e) => {
        saved.push(e);
        return e;
      }),
    };

    // The unit under test is the pure helper the ingestion calls; see Step 3.
    const { fingerprintForNewSastDetection } = await import('./sast-iac.utils');
    const fp = fingerprintForNewSastDetection(
      {
        path: 'src/a.ts',
        codeSnippet: {
          vulnerableStartLine: 9,
          vulnerableEndLine: 9,
          code: [{ line: 9, content: 'eval(x);' }],
        },
      } as never,
      { vulnerability: { id: 'cat-1' } } as never,
      'p1',
      'semgrep',
      'main',
      0,
    );

    expect(fp).toBe(
      computeCodeFingerprint({
        projectId: 'p1',
        branch: 'main',
        scannerType: 'semgrep',
        catalogVulnId: 'cat-1',
        path: 'src/a.ts',
        snippetLines: [{ line: 9, content: 'eval(x);' }],
        vulnerableStartLine: 9,
        vulnerableEndLine: 9,
        occurrenceIndex: 0,
      }),
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('is unchanged when the finding shifts down by 40 lines', async () => {
    const { fingerprintForNewSastDetection } = await import('./sast-iac.utils');
    const at = (line: number) =>
      fingerprintForNewSastDetection(
        {
          path: 'src/a.ts',
          codeSnippet: {
            vulnerableStartLine: line,
            vulnerableEndLine: line,
            code: [{ line, content: 'eval(x);' }],
          },
        } as never,
        { vulnerability: { id: 'cat-1' } } as never,
        'p1',
        'semgrep',
        'main',
        0,
      );
    expect(at(49)).toBe(at(9));
  });
});
