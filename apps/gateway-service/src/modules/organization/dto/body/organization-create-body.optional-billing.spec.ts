import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from 'src/core/validation/global-validation-pipe-options';
import { OrganizationCreateBodyDto } from './organization-create-body.dto';

// The core body is the organisation itself: a name, and an industry and a
// country validated when supplied. The billing profile and the marketing
// fields belong to a closed extension (none registered here).

const errorsFor = async (body: Record<string, unknown>) => {
  const dto = plainToInstance(OrganizationCreateBodyDto, body);
  return validate(dto);
};

const errorOn = async (body: Record<string, unknown>, property: string) =>
  (await errorsFor(body)).find((e) => e.property === property);

describe('OrganizationCreateBodyDto (core)', () => {
  it('accepts a body carrying nothing but the organization name', async () => {
    expect(await errorsFor({ name: 'Acme' })).toEqual([]);
  });

  it('still requires the organization name', async () => {
    expect(await errorOn({}, 'name')).toBeDefined();
    expect(await errorOn({ name: '' }, 'name')).toBeDefined();
  });

  it.each(['industry', 'country'])(
    'treats a missing %s as valid',
    async (property) => {
      expect(await errorOn({ name: 'Acme' }, property)).toBeUndefined();
    },
  );

  it('still rejects a supplied but invalid industry', async () => {
    expect(
      await errorOn({ name: 'Acme', industry: 'banking' }, 'industry'),
    ).toBeDefined();
    expect(
      await errorOn({ name: 'Acme', industry: 'software' }, 'industry'),
    ).toBeUndefined();
  });

  it('still rejects a supplied but invalid country', async () => {
    expect(
      await errorOn({ name: 'Acme', country: 'XX' }, 'country'),
    ).toBeDefined();
    expect(
      await errorOn({ name: 'Acme', country: 'France' }, 'country'),
    ).toBeDefined();
    expect(
      await errorOn({ name: 'Acme', country: 'FR' }, 'country'),
    ).toBeUndefined();
  });

  it('declares no closed sign-up field: the global pipe strips each one', async () => {
    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
    const body = await pipe.transform(
      {
        name: 'Acme',
        customerType: 'robot',
        companyName: 'Acme',
        billingAddressLine1: '1 rue',
        attribution: { first: { source: 'meta' } },
        hdyhau: 42,
        intendedPlan: 'no-such-plan',
        leadId: 'not-a-uuid',
      },
      { type: 'body', metatype: OrganizationCreateBodyDto },
    );
    // The core fields only (the constructor declares the two optional ones).
    expect(Object.keys(body).sort()).toEqual(['country', 'industry', 'name']);
  });
});
