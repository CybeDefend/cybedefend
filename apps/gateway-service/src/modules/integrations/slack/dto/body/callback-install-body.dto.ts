import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class SlackCallbackInstallBodyDto {
  @ApiProperty({
    description: 'OAuth2 authorization code returned by Slack',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  code: string;

  @ApiProperty({
    description: 'Redirect URI used during the OAuth flow',
    example: 'https://app.example.com/integrations/slack/callback',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  redirectUri: string;

  @ApiProperty({
    description:
      'OAuth2 CSRF state issued by POST /organization/:organizationId/slack/install/state, single use, valid 10 minutes',
    example: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    pattern: '^[a-f0-9]{64}$',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-f0-9]{64}$/)
  state: string;

  constructor(code: string, redirectUri: string, state: string) {
    this.code = code;
    this.redirectUri = redirectUri;
    this.state = state;
  }

  public toString(): string {
    // The state is a single-use secret: never print it.
    return JSON.stringify({
      code: this.code,
      redirectUri: this.redirectUri,
    });
  }
}
