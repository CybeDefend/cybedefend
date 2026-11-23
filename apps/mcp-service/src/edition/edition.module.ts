import { Global, Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { editionBindings } from './edition-imports';
import { bindingToken } from './merge-bindings';

let cached: DynamicModule | undefined;

/**
 * Every Nest context imports this module. It provides (and exports) the
 * edition bindings, so a port token resolves in every module once the root
 * imports the edition layer. forRoot() is memoised: every call in one process
 * returns the same DynamicModule object.
 */
@Global()
@Module({})
export class EditionModule {
  static forRoot(): DynamicModule {
    if (!cached) {
      const providers = editionBindings();
      cached = {
        module: EditionModule,
        global: true,
        providers,
        exports: providers.map((provider) => bindingToken(provider)),
      };
    }
    return cached;
  }
}
