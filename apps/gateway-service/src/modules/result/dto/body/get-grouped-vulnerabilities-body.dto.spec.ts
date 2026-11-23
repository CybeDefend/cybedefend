import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetGroupedScaVulnerabilitiesBodyDto } from './get-grouped-vulnerabilities-body.dto';

describe('GetGroupedScaVulnerabilitiesBodyDto packageManager/packageSource', () => {
  it('accepts array values and stays optional', async () => {
    const dto = plainToInstance(GetGroupedScaVulnerabilitiesBodyDto, {
      packageManager: ['npm'],
      packageSource: ['package.json'],
    });
    expect(dto.packageManager).toEqual(['npm']);
    expect(dto.packageSource).toEqual(['package.json']);
    expect(await validate(dto)).toHaveLength(0);
  });
  it('coerces a single string into an array', async () => {
    const dto = plainToInstance(GetGroupedScaVulnerabilitiesBodyDto, {
      packageManager: 'npm',
    });
    expect(dto.packageManager).toEqual(['npm']);
    expect(await validate(dto)).toHaveLength(0);
  });
  it('splits a comma-separated string into an array (aligned with flat SCA DTO)', async () => {
    const dto = plainToInstance(GetGroupedScaVulnerabilitiesBodyDto, {
      packageManager: 'npm,maven',
      packageSource: 'package.json,pom.xml',
    });
    expect(dto.packageManager).toEqual(['npm', 'maven']);
    expect(dto.packageSource).toEqual(['package.json', 'pom.xml']);
    expect(await validate(dto)).toHaveLength(0);
  });
});
