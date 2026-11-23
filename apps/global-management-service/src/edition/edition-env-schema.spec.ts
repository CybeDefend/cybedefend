import type { ObjectSchema } from 'joi';
import { EE_ENV_SCHEMA } from './ee-modules';

/**
 * The closed environment keys (EE_ENV_SCHEMA) join the core Joi schema in
 * every edition but community. validation.schema.ts builds its schema when it
 * is loaded, so each case reloads it in an isolated registry with
 * CYBEDEFEND_EDITION set first (the variable must be a real environment
 * variable). In the exported tree EE_ENV_SCHEMA is {} (the overlay), and every
 * assertion below holds trivially.
 */
const EE_KEYS = Object.keys(EE_ENV_SCHEMA);

// What the core schema requires (same keys as validation.schema.spec.ts).
const MINIMAL_ENV: Record<string, string> = {
  GRPC_URL_SECURITY_SCANNING_SERVICE: '127.0.0.1:1',
  GRPC_URL_ANALYSIS_REPORTING_SERVICE: '127.0.0.1:1',
  GRPC_URL_EXTERNAL_INTEGRATIONS_SERVICE: '127.0.0.1:1',
  PERMIFY_ENDPOINT: '127.0.0.1:1',
  FRONTEND_URL: 'http://127.0.0.1:1',
  OTEL_DISABLED: 'true',
};

/** The schema and the edition keys, both read with CYBEDEFEND_EDITION set. */
function loadWith(edition: string | undefined): {
  validationSchema: ObjectSchema;
  editionKeys: string[];
} {
  const previous = process.env.CYBEDEFEND_EDITION;
  if (edition === undefined) delete process.env.CYBEDEFEND_EDITION;
  else process.env.CYBEDEFEND_EDITION = edition;
  try {
    let loaded: { validationSchema: ObjectSchema; editionKeys: string[] };
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const schema = require('../core/config/validation.schema');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const edition = require('./edition-env-schema');
      loaded = {
        validationSchema: schema.validationSchema,
        editionKeys: Object.keys(edition.editionEnvSchema()),
      };
    });
    return loaded;
  } finally {
    if (previous === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = previous;
  }
}

function schemaKeys(schema: ObjectSchema): string[] {
  return Object.keys(schema.describe().keys ?? {});
}

describe('editionEnvSchema (EE_ENV_SCHEMA)', () => {
  it('is EE_ENV_SCHEMA in the cloud (CYBEDEFEND_EDITION unset)', () => {
    expect(loadWith(undefined).editionKeys).toEqual(EE_KEYS);
  });

  it('is empty in the Community Edition', () => {
    expect(loadWith('community').editionKeys).toEqual([]);
  });

  it('adds every closed key to the core schema in the cloud', () => {
    const keys = schemaKeys(loadWith(undefined).validationSchema);
    for (const key of EE_KEYS) expect(keys).toContain(key);
  });

  it('applies the closed keys’ defaults in the cloud', () => {
    const { validationSchema } = loadWith('cloud');
    const described = validationSchema.describe().keys ?? {};
    const { error, value } = validationSchema.validate(MINIMAL_ENV, {
      allowUnknown: true,
    });
    expect(error).toBeUndefined();
    for (const key of EE_KEYS) {
      const fallback = described[key]?.flags?.default;
      if (fallback !== undefined) expect(value[key]).toBe(fallback);
    }
  });

  it('registers no closed key in the Community Edition', () => {
    const keys = schemaKeys(loadWith('community').validationSchema);
    for (const key of EE_KEYS) expect(keys).not.toContain(key);
  });
});
