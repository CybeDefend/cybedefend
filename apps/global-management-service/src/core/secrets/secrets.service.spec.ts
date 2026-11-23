import { SecretsSource } from '../../edition/ports/secrets.port';
import SecretsService from './secrets.service';

describe('SecretsService', () => {
  it('delegates getSecret, ensureCacheLoaded and handleRotationEvent to the source', async () => {
    const source: jest.Mocked<SecretsSource> = {
      getSecret: jest.fn().mockReturnValue('v'),
      ensureCacheLoaded: jest.fn().mockResolvedValue(undefined),
      handleRotationEvent: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SecretsService(source);

    expect(service.getSecret('K')).toBe('v');
    expect(source.getSecret).toHaveBeenCalledWith('K');

    await service.ensureCacheLoaded();
    expect(source.ensureCacheLoaded).toHaveBeenCalledTimes(1);

    await service.handleRotationEvent();
    expect(source.handleRotationEvent).toHaveBeenCalledTimes(1);
  });
});
