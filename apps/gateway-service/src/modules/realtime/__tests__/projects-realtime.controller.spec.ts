import { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { ProjectsRealtimeController } from '../projects-realtime.controller';
import { RealtimeStreamFactory } from '../realtime-stream.factory';

describe('ProjectsRealtimeController.issuesStream', () => {
  let factory: jest.Mocked<RealtimeStreamFactory>;
  let controller: ProjectsRealtimeController;

  beforeEach(() => {
    factory = { createScopedStream: jest.fn() } as any;
    controller = new ProjectsRealtimeController(factory);
  });

  it('delegates to factory with project-scoped issues channel', () => {
    const stream = new Observable<any>(() => {});
    factory.createScopedStream.mockReturnValue(stream);
    const req = { user: { sub: 'u1' }, headers: {} };
    expect(controller.issuesStream(req as any, 'p1' as any)).toBe(stream);
    expect(factory.createScopedStream).toHaveBeenCalledWith({
      channels: ['cybe:event:project:p1:issues'],
      membershipScope: { scopeKey: 'project:p1', userId: 'u1' },
      request: req,
      lastEventId: null,
    });
  });

  it('forwards Last-Event-ID header to the factory', () => {
    factory.createScopedStream.mockReturnValue(new Observable(() => {}));
    const req = { user: { sub: 'u1' }, headers: { 'last-event-id': 'evt-9' } };
    controller.issuesStream(req as any, 'p1' as any);
    expect(factory.createScopedStream).toHaveBeenCalledWith(
      expect.objectContaining({ lastEventId: 'evt-9' }),
    );
  });
});

describe('statsStream', () => {
  let factory: jest.Mocked<RealtimeStreamFactory>;
  let controller: ProjectsRealtimeController;

  beforeEach(() => {
    factory = { createScopedStream: jest.fn() } as any;
    controller = new ProjectsRealtimeController(factory);
  });

  it('delegates to factory with the right channel and scope', () => {
    const stream = new Observable<any>(() => {});
    factory.createScopedStream.mockReturnValue(stream);
    const req = { user: { sub: 'u1' }, headers: {} };
    expect(controller.statsStream(req as any, 'p1' as any)).toBe(stream);
    expect(factory.createScopedStream).toHaveBeenCalledWith({
      channels: ['cybe:event:project:p1:stats'],
      membershipScope: { scopeKey: 'project:p1', userId: 'u1' },
      request: req,
      lastEventId: null,
    });
  });

  it('forwards Last-Event-ID', () => {
    factory.createScopedStream.mockReturnValue(new Observable(() => {}));
    const req = { user: { sub: 'u1' }, headers: { 'last-event-id': 'evt-1' } };
    controller.statsStream(req as any, 'p1' as any);
    expect(factory.createScopedStream).toHaveBeenCalledWith(
      expect.objectContaining({ lastEventId: 'evt-1' }),
    );
  });
});

describe('policiesStream', () => {
  let factory: jest.Mocked<RealtimeStreamFactory>;
  let controller: ProjectsRealtimeController;

  beforeEach(() => {
    factory = { createScopedStream: jest.fn() } as any;
    controller = new ProjectsRealtimeController(factory);
  });

  it('delegates to factory with the right channel and scope', () => {
    const stream = new Observable<any>(() => {});
    factory.createScopedStream.mockReturnValue(stream);
    const req = { user: { sub: 'u1' }, headers: {} };
    expect(controller.policiesStream(req as any, 'p1' as any)).toBe(stream);
    expect(factory.createScopedStream).toHaveBeenCalledWith({
      channels: ['cybe:event:project:p1:policies'],
      membershipScope: { scopeKey: 'project:p1', userId: 'u1' },
      request: req,
      lastEventId: null,
    });
  });

  it('forwards Last-Event-ID', () => {
    factory.createScopedStream.mockReturnValue(new Observable(() => {}));
    const req = { user: { sub: 'u1' }, headers: { 'last-event-id': 'evt-1' } };
    controller.policiesStream(req as any, 'p1' as any);
    expect(factory.createScopedStream).toHaveBeenCalledWith(
      expect.objectContaining({ lastEventId: 'evt-1' }),
    );
  });
});

describe('issueDetailStream', () => {
  let factory: jest.Mocked<RealtimeStreamFactory>;
  let controller: ProjectsRealtimeController;

  beforeEach(() => {
    factory = {
      createScopedStream: jest.fn(),
    } as unknown as jest.Mocked<RealtimeStreamFactory>;
    controller = new ProjectsRealtimeController(factory);
  });

  it('delegates to factory with the project-scoped per-vulnerability channel', () => {
    const stream = new Observable<MessageEvent>(() => {});
    factory.createScopedStream.mockReturnValue(stream);
    const req = { user: { sub: 'u1' }, headers: {} };
    expect(controller.issueDetailStream(req, 'p1', 'v1')).toBe(stream);
    expect(factory.createScopedStream).toHaveBeenCalledWith({
      channels: ['cybe:event:project:p1:vuln:v1'],
      membershipScope: { scopeKey: 'project:p1', userId: 'u1' },
      request: req,
      lastEventId: null,
    });
  });

  it('forwards Last-Event-ID', () => {
    factory.createScopedStream.mockReturnValue(new Observable(() => {}));
    const req = { user: { sub: 'u1' }, headers: { 'last-event-id': 'evt-1' } };
    controller.issueDetailStream(req, 'p1', 'v1');
    expect(factory.createScopedStream).toHaveBeenCalledWith(
      expect.objectContaining({ lastEventId: 'evt-1' }),
    );
  });

  // Permify only authorizes the PATH projectId, so the channel must be derived
  // from it: a caller holding read_scan_result on their own project never
  // receives the updates of a vulnerability of another project.
  it('derives the channel from the path project, never the unscoped per-vuln channel', () => {
    factory.createScopedStream.mockReturnValue(new Observable(() => {}));
    const req = { user: { sub: 'user-a' }, headers: {} };
    controller.issueDetailStream(req, 'project-a', 'vuln-other-tenant');
    const { channels } = factory.createScopedStream.mock.calls[0][0];
    expect(channels).toEqual([
      'cybe:event:project:project-a:vuln:vuln-other-tenant',
    ]);
    expect(channels).not.toContain('cybe:event:vuln:vuln-other-tenant');
  });
});
