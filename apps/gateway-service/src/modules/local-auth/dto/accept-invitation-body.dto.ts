import { ApiProperty } from '@nestjs/swagger';
import { Allow, IsString, Length, MaxLength } from 'class-validator';

/**
 * POST /auth/invitations/:token/accept: the invitee's name and password. The
 * token itself is the path parameter, validated by ParseInvitationTokenPipe.
 */
export class AcceptInvitationBodyDto {
  @ApiProperty({ example: 'Grace Hopper', minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  name: string;

  @ApiProperty({
    format: 'password',
    maxLength: 1024,
    description: 'The policy (12 to 128 characters) is global-management’s',
  })
  @IsString()
  @MaxLength(1024)
  password: string;
}

/**
 * POST /auth/invitations/accept: the same body plus the invitation token, so
 * that the token never sits in a URL (access logs, proxies, browser history).
 * The token is checked by ParseInvitationTokenPipe in the handler, so any
 * mismatch (absent, not a string, not 64 lower-case hex characters) is the
 * same 400 INVITATION_INVALID as on the path route, with no call; `@Allow`
 * only keeps it through the whitelisting pipe. `req.body.token` is redacted
 * in every log line (logger.ts).
 */
export class AcceptInvitationWithTokenBodyDto extends AcceptInvitationBodyDto {
  @ApiProperty({ pattern: '^[0-9a-f]{64}$', format: 'password' })
  @Allow()
  token: string;
}
