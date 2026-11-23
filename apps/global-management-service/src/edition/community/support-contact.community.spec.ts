import { Test } from '@nestjs/testing';
import {
  SUPPORT_CONTACT_PORT,
  type SupportContact,
} from '../ports/support-contact.port';
import { SUPPORT_CONTACT_COMMUNITY_BINDINGS } from './support-contact.binding';
import { CommunitySupportContact } from './support-contact.community';

describe('CommunitySupportContact (SUPPORT_CONTACT_PORT, community edition)', () => {
  it('binds SUPPORT_CONTACT_PORT to CommunitySupportContact', async () => {
    const module = await Test.createTestingModule({
      providers: [...SUPPORT_CONTACT_COMMUNITY_BINDINGS],
    }).compile();
    expect(module.get(SUPPORT_CONTACT_PORT)).toBeInstanceOf(
      CommunitySupportContact,
    );
    await module.close();
  });

  it('points to the instance administrator and names no mailbox', () => {
    const contact: SupportContact = new CommunitySupportContact();
    const text = `${contact.questionLine()} ${contact.compromisedAccountContact()}`;
    expect(contact.compromisedAccountContact()).toBe(
      'the administrator of your CybeDefend instance',
    );
    expect(text).not.toContain('@');
  });
});
