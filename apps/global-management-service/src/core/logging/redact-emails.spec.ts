import { redactEmails } from './redact-emails';

describe('redactEmails', () => {
  it('strips an address out of the message an SMTP rejection carries', () => {
    expect(
      redactEmails('550 5.1.1 <jane@acme.io>: recipient address rejected'),
    ).toBe('550 5.1.1 <<redacted>>: recipient address rejected');
  });

  it('leaves a message with no address, and an empty one, alone', () => {
    expect(redactEmails('ER_LOCK_WAIT_TIMEOUT on marketing_leads')).toBe(
      'ER_LOCK_WAIT_TIMEOUT on marketing_leads',
    );
    expect(redactEmails('')).toBe('');
  });
});
