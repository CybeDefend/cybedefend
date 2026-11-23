import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUrl, MaxLength } from 'class-validator';

export class JiraCallbackInstallBodyDto {
  @ApiProperty({
    description: 'OAuth2 authorization code from Jira',
    example: 'abc123def456',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  code: string;

  @ApiProperty({
    description: 'Redirect URI used in the OAuth flow',
    example: 'https://app.example.com/integrations/jira/callback',
  })
  @IsString()
  @IsNotEmpty()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  redirectUri: string;

  @ApiProperty({
    description: 'OAuth2 CSRF state token (from generateInstallUrl)',
    example: 'a1b2c3d4e5f6...',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  state: string;
}
