import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for GitLab OAuth callback installation
 */
export class GitlabCallbackInstallDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'OAuth authorization code from GitLab',
    example: 'abc123def456ghi789',
  })
  code: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'OAuth state parameter for CSRF protection',
    example: 'random-state-string-12345',
  })
  state: string;
}
