import { Observable } from 'rxjs';
import { TasksRealtimeController } from '../tasks-realtime.controller';
import { RealtimeStreamFactory } from '../realtime-stream.factory';

describe('TasksRealtimeController.stream', () => {
  let factory: jest.Mocked<RealtimeStreamFactory>;
  let controller: TasksRealtimeController;

  beforeEach(() => {
    factory = { createScopedStream: jest.fn() } as any;
    controller = new TasksRealtimeController(factory);
  });

  it('delegates to factory with task-scoped channel and no membershipScope', () => {
    const fakeStream = new Observable<any>(() => {});
    factory.createScopedStream.mockReturnValue(fakeStream);

    const req = { user: { sub: 'u1' }, headers: {} };
    const result = controller.stream(req as any, 'task-42');

    expect(result).toBe(fakeStream);
    expect(factory.createScopedStream).toHaveBeenCalledWith({
      channels: ['cybe:event:job:task-42'],
      request: req,
      lastEventId: null,
    });
  });

  it('does NOT include membershipScope (ownership already enforced by guard)', () => {
    factory.createScopedStream.mockReturnValue(new Observable(() => {}));

    const req = { user: { sub: 'u1' }, headers: {} };
    controller.stream(req as any, 'task-42');

    const callArg = factory.createScopedStream.mock.calls[0][0];
    expect(callArg).not.toHaveProperty('membershipScope');
  });

  it('forwards Last-Event-ID header when present', () => {
    factory.createScopedStream.mockReturnValue(new Observable(() => {}));

    const req = { user: { sub: 'u1' }, headers: { 'last-event-id': 'evt-99' } };
    controller.stream(req as any, 'task-42');

    expect(factory.createScopedStream).toHaveBeenCalledWith(
      expect.objectContaining({ lastEventId: 'evt-99' }),
    );
  });

  it('uses null for lastEventId when Last-Event-ID header is absent', () => {
    factory.createScopedStream.mockReturnValue(new Observable(() => {}));

    const req = { user: { sub: 'u1' }, headers: {} };
    controller.stream(req as any, 'any-task');

    expect(factory.createScopedStream).toHaveBeenCalledWith(
      expect.objectContaining({ lastEventId: null }),
    );
  });
});
