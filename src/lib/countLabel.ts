// Count copy: "1 case", "3 cases", "0 facilities". The singular form is for a
// count of exactly 1 and every other count (0 included) takes the plural. An
// irregular plural is passed explicitly; the default appends "s".

/** The form of a word for `count` — `singular` for 1, otherwise `plural`.
 * Also picks a verb form: pluralize(n, "blocks", "block"). */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

/** "1 group", "3 groups", "2 specialties" with an explicit plural. */
export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${pluralize(count, singular, plural)}`;
}
