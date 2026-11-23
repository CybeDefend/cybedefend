import { resolveStartStateId } from './linear-start-state';

describe('resolveStartStateId', () => {
  const states = [
    { id: 'triage-1', type: 'triage', position: 0 },
    { id: 'backlog-late', type: 'backlog', position: 5 },
    { id: 'todo-late', type: 'unstarted', position: 9 },
    { id: 'backlog-early', type: 'backlog', position: 1 },
    { id: 'todo-early', type: 'unstarted', position: 2 },
    { id: 'doing', type: 'started', position: 3 },
    { id: 'done', type: 'completed', position: 4 },
  ];

  it('uses the default state when it is not triage', () => {
    expect(
      resolveStartStateId(states, { id: 'todo-late', type: 'unstarted' }),
    ).toBe('todo-late');
  });

  it('never returns a triage state', () => {
    expect(
      resolveStartStateId(states, { id: 'triage-1', type: 'triage' }),
    ).toBe('backlog-early');
  });

  it('takes the first backlog when the team has no default state', () => {
    expect(resolveStartStateId(states, null)).toBe('backlog-early');
  });

  it('falls back to the first unstarted', () => {
    const withoutBacklog = states.filter((s) => s.type !== 'backlog');

    expect(
      resolveStartStateId(withoutBacklog, { id: 'triage-1', type: 'triage' }),
    ).toBe('todo-early');
  });

  it('returns null when nothing fits', () => {
    const onlyTriageAndLater = states.filter(
      (s) => s.type !== 'backlog' && s.type !== 'unstarted',
    );

    expect(
      resolveStartStateId(onlyTriageAndLater, {
        id: 'triage-1',
        type: 'triage',
      }),
    ).toBeNull();
    expect(resolveStartStateId([], null)).toBeNull();
  });
});
