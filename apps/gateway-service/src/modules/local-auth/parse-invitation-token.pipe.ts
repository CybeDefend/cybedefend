import { HttpStatus, Injectable, type PipeTransform } from '@nestjs/common';
import { localAuthRefusal } from './local-auth-errors';

/**
 * The invitation token of `POST /auth/invitations/:token/accept`:
 * 64 lower-case hex characters. A mismatch is
 * refused here, with no gRPC call, as 400 INVITATION_INVALID.
 */
export const INVITATION_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

@Injectable()
export class ParseInvitationTokenPipe implements PipeTransform {
  transform(value: unknown): string {
    if (typeof value === 'string' && INVITATION_TOKEN_PATTERN.test(value)) {
      return value;
    }
    throw localAuthRefusal('INVITATION_INVALID', HttpStatus.BAD_REQUEST);
  }
}
