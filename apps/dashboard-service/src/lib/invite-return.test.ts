import { beforeEach, describe, expect, it } from 'vitest';

import {
  forgetInviteToReturnTo,
  rememberInviteToReturnTo,
  takeInviteToReturnTo,
} from './invite-return';

const INVITE = '/invite/a1b2c3d4?organizationName=Acme&organizationRole=member';

beforeEach(() => {
  sessionStorage.clear();
});

describe('invite-return', () => {
  it('hands back the invitation once, then forgets it', () => {
    rememberInviteToReturnTo(INVITE);
    expect(takeInviteToReturnTo()).toBe(INVITE);
    expect(takeInviteToReturnTo()).toBeNull();
  });

  it('never stores nor follows anything but an invitation path', () => {
    for (const target of ['/login', '//evil.example/invite/x', 'https://evil.example/invite/x', '/invite/']) {
      rememberInviteToReturnTo(target);
      expect(takeInviteToReturnTo()).toBeNull();
    }
    sessionStorage.setItem('cybe_invite_return', 'https://evil.example/invite/x');
    expect(takeInviteToReturnTo()).toBeNull();
  });

  it('forgetInviteToReturnTo drops a remembered invitation', () => {
    rememberInviteToReturnTo(INVITE);
    forgetInviteToReturnTo();
    expect(takeInviteToReturnTo()).toBeNull();
  });
});
