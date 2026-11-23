import type { Provider } from '@nestjs/common';
import { SUPPORT_CONTACT_PORT } from '../ports/support-contact.port';
import { CommunitySupportContact } from './support-contact.community';

export const SUPPORT_CONTACT_COMMUNITY_BINDINGS: Provider[] = [
  { provide: SUPPORT_CONTACT_PORT, useClass: CommunitySupportContact },
];
