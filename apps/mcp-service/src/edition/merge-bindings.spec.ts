import { bindingToken, mergeBindings } from './merge-bindings';
import type { Provider } from '@nestjs/common';

describe('mergeBindings', () => {
  it('an override replaces the base provider with the same provide token, in place', () => {
    const base: Provider[] = [
      { provide: 'A', useValue: 1 },
      { provide: 'B', useValue: 2 },
    ];
    const overrides: Provider[] = [{ provide: 'A', useValue: 9 }];
    expect(mergeBindings(base, overrides)).toEqual([
      { provide: 'A', useValue: 9 },
      { provide: 'B', useValue: 2 },
    ]);
  });

  it('an override with a new token is appended after the base, in override order', () => {
    const base: Provider[] = [{ provide: 'A', useValue: 1 }];
    const overrides: Provider[] = [
      { provide: 'C', useValue: 3 },
      { provide: 'D', useValue: 4 },
    ];
    expect(mergeBindings(base, overrides)).toEqual([
      { provide: 'A', useValue: 1 },
      { provide: 'C', useValue: 3 },
      { provide: 'D', useValue: 4 },
    ]);
  });

  it("a class provider's token is the class itself", () => {
    class Foo {}
    const base: Provider[] = [Foo];
    const overrides: Provider[] = [{ provide: Foo, useValue: 'x' }];
    expect(bindingToken(Foo)).toBe(Foo);
    expect(mergeBindings(base, overrides)).toEqual([
      { provide: Foo, useValue: 'x' },
    ]);
  });

  it('throws on two bindings with the same token in one list', () => {
    const base: Provider[] = [
      { provide: 'A', useValue: 1 },
      { provide: 'A', useValue: 2 },
    ];
    expect(() => mergeBindings(base, [])).toThrow(
      'Duplicate edition binding for token A',
    );
    expect(() =>
      mergeBindings(
        [],
        [
          { provide: 'A', useValue: 1 },
          { provide: 'A', useValue: 2 },
        ],
      ),
    ).toThrow('Duplicate edition binding for token A');
    class Foo {}
    expect(() => mergeBindings([Foo, Foo], [])).toThrow(
      'Duplicate edition binding for token Foo',
    );
  });

  it('leaves both inputs untouched and returns a new array', () => {
    const base: Provider[] = [{ provide: 'A', useValue: 1 }];
    const overrides: Provider[] = [{ provide: 'B', useValue: 2 }];
    const baseCopy = [...base];
    const overridesCopy = [...overrides];
    const result = mergeBindings(base, overrides);
    expect(result).not.toBe(base);
    expect(result).not.toBe(overrides);
    expect(base).toEqual(baseCopy);
    expect(overrides).toEqual(overridesCopy);
  });
});
