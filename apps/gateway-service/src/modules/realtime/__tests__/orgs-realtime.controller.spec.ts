import { Observable } from 'rxjs';
import { OrgsRealtimeController } from '../orgs-realtime.controller';
import { RealtimeStreamFactory } from '../realtime-stream.factory';

describe('OrgsRealtimeController.projectsStream', () => {
  let factory: jest.Mocked<RealtimeStreamFactory>;
  let controller: OrgsRealtimeController;

  beforeEach(() => {
    factory = { createScopedStream: jest.fn() } as any;
    controller = new OrgsRealtimeController(factory);
  });

  it('delegates to factory with scoped channel and membership scope', () => {
    const fakeStream = new Observable<any>(() => {});
    factory.createScopedStream.mockReturnValue(fakeStream);
    const req = { user: { sub: 'u1' }, headers: {} };
    const result = controller.projectsStream(req as any, 'o1' as any);
    expect(result).toBe(fakeStream);
    expect(factory.createScopedStream).toHaveBeenCalledWith({
      channels: ['cybe:event:org:o1:projects'],
      membershipScope: { scopeKey: 'org:o1', userId: 'u1' },
      request: req,
      lastEventId: null,
    });
  });

  it('forwards Last-Event-ID header to the factory when present', () => {
    factory.createScopedStream.mockReturnValue(new Observable(() => {}));
    const req = { user: { sub: 'u1' }, headers: { 'last-event-id': 'evt-42' } };
    controller.projectsStream(req as any, 'o1' as any);
    expect(factory.createScopedStream).toHaveBeenCalledWith(
      expect.objectContaining({ lastEventId: 'evt-42' }),
    );
  });
});

describe('OrgsRealtimeController routes', () => {
  // The organisation's billing events belong to a closed feature: the core
  // controller serves no billing stream, so the Community Edition answers 404.
  it('serves no billing stream', () => {
    expect(
      Object.getOwnPropertyNames(OrgsRealtimeController.prototype),
    ).not.toContain('billingStream');
  });
});

describe('overviewStream', () => {
  let factory: jest.Mocked<RealtimeStreamFactory>;
  let controller: OrgsRealtimeController;

  beforeEach(() => {
    factory = { createScopedStream: jest.fn() } as any;
    controller = new OrgsRealtimeController(factory);
  });

  it('delegates to factory with the right channel and scope', () => {
    const stream = new Observable<any>(() => {});
    factory.createScopedStream.mockReturnValue(stream);
    const req = { user: { sub: 'u1' }, headers: {} };
    expect(controller.overviewStream(req as any, 'o1' as any)).toBe(stream);
    expect(factory.createScopedStream).toHaveBeenCalledWith({
      channels: ['cybe:event:org:o1:overview'],
      membershipScope: { scopeKey: 'org:o1', userId: 'u1' },
      request: req,
      lastEventId: null,
    });
  });

  it('forwards Last-Event-ID', () => {
    factory.createScopedStream.mockReturnValue(new Observable(() => {}));
    const req = { user: { sub: 'u1' }, headers: { 'last-event-id': 'evt-1' } };
    controller.overviewStream(req as any, 'o1' as any);
    expect(factory.createScopedStream).toHaveBeenCalledWith(
      expect.objectContaining({ lastEventId: 'evt-1' }),
    );
  });
});

describe('membersStream', () => {
  let factory: jest.Mocked<RealtimeStreamFactory>;
  let controller: OrgsRealtimeController;

  beforeEach(() => {
    factory = { createScopedStream: jest.fn() } as any;
    controller = new OrgsRealtimeController(factory);
  });

  it('delegates to factory with the right channel and scope', () => {
    const stream = new Observable<any>(() => {});
    factory.createScopedStream.mockReturnValue(stream);
    const req = { user: { sub: 'u1' }, headers: {} };
    expect(controller.membersStream(req as any, 'o1' as any)).toBe(stream);
    expect(factory.createScopedStream).toHaveBeenCalledWith({
      channels: ['cybe:event:org:o1:members'],
      membershipScope: { scopeKey: 'org:o1', userId: 'u1' },
      request: req,
      lastEventId: null,
    });
  });

  it('forwards Last-Event-ID', () => {
    factory.createScopedStream.mockReturnValue(new Observable(() => {}));
    const req = { user: { sub: 'u1' }, headers: { 'last-event-id': 'evt-1' } };
    controller.membersStream(req as any, 'o1' as any);
    expect(factory.createScopedStream).toHaveBeenCalledWith(
      expect.objectContaining({ lastEventId: 'evt-1' }),
    );
  });
});

describe('reportsStream', () => {
  let factory: jest.Mocked<RealtimeStreamFactory>;
  let controller: OrgsRealtimeController;

  beforeEach(() => {
    factory = { createScopedStream: jest.fn() } as any;
    controller = new OrgsRealtimeController(factory);
  });

  it('reportsStream subscribes to the org reports channel', () => {
    const stream = new Observable<any>(() => {});
    factory.createScopedStream.mockReturnValue(stream);
    const req = { user: { sub: 'u1' }, headers: {} };
    expect(controller.reportsStream(req as any, 'org-1' as any)).toBe(stream);
    expect(factory.createScopedStream).toHaveBeenCalledWith({
      channels: ['cybe:event:org:org-1:reports'],
      membershipScope: { scopeKey: 'org:org-1', userId: 'u1' },
      request: req,
      lastEventId: null,
    });
  });

  it('forwards Last-Event-ID header when present', () => {
    factory.createScopedStream.mockReturnValue(new Observable(() => {}));
    const req = { user: { sub: 'u1' }, headers: { 'last-event-id': 'evt-99' } };
    controller.reportsStream(req as any, 'org-1' as any);
    expect(factory.createScopedStream).toHaveBeenCalledWith(
      expect.objectContaining({ lastEventId: 'evt-99' }),
    );
  });
});
