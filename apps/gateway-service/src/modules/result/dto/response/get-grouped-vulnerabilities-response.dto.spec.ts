import { DECORATORS } from '@nestjs/swagger';
import { VulnerabilityOccurrenceDto } from './get-grouped-vulnerabilities-response.dto';

/**
 * The grouped routes pass each occurrence through untouched; these
 * three fields let a client flag an agent analysis that dates from a previous
 * scan, like on the detailed rows. The OpenAPI document must list them.
 */
describe('VulnerabilityOccurrenceDto — Swagger', () => {
  const property = (name: string) =>
    Reflect.getMetadata(
      DECORATORS.API_MODEL_PROPERTIES,
      VulnerabilityOccurrenceDto.prototype,
      name,
    );

  it('documents the source of the exploitability verdict', () => {
    expect(property('exploitabilitySource')).toMatchObject({
      type: 'string',
      required: false,
      example: 'agent',
    });
  });

  it('documents the date of the exploitability verdict (ISO 8601)', () => {
    const updatedAt = property('exploitabilityUpdatedAt');
    expect(updatedAt).toMatchObject({
      type: 'string',
      required: false,
      format: 'date-time',
    });
  });

  it('documents the stale agent analysis flag', () => {
    const stale = property('exploitabilityStale');
    expect(stale).toMatchObject({ type: 'boolean', required: false });
    expect(stale.description).toMatch(/security context/i);
  });
});
