import type * as Joi from 'joi';

// The keys every edition requires, besides the store's.
const BASE_ENV: Record<string, string> = {
  GRPC_URL_SECURITY_SCANNING_SERVICE: '127.0.0.1:1',
  OTEL_DISABLED: 'true',
};

const S3_ENV: Record<string, string> = {
  S3_BUCKET_NAME: 'bucket',
  S3_ENDPOINT: 'http://127.0.0.1:1',
  AWS_REGION: 'us-east-1',
};

async function communitySchema(): Promise<Joi.ObjectSchema> {
  const saved = process.env.CYBEDEFEND_EDITION;
  process.env.CYBEDEFEND_EDITION = 'community';
  try {
    let schema!: Joi.ObjectSchema;
    await jest.isolateModulesAsync(async () => {
      schema = (await import('./validation.schema')).validationSchema;
    });
    return schema;
  } finally {
    if (saved === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = saved;
  }
}

describe('STORAGE_PROVIDER in the Community Edition', () => {
  it('defaults to the S3-compatible store and requires its keys', async () => {
    const schema = await communitySchema();
    const { error, value } = schema.validate({ ...BASE_ENV, ...S3_ENV });
    expect(error).toBeUndefined();
    expect(value.STORAGE_PROVIDER).toBe('s3');

    const missing = schema.validate(BASE_ENV, { abortEarly: false }).error;
    expect(missing?.message).toContain('S3_BUCKET_NAME');
    expect(missing?.message).toContain('S3_ENDPOINT');
  });

  it('refuses any other store', async () => {
    const schema = await communitySchema();
    const { error } = schema.validate({
      ...BASE_ENV,
      ...S3_ENV,
      STORAGE_PROVIDER: 'gcp',
    });
    expect(error?.message).toContain('STORAGE_PROVIDER');
  });
});
