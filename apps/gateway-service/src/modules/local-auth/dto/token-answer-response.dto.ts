import { ApiProperty } from '@nestjs/swagger';

/** A session's access token; its refresh token is the `cd_refresh` cookie. */
export class TokenAnswerResponseDto {
  @ApiProperty({ description: 'ES256 access JWT' })
  accessToken: string;

  @ApiProperty({ enum: ['Bearer'] })
  tokenType: 'Bearer';

  @ApiProperty({ description: 'Seconds until the access token expires' })
  expiresIn: number;
}

export class SetupAnswerResponseDto extends TokenAnswerResponseDto {
  @ApiProperty({ format: 'uuid' })
  organizationId: string;

  @ApiProperty({ format: 'uuid', description: 'The default team' })
  teamId: string;
}
