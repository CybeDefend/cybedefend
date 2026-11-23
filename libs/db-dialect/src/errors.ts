function candidates(e: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (typeof e === 'object' && e !== null) {
    out.push(e as Record<string, unknown>);
    const driverError = (e as Record<string, unknown>).driverError;
    if (typeof driverError === 'object' && driverError !== null) {
      out.push(driverError as Record<string, unknown>);
    }
  }
  return out;
}

function matches(e: unknown, codes: readonly string[], errnos: readonly number[]): boolean {
  for (const c of candidates(e)) {
    if (typeof c.code === 'string' && codes.indexOf(c.code) !== -1) return true;
    if (typeof c.errno === 'number' && errnos.indexOf(c.errno) !== -1) return true;
  }
  return false;
}

/** 1062 / ER_DUP_ENTRY / 23505, on the error or its driverError. */
export function isUniqueViolation(e: unknown): boolean {
  return matches(e, ['ER_DUP_ENTRY', '23505'], [1062]);
}

/** 1213 / ER_LOCK_DEADLOCK / 40P01 / 40001. */
export function isDeadlock(e: unknown): boolean {
  return matches(e, ['ER_LOCK_DEADLOCK', '40P01', '40001'], [1213]);
}

/** 1205 / ER_LOCK_WAIT_TIMEOUT / 55P03. */
export function isLockTimeout(e: unknown): boolean {
  return matches(e, ['ER_LOCK_WAIT_TIMEOUT', '55P03'], [1205]);
}
