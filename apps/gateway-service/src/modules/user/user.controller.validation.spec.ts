import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { UserController } from './user.controller';
import { UserService } from './user.service';
import { Logger } from 'nestjs-pino';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { FeatureGuard } from 'src/core/guards/feature/feature.guard';

describe('UserController DTO validation (integration-light)', () => {
  let app: INestApplication;
  const userServiceMock = {
    getProfile: jest.fn(),
    updateProfile: jest.fn(),
  };

  beforeAll(async () => {
    const moduleBuilder = Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: UserService, useValue: userServiceMock },
        { provide: Logger, useValue: { log: jest.fn(), error: jest.fn() } },
      ],
    })
      .overrideGuard(CombinedAuthRateLimitGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(FeatureGuard)
      .useValue({ canActivate: () => true });

    const moduleFixture: TestingModule = await moduleBuilder.compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('PATCH /user/profile', () => {
    it('should return 400 when notification is not boolean', async () => {
      await request(app.getHttpServer())
        .patch('/user/profile')
        .send({ notification: 'yes', isOnboardingCompleted: true })
        .expect(400);
      expect(userServiceMock.updateProfile).not.toHaveBeenCalled();
    });

    it('should return 400 when body has extra fields (forbidNonWhitelisted)', async () => {
      await request(app.getHttpServer())
        .patch('/user/profile')
        .send({ notification: true, isOnboardingCompleted: true, extra: 1 })
        .expect(400);
      expect(userServiceMock.updateProfile).not.toHaveBeenCalled();
    });

    it('should return 400 when onboardingPersona is not in the allowlist', async () => {
      await request(app.getHttpServer())
        .patch('/user/profile')
        .send({ onboardingPersona: 'ceo' })
        .expect(400);
      expect(userServiceMock.updateProfile).not.toHaveBeenCalled();
    });

    it('should return 400 when onboardingUsage contains a value outside the allowlist', async () => {
      await request(app.getHttpServer())
        .patch('/user/profile')
        .send({ onboardingUsage: ['vibecoding', 'invalid'] })
        .expect(400);
      expect(userServiceMock.updateProfile).not.toHaveBeenCalled();
    });

    it('should return 400 when onboardingUsage is a plain string instead of an array', async () => {
      await request(app.getHttpServer())
        .patch('/user/profile')
        .send({ onboardingUsage: 'vibecoding' })
        .expect(400);
      expect(userServiceMock.updateProfile).not.toHaveBeenCalled();
    });

    it('should not reject onboardingUsage when it is an array of allowlisted values', async () => {
      const res = await request(app.getHttpServer())
        .patch('/user/profile')
        .send({ onboardingUsage: ['vibecoding', 'compliance'] });
      expect(res.status).not.toBe(400);
    });

    // We intentionally do not test the success path here to avoid needing req.user
  });
});
