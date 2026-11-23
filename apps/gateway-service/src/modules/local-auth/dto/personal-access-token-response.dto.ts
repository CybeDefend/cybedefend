import { ApiProperty } from '@nestjs/swagger';

/**
 * One personal access token as the REST API shows it: ISO 8601 dates, `null`
 * for never, and never the secret (`cdp_…`), which exists only in the
 * creation answer, shown once.
 */
export class PersonalAccessTokenResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ example: 'a1b2', description: 'Last four characters' })
  lastFour: string;

  @ApiProperty({ description: 'ISO 8601 creation date' })
  createdAt: string;

  @ApiProperty({
    nullable: true,
    description: 'ISO 8601, or null when never used',
  })
  lastUsedAt: string | null;

  @ApiProperty({
    nullable: true,
    description: 'ISO 8601, or null when it never expires',
  })
  expiresAt: string | null;
}

export class ListPersonalAccessTokensResponseDto {
  @ApiProperty({ type: [PersonalAccessTokenResponseDto] })
  tokens: PersonalAccessTokenResponseDto[];
}

/** The creation answer: the `cdp_…` secret is in `token`, shown once. */
export class CreatedPersonalAccessTokenResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ example: 'a1b2' })
  lastFour: string;

  @ApiProperty({ description: 'ISO 8601 creation date' })
  createdAt: string;

  @ApiProperty({
    nullable: true,
    description: 'ISO 8601, or null when it never expires',
  })
  expiresAt: string | null;

  @ApiProperty({ description: 'The secret, shown once: cdp_…' })
  token: string;
}
