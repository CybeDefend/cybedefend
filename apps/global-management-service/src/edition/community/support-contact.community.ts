import { Injectable } from '@nestjs/common';
import type { SupportContact } from '../ports/support-contact.port';

/** The instance's own administrator answers its users. */
@Injectable()
export class CommunitySupportContact implements SupportContact {
  questionLine(): string {
    return 'Got a question? Ask the administrator of your CybeDefend instance.';
  }

  compromisedAccountContact(): string {
    return 'the administrator of your CybeDefend instance';
  }
}
