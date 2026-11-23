/**
 * The update fields a closed product adds to PATCH /project/:projectId, so
 * the core names no closed field. The closed side registers its keys at
 * instantiation time (a factory provider of a closed module), and the
 * controller copies each
 * registered key present in the body. Empty in the core alone.
 */
const registeredUpdateFields = new Set<string>();

/** Idempotent: a key is registered once. */
export function registerProjectUpdateField(key: string): void {
  registeredUpdateFields.add(key);
}

/** The registered keys, in registration order. `[]` in the core. */
export function projectUpdateFields(): readonly string[] {
  return [...registeredUpdateFields];
}

/** Back to empty (tests). */
export function resetProjectUpdateFieldsForTests(): void {
  registeredUpdateFields.clear();
}
