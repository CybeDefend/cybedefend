import { OrganizationDto } from './user-get-profile-response.dto';

/** Where @ApiProperty stores one property's Swagger options (@nestjs/swagger). */
const API_MODEL_PROPERTIES = 'swagger/apiModelProperties';

/**
 * GET /user/profile documents each organisation of the profile. Per-member
 * products add the current member's own products and the
 * flag that says whether global-management computed them.
 */
describe('OrganizationDto — per-member products', () => {
  it('documents myProductsKnown as a boolean: false means unknown, never « no product »', () => {
    expect(
      Reflect.getMetadata(
        API_MODEL_PROPERTIES,
        OrganizationDto.prototype,
        'myProductsKnown',
      ),
    ).toEqual(
      expect.objectContaining({
        type: 'boolean',
        description:
          'true when global-management computed myProducts; false means unknown, never "no product"',
      }),
    );
  });

  it('defaults myProductsKnown to false, as an older global-management', () => {
    const org = new OrganizationDto(
      'o1',
      'Org',
      'FR',
      'it',
      true,
      [],
      'member',
    );

    expect(org.myProductsKnown).toBe(false);
    expect(org.myProducts).toEqual([]);
  });

  // The subscription summary belongs to a closed feature: the core profile
  // documents none.
  it('documents no subscription', () => {
    const properties: string[] =
      Reflect.getMetadata(
        'swagger/apiModelPropertiesArray',
        OrganizationDto.prototype,
      ) ?? [];
    expect(properties).not.toContain(':subscription');
  });
});
