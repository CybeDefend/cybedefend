/**
 * The project's compliance frameworks after one checkbox is ticked or cleared.
 * The frameworks offered come first, in their order; a stored value that is
 * not offered (set through the API, or one the backend knows and the list does
 * not) is kept, in front: the frameworks decide which compliance rules agents
 * are served, so a click on one box never drops another.
 */
export function toggleFramework(value: readonly string[], options: readonly string[], framework: string, on: boolean): string[] {
  const kept = value.filter((v) => !options.includes(v));
  return [...kept, ...options.filter((v) => (v === framework ? on : value.includes(v)))];
}

export default toggleFramework;
