import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, Length } from 'class-validator';

/**
 * POST /me/personal-access-tokens. The caller is always the authenticated
 * user, never the body. `expiresAt` is an ISO 8601 date; absent means the
 * token never expires (sent as 0 to global-management).
 */
export class CreatePersonalAccessTokenBodyDto {
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  name: string;

  @ApiProperty({
    required: false,
    description: 'ISO 8601 expiry; absent means never',
    example: '2030-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
