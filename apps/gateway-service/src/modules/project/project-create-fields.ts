/**
 * The creation settings a closed feature adds to POST /team/:teamId/project,
 * so the core names none of them. The closed side registers its keys at
 * instantiation time (a factory provider of a closed module), and the
 * controller copies each registered key present in the body. Empty in the
 * core alone.
 */
const registeredCreateFields = new Set<string>();

/** Idempotent: a key is registered once. */
export function registerProjectCreateField(key: string): void {
  registeredCreateFields.add(key);
}

/** The registered keys, in registration order. `[]` in the core. */
export function projectCreateFields(): readonly string[] {
  return [...registeredCreateFields];
}

/** Back to empty (tests). */
export function resetProjectCreateFieldsForTests(): void {
  registeredCreateFields.clear();
}
