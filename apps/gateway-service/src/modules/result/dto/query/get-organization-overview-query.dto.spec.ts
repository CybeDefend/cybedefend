import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetOrganizationOverviewQueryDto } from './get-organization-overview-query.dto';

describe('GetOrganizationOverviewQueryDto — projectsPage / teamsPage bounds', () => {
  const validateField = async (field: string, value: string) => {
    const dto = plainToInstance(GetOrganizationOverviewQueryDto, {
      [field]: value,
    });
    return validate(dto);
  };

  it.each(['projectsPage', 'teamsPage'])('accepts %s = 1', async (field) => {
    expect(await validateField(field, '1')).toEqual([]);
  });

  it.each(['projectsPage', 'teamsPage'])(
    'accepts %s at the max bound (10000)',
    async (field) => {
      expect(await validateField(field, '10000')).toEqual([]);
    },
  );

  it.each(['projectsPage', 'teamsPage'])(
    'rejects %s above the max bound',
    async (field) => {
      const errors = await validateField(field, '10001');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe(field);
      expect(errors[0].constraints).toHaveProperty('max');
    },
  );

  it.each(['projectsPage', 'teamsPage'])(
    'rejects %s below 1',
    async (field) => {
      const errors = await validateField(field, '0');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe(field);
    },
  );
});
