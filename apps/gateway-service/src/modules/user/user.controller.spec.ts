import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { AuthGuard } from 'src/core/guards/auth/auth.guard';
import { RateLimitGuard } from 'src/core/guards/throttler/throttler.guard';
import { FeatureGuard } from 'src/core/guards/feature/feature.guard';
import {
  GetUserProfileResponse,
  UserUpdateResponse,
} from '@grpc/global-management/user';

describe('UserController', () => {
  let controller: UserController;
  let service: jest.Mocked<UserService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        {
          provide: UserService,
          useValue: { getProfile: jest.fn(), updateProfile: jest.fn() },
        },
        { provide: Logger, useValue: { log: jest.fn(), error: jest.fn() } },
        {
          provide: CombinedAuthRateLimitGuard,
          useValue: { canActivate: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: AuthGuard,
          useValue: { canActivate: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: RateLimitGuard,
          useValue: { canActivate: jest.fn().mockResolvedValue(true) },
        },
      ],
    })
      .overrideGuard(FeatureGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UserController>(UserController);
    service = module.get(UserService) as any;
  });

  // PATs are available to every organisation, whatever
  // the plan — no `pat` feature gate any more.
  describe.each([
    'listPersonalAccessTokens',
    'createPersonalAccessToken',
    'deletePersonalAccessToken',
    'updatePersonalAccessTokenName',
  ] as const)('%s', (handler) => {
    const fn = UserController.prototype[handler];

    it('is not gated by a plan feature', () => {
      expect(Reflect.getMetadata('feature', fn)).toBeUndefined();
      expect(Reflect.getMetadata('__guards__', fn) ?? []).not.toContain(
        FeatureGuard,
      );
    });

    it('stays authenticated by the controller guard', () => {
      expect(Reflect.getMetadata('__guards__', UserController)).toContain(
        CombinedAuthRateLimitGuard,
      );
    });
  });

  describe('getProfile', () => {
    it('returns user profile for authenticated user', async () => {
      const res: GetUserProfileResponse = {
        id: 'u1',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@doe.tld',
        picture: '',
        notification: true,
        isOnboardingCompleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        myOrganizations: [],
        onboardingProgress: '[]',
        myAccessibleProjects: [],
        onboardingPersona: 'unspecified',
        onboardingUsage: 'unspecified',
      };
      service.getProfile.mockResolvedValue(res);
      const out = await controller.getProfile({ user: { sub: 'u1' } } as any);
      expect(out).toEqual(res);
      expect(service.getProfile).toHaveBeenCalledWith({ userId: 'u1' });
    });

    it('propagates service errors', async () => {
      service.getProfile.mockRejectedValue(new Error('boom'));
      await expect(
        controller.getProfile({ user: { sub: 'u1' } } as any),
      ).rejects.toThrow('boom');
    });
  });

  describe('updateProfile', () => {
    it('patches user profile and returns response', async () => {
      const res: UserUpdateResponse = { message: 'ok', userId: 'u1' };
      service.updateProfile.mockResolvedValue(res);
      const body = { notification: true, isOnboardingCompleted: true } as any;
      const out = await controller.updateProfile(
        { user: { sub: 'u1' } } as any,
        body,
      );
      expect(out).toEqual(res);
      expect(service.updateProfile).toHaveBeenCalledWith({
        userId: 'u1',
        notification: true,
        isOnboardingCompleted: true,
        onboardingProgress: '',
      });
    });

    it('propagates service errors', async () => {
      service.updateProfile.mockRejectedValue(new Error('bad'));
      await expect(
        controller.updateProfile(
          { user: { sub: 'u1' } } as any,
          { notification: false, isOnboardingCompleted: false } as any,
        ),
      ).rejects.toThrow('bad');
    });

    it('does not send isOnboardingCompleted when only onboardingProgress is provided', async () => {
      const res: UserUpdateResponse = { message: 'ok', userId: 'u1' };
      service.updateProfile.mockResolvedValue(res);
      const body = { onboardingProgress: '["org_created"]' } as any;
      await controller.updateProfile({ user: { sub: 'u1' } } as any, body);
      const callArg = service.updateProfile.mock.calls[0][0];
      expect(callArg.onboardingProgress).toBe('["org_created"]');
      expect(callArg).not.toHaveProperty('isOnboardingCompleted');
      expect(callArg).not.toHaveProperty('notification');
    });

    it('sends isOnboardingCompleted when explicitly set to true', async () => {
      const res: UserUpdateResponse = { message: 'ok', userId: 'u1' };
      service.updateProfile.mockResolvedValue(res);
      const body = { isOnboardingCompleted: true } as any;
      await controller.updateProfile({ user: { sub: 'u1' } } as any, body);
      const callArg = service.updateProfile.mock.calls[0][0];
      expect(callArg.isOnboardingCompleted).toBe(true);
    });

    it('sends isOnboardingCompleted when explicitly set to false', async () => {
      const res: UserUpdateResponse = { message: 'ok', userId: 'u1' };
      service.updateProfile.mockResolvedValue(res);
      const body = { isOnboardingCompleted: false } as any;
      await controller.updateProfile({ user: { sub: 'u1' } } as any, body);
      const callArg = service.updateProfile.mock.calls[0][0];
      expect(callArg.isOnboardingCompleted).toBe(false);
    });

    it('maps onboardingPersona (string) and onboardingUsage (array) to UpdateUserProfileRequest, joining onboardingUsage as CSV', async () => {
      const res: UserUpdateResponse = { message: 'ok', userId: 'u1' };
      service.updateProfile.mockResolvedValue(res);
      const body = {
        onboardingPersona: 'tech_lead',
        onboardingUsage: ['vibecoding', 'compliance'],
      } as any;
      await controller.updateProfile({ user: { sub: 'u1' } } as any, body);
      const callArg = service.updateProfile.mock.calls[0][0];
      expect(callArg.onboardingPersona).toBe('tech_lead');
      expect(callArg.onboardingUsage).toBe('vibecoding,compliance');
    });

    it('does not send onboardingPersona/onboardingUsage when absent', async () => {
      const res: UserUpdateResponse = { message: 'ok', userId: 'u1' };
      service.updateProfile.mockResolvedValue(res);
      const body = { notification: true } as any;
      await controller.updateProfile({ user: { sub: 'u1' } } as any, body);
      const callArg = service.updateProfile.mock.calls[0][0];
      expect(callArg).not.toHaveProperty('onboardingPersona');
      expect(callArg).not.toHaveProperty('onboardingUsage');
    });
  });
});
