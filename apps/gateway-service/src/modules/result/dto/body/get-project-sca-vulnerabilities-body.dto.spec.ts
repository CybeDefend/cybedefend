import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetProjectScaVulnerabilitiesBodyDto } from './get-project-sca-vulnerabilities-body.dto';

describe('GetProjectScaVulnerabilitiesBodyDto packageManager/packageSource', () => {
  it('splits a comma-separated string into an array', async () => {
    const dto = plainToInstance(GetProjectScaVulnerabilitiesBodyDto, {
      packageManager: 'npm,maven',
      packageSource: 'package.json',
    });
    expect(dto.packageManager).toEqual(['npm', 'maven']);
    expect(dto.packageSource).toEqual(['package.json']);
    expect(await validate(dto)).toHaveLength(0);
  });
  it('accepts an array and stays optional', async () => {
    const dto = plainToInstance(GetProjectScaVulnerabilitiesBodyDto, {
      packageManager: ['npm'],
    });
    expect(dto.packageManager).toEqual(['npm']);
    expect(dto.packageSource).toBeUndefined();
    expect(await validate(dto)).toHaveLength(0);
  });
});
