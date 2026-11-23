import { rateLimitAddressOf } from './rate-limit-address';

/**
 * The address a rate-limit bucket is keyed on. An IPv6 client usually holds
 * a whole /64 and can pick a new address in it for every request, so a bucket
 * keyed on the full address is no limit at all: every IPv6 address is folded
 * to its /64. An IPv4-mapped IPv6 address is the IPv4 client it maps.
 */
describe('rateLimitAddressOf', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    [' 203.0.113.7 ', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['::FFFF:203.0.113.7', '203.0.113.7'],
    ['::ffff:cb00:7107', '203.0.113.7'],
    ['0:0:0:0:0:ffff:cb00:7107', '203.0.113.7'],
    ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
    ['2001:DB8:1:2:ffff:ffff:ffff:ffff', '2001:db8:1:2::/64'],
    ['2001:db8:1:2::1', '2001:db8:1:2::/64'],
    ['2001:0db8:0001:0002::abcd', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['fe80::1%eth0', 'fe80:0:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    ['64:ff9b::203.0.113.7', '64:ff9b:0:0::/64'],
  ])('%p is keyed as %p', (input, expected) => {
    expect(rateLimitAddressOf(input)).toBe(expected);
  });

  it('gives every address of one /64 the same key', () => {
    const keys = new Set(
      ['2001:db8:a:b::1', '2001:db8:a:b:1:2:3:4', '2001:db8:a:b:ffff::'].map(
        rateLimitAddressOf,
      ),
    );
    expect(keys.size).toBe(1);
    expect(rateLimitAddressOf('2001:db8:a:c::1')).not.toBe([...keys][0]);
  });

  it.each([
    ['', ''],
    [undefined, ''],
    ['unknown', 'unknown'],
    ['not-an-address', 'not-an-address'],
  ])('leaves a non-address %p as it is', (input, expected) => {
    expect(rateLimitAddressOf(input as string)).toBe(expected);
  });
});
