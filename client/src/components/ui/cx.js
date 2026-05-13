/**
 * cx — tiny className combiner. Filters falsy values and joins with spaces.
 * @param {...(string|false|null|undefined)} parts
 */
export function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}
