import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { SecretService } from './secret.service';
import { SecretVulnerabilityDetections } from 'src/entities/secret-vulnerability-detections.entity';
import { HistoryItem } from 'src/entities/history-item.entity';
import { SecretEncryptionService } from 'src/core/crypto/secret-encryption.service';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';

describe('SecretService', () => {
  let service: SecretService;
  let secretRepo: jest.Mocked<Repository<SecretVulnerabilityDetections>>;
  let historyRepo: jest.Mocked<Repository<HistoryItem>>;
  let encryption: jest.Mocked<SecretEncryptionService>;
  let dataSource: jest.Mocked<DataSource>;
  let realtime: { publish: jest.Mock };

  beforeEach(async () => {
    secretRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    } as any;
    historyRepo = {
      save: jest.fn(),
    } as any;
    encryption = {
      encrypt: jest.fn(),
      decrypt: jest.fn((env) => {
        if (env === 'v1:aa:bb:cc') return 'AKIAPLAINTEXT';
        throw new Error('bad envelope');
      }),
    } as any;
    dataSource = {
      transaction: jest.fn(async (cb: any) =>
        cb({
          getRepository: (entity: any) =>
            entity === SecretVulnerabilityDetections ? secretRepo : historyRepo,
        }),
      ),
    } as any;

    realtime = { publish: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecretService,
        {
          provide: getRepositoryToken(SecretVulnerabilityDetections),
          useValue: secretRepo,
        },
        {
          provide: getRepositoryToken(HistoryItem),
          useValue: historyRepo,
        },
        { provide: SecretEncryptionService, useValue: encryption },
        { provide: DataSource, useValue: dataSource },
        { provide: RealtimeEventPublisher, useValue: realtime },
      ],
    }).compile();
    service = module.get(SecretService);
  });

  describe('revealSecret', () => {
    it('returns decrypted plaintext and writes a SECRET_REVEALED history item', async () => {
      secretRepo.findOne.mockResolvedValue({
        id: 'vuln-1',
        projectId: 'proj-1',
        encryptedSecret: Buffer.from('v1:aa:bb:cc', 'utf8'),
        vulnerability: { id: 'parent-vuln' },
      } as any);

      const result = await service.revealSecret('proj-1', 'vuln-1', 'user-42');

      expect(result.secret).toBe('AKIAPLAINTEXT');
      expect(result.revealedAt).toBeInstanceOf(Date);
      expect(historyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SECRET_REVEALED',
          userId: 'user-42',
        }),
      );
    });

    it('throws NOT_FOUND when encryptedSecret is null', async () => {
      secretRepo.findOne.mockResolvedValue({
        id: 'vuln-1',
        projectId: 'proj-1',
        encryptedSecret: null,
      } as any);
      await expect(
        service.revealSecret('proj-1', 'vuln-1', 'user-42'),
      ).rejects.toThrow(RpcException);
    });

    it('throws NOT_FOUND when detection does not exist', async () => {
      secretRepo.findOne.mockResolvedValue(null);
      await expect(
        service.revealSecret('proj-1', 'vuln-1', 'user-42'),
      ).rejects.toThrow(RpcException);
    });
  });

  describe('rotateSecret', () => {
    it('purges encryptedSecret, sets resolved, writes SECRET_ROTATED', async () => {
      const detection = {
        id: 'vuln-1',
        projectId: 'proj-1',
        currentState: 'to_verify',
        encryptedSecret: Buffer.from('v1:aa:bb:cc', 'utf8'),
        vulnerability: { id: 'parent-vuln' },
      } as any;
      secretRepo.findOne.mockResolvedValue(detection);
      secretRepo.save.mockImplementation(async (x: any) => x);

      const result = await service.rotateSecret('proj-1', 'vuln-1', 'user-42');

      expect(result.state).toBe('resolved');
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('is idempotent when already resolved', async () => {
      secretRepo.findOne.mockResolvedValue({
        id: 'vuln-1',
        projectId: 'proj-1',
        currentState: 'resolved',
        encryptedSecret: null,
      } as any);
      const result = await service.rotateSecret('proj-1', 'vuln-1', 'user-42');
      expect(result.state).toBe('resolved');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND when detection does not exist', async () => {
      secretRepo.findOne.mockResolvedValue(null);
      await expect(
        service.rotateSecret('proj-1', 'vuln-1', 'user-42'),
      ).rejects.toThrow(RpcException);
    });
  });

  // The issue detail page refetches (History tab included) only on
  // VULNERABILITY_UPDATED. Reveal and rotate write a History row and never
  // published it, so the row appeared only after a page reload.
  describe('History tab realtime', () => {
    const expectVulnerabilityUpdated = () =>
      expect(realtime.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'VULNERABILITY_UPDATED',
          scope: expect.objectContaining({
            projectId: 'proj-1',
            vulnerabilityId: 'vuln-1',
            scannerType: 'secret',
          }),
          payload: {
            vulnerabilityUpdated: {
              vulnerabilityId: 'vuln-1',
              scannerType: 'secret',
            },
          },
        }),
      );

    it('revealSecret publishes VULNERABILITY_UPDATED once its SECRET_REVEALED row is saved', async () => {
      secretRepo.findOne.mockResolvedValue({
        id: 'vuln-1',
        projectId: 'proj-1',
        encryptedSecret: Buffer.from('v1:aa:bb:cc', 'utf8'),
      } as any);
      historyRepo.save.mockImplementation(async (x: any) => {
        expect(realtime.publish).not.toHaveBeenCalled();
        return x;
      });

      await service.revealSecret('proj-1', 'vuln-1', 'user-42');

      expect(realtime.publish).toHaveBeenCalledTimes(1);
      expectVulnerabilityUpdated();
    });

    it('rotateSecret publishes VULNERABILITY_UPDATED after its transaction committed', async () => {
      secretRepo.findOne.mockResolvedValue({
        id: 'vuln-1',
        projectId: 'proj-1',
        currentState: 'to_verify',
        encryptedSecret: Buffer.from('v1:aa:bb:cc', 'utf8'),
      } as any);
      secretRepo.save.mockImplementation(async (x: any) => x);
      dataSource.transaction.mockImplementation(async (cb: any) => {
        await cb({
          getRepository: (entity: any) =>
            entity === SecretVulnerabilityDetections ? secretRepo : historyRepo,
        });
        expect(realtime.publish).not.toHaveBeenCalled();
      });

      await service.rotateSecret('proj-1', 'vuln-1', 'user-42');

      expect(realtime.publish).toHaveBeenCalledTimes(1);
      expectVulnerabilityUpdated();
    });

    it('publishes nothing when nothing was written', async () => {
      secretRepo.findOne.mockResolvedValueOnce({
        id: 'vuln-1',
        projectId: 'proj-1',
        currentState: 'resolved',
        encryptedSecret: null,
      } as any);
      await service.rotateSecret('proj-1', 'vuln-1', 'user-42');

      secretRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.revealSecret('proj-1', 'vuln-1', 'user-42'),
      ).rejects.toThrow(RpcException);

      expect(realtime.publish).not.toHaveBeenCalled();
    });

    it('still reveals when no realtime publisher is registered', async () => {
      const module = await Test.createTestingModule({
        providers: [
          SecretService,
          {
            provide: getRepositoryToken(SecretVulnerabilityDetections),
            useValue: secretRepo,
          },
          { provide: getRepositoryToken(HistoryItem), useValue: historyRepo },
          { provide: SecretEncryptionService, useValue: encryption },
          { provide: DataSource, useValue: dataSource },
        ],
      }).compile();
      secretRepo.findOne.mockResolvedValue({
        id: 'vuln-1',
        projectId: 'proj-1',
        encryptedSecret: Buffer.from('v1:aa:bb:cc', 'utf8'),
      } as any);

      const result = await module
        .get(SecretService)
        .revealSecret('proj-1', 'vuln-1', 'user-42');

      expect(result.secret).toBe('AKIAPLAINTEXT');
    });
  });
});
