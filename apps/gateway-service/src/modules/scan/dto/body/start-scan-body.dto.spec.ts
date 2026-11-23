import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { StartScanBodyDto } from './start-scan-body.dto';

/** The constraint names a body breaks on its branch; [] when it is accepted. */
async function branchErrors(branch: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(StartScanBodyDto, { branch }));
  return errors
    .filter((e) => e.property === 'branch')
    .flatMap((e) => Object.keys(e.constraints ?? {}));
}

/**
 * The branch of a scan started from an uploaded archive is the caller's free
 * text, stored on the scan (255 characters at most) and shown as a branch:
 * it is refused at the API unless Git would accept it as a branch name.
 */
describe('StartScanBodyDto.branch', () => {
  it.each([
    'main',
    'feature/login-form',
    'release/v1.2.3',
    'fix_issue-42',
    'refs/heads/main',
    'deps/bump-lodash-4.17.21',
    'a'.repeat(255),
  ])('accepts %s', async (branch) => {
    expect(await branchErrors(branch)).toEqual([]);
  });

  it('accepts a body without a branch', async () => {
    expect(await branchErrors(undefined)).toEqual([]);
  });

  it.each([
    ['over 255 characters', 'a'.repeat(256)],
    ['a parent reference', '../../etc'],
    ['a space', 'my branch'],
    ['a control character', 'main\nmain'],
    ['a leading dash', '-main'],
    ['a leading slash', '/main'],
    ['a trailing slash', 'main/'],
    ['a double slash', 'feature//x'],
    ['a trailing dot', 'main.'],
    ['a component starting with a dot', 'feature/.hidden'],
    ['a .lock suffix', 'main.lock'],
    ['@{', 'main@{1}'],
    ['a forbidden character', 'feat~1'],
    ['a colon', 'a:b'],
    ['a backslash', 'a\\b'],
    ['the empty string', ''],
  ])('refuses %s', async (_label, branch) => {
    expect(await branchErrors(branch)).not.toEqual([]);
  });
});
