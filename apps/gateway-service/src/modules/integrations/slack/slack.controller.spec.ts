import 'reflect-metadata';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { SlackController } from './slack.controller';
import { FeatureGuard } from 'src/core/guards/feature/feature.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';

describe('SlackController plan gating', () => {
  it('declares the "slack" feature at class level so FeatureGuard can deny disabled plans', () => {
    expect(Reflect.getMetadata('feature', SlackController)).toBe('slack');
  });

  // FeatureGuard used to sit on the class, before each route's
  // PermissionsGuard; it is now on every route, after Permify.
  it('runs FeatureGuard on every route, after PermissionsGuard', () => {
    const routes = Object.getOwnPropertyNames(SlackController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => SlackController.prototype[name])
      .filter(
        (handler) =>
          typeof handler === 'function' &&
          Reflect.getMetadata(PATH_METADATA, handler) !== undefined,
      );

    expect(routes).toHaveLength(8);
    for (const handler of routes) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
        PermissionsGuard,
        FeatureGuard,
      ]);
    }
  });
});
