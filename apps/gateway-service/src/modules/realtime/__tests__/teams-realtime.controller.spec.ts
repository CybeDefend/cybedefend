import { Observable } from 'rxjs';
import { TeamsRealtimeController } from '../teams-realtime.controller';
import { RealtimeStreamFactory } from '../realtime-stream.factory';

describe('teamStream', () => {
  let factory: jest.Mocked<RealtimeStreamFactory>;
  let controller: TeamsRealtimeController;

  beforeEach(() => {
    factory = { createScopedStream: jest.fn() } as any;
    controller = new TeamsRealtimeController(factory);
  });

  it('delegates to factory with the right channel and scope', () => {
    const stream = new Observable<any>(() => {});
    factory.createScopedStream.mockReturnValue(stream);
    const req = { user: { sub: 'u1' }, headers: {} };
    expect(controller.teamStream(req as any, 't1' as any)).toBe(stream);
    expect(factory.createScopedStream).toHaveBeenCalledWith({
      channels: ['cybe:event:team:t1'],
      membershipScope: { scopeKey: 'team:t1', userId: 'u1' },
      request: req,
      lastEventId: null,
    });
  });

  it('forwards Last-Event-ID', () => {
    factory.createScopedStream.mockReturnValue(new Observable(() => {}));
    const req = { user: { sub: 'u1' }, headers: { 'last-event-id': 'evt-1' } };
    controller.teamStream(req as any, 't1' as any);
    expect(factory.createScopedStream).toHaveBeenCalledWith(
      expect.objectContaining({ lastEventId: 'evt-1' }),
    );
  });
});

describe('reportsStream', () => {
  let factory: jest.Mocked<RealtimeStreamFactory>;
  let controller: TeamsRealtimeController;

  beforeEach(() => {
    factory = { createScopedStream: jest.fn() } as any;
    controller = new TeamsRealtimeController(factory);
  });

  it('reportsStream subscribes to the team reports channel', () => {
    const stream = new Observable<any>(() => {});
    factory.createScopedStream.mockReturnValue(stream);
    const req = { user: { sub: 'u1' }, headers: {} };
    expect(controller.reportsStream(req as any, 'team-1' as any)).toBe(stream);
    expect(factory.createScopedStream).toHaveBeenCalledWith({
      channels: ['cybe:event:team:team-1:reports'],
      membershipScope: { scopeKey: 'team:team-1', userId: 'u1' },
      request: req,
      lastEventId: null,
    });
  });

  it('forwards Last-Event-ID header when present', () => {
    factory.createScopedStream.mockReturnValue(new Observable(() => {}));
    const req = { user: { sub: 'u1' }, headers: { 'last-event-id': 'evt-77' } };
    controller.reportsStream(req as any, 'team-1' as any);
    expect(factory.createScopedStream).toHaveBeenCalledWith(
      expect.objectContaining({ lastEventId: 'evt-77' }),
    );
  });
});
