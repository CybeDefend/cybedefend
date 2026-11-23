/**
 * Global Jest setup — applied to every test in this service.
 *
 * Mocks `dns/promises` so the SSRF guard in `core/safe-fetch` does not perform
 * real DNS lookups during unit tests. By default every hostname resolves to a
 * known-public IP (example.com), keeping the SSRF guard happy without network
 * I/O. Tests that want to assert the guard's behavior on private resolution
 * can override the mock per-test with `jest.requireMock('dns/promises').lookup.mockResolvedValue(...)`.
 */
jest.mock('dns/promises', () => ({
  __esModule: true,
  lookup: jest
    .fn()
    .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}));
