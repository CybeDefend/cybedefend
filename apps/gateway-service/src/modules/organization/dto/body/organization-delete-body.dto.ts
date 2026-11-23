import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/**
 * The confirmation of an organization deletion: the 6-digit
 * code `POST /organization/:organizationId/deletion-code` e-mailed to the
 * organization's creator. global-management decides whether it is valid.
 */
export class OrganizationDeleteBodyDto {
  @ApiProperty({
    description:
      'The 6-digit code e-mailed to the organization creator by POST /organization/:organizationId/deletion-code (valid 10 minutes, single use)',
    example: '012345',
    pattern: '^\\d{6}$',
  })
  @IsString()
  @Matches(/^\d{6}$/)
  readonly code: string;
}
