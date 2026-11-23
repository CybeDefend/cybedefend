/**
 * The fields a closed feature adds to each organisation of the user profile,
 * so the core names none of them. The closed side registers its mapper at
 * instantiation time (a factory provider of a closed module); getProfile
 * merges every mapper's answer over the organisation as global-management
 * sent it. Empty in the core alone.
 */
export type ProfileOrganizationFields = (
  organization: Readonly<Record<string, unknown>>,
) => Record<string, unknown>;

const registered: ProfileOrganizationFields[] = [];

/** Idempotent: a mapper is registered once. */
export function registerProfileOrganizationFields(
  mapper: ProfileOrganizationFields,
): void {
  if (!registered.includes(mapper)) registered.push(mapper);
}

/** The registered mappers' fields for one organisation. `{}` in the core. */
export function profileOrganizationFields(
  organization: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.assign({}, ...registered.map((mapper) => mapper(organization)));
}

/** Back to empty (tests). */
export function resetProfileOrganizationFieldsForTests(): void {
  registered.length = 0;
}
