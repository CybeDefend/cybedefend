import { ApiProperty } from '@nestjs/swagger';

export class OrganizationDeletionCodeResponseDto {
  @ApiProperty({
    description:
      'When the code e-mailed to the organization creator stops being valid (ISO 8601)',
    example: '2026-10-27T10:10:00.000Z',
  })
  readonly expiresAt: string;
}
