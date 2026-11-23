import { IMAGE_PROTO_BASE_PATH, resolveProtoBasePath } from './proto-base-path';

describe('resolveProtoBasePath', () => {
  const devPath = '/repo/libs/protos';

  it('reads the image layout in production when PROTO_BASE_PATH is unset', () => {
    expect(
      resolveProtoBasePath({
        nodeEnv: 'production',
        override: undefined,
        devPath,
      }),
    ).toBe('/app/protos');
    expect(IMAGE_PROTO_BASE_PATH).toBe('/app/protos');
  });

  it('reads the repository libs/protos outside production when PROTO_BASE_PATH is unset', () => {
    for (const nodeEnv of [undefined, 'development', 'test', 'staging']) {
      expect(
        resolveProtoBasePath({ nodeEnv, override: undefined, devPath }),
      ).toBe(devPath);
    }
  });

  it('reads PROTO_BASE_PATH when it is set, whatever NODE_ENV says', () => {
    for (const nodeEnv of [undefined, 'development', 'production']) {
      expect(
        resolveProtoBasePath({ nodeEnv, override: '/ce/libs/protos', devPath }),
      ).toBe('/ce/libs/protos');
    }
  });

  it('treats an empty or blank PROTO_BASE_PATH as unset', () => {
    for (const override of ['', '   ']) {
      expect(
        resolveProtoBasePath({ nodeEnv: 'production', override, devPath }),
      ).toBe('/app/protos');
      expect(
        resolveProtoBasePath({ nodeEnv: 'development', override, devPath }),
      ).toBe(devPath);
    }
  });
});
