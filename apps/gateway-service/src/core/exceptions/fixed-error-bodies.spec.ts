import {
  fixedErrorBodyFor,
  registerFixedErrorBody,
  resetFixedErrorBodiesForTests,
} from './fixed-error-bodies';

/**
 * The core registry of fixed error bodies: the closed side registers one
 * builder per refusal code at instantiation time; the filter applies it to
 * any `HttpException` whose object response carries that `code`.
 */
describe('fixed error bodies registry', () => {
  afterEach(() => resetFixedErrorBodiesForTests());

  it('answers undefined for an unregistered code', () => {
    expect(fixedErrorBodyFor('NOPE')).toBeUndefined();
    expect(fixedErrorBodyFor(undefined)).toBeUndefined();
    expect(fixedErrorBodyFor(42)).toBeUndefined();
  });

  it('returns the registered builder', () => {
    const build = (resp: Record<string, unknown>) => ({
      code: 'X_CODE',
      reason: String(resp.reason),
    });
    registerFixedErrorBody('X_CODE', build);
    expect(fixedErrorBodyFor('X_CODE')).toBe(build);
  });
});
