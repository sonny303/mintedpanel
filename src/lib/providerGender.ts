/** Optional gender values used by provider create and detail forms. */
export const PROVIDER_GENDER_UNSET_VALUE = "__provider_gender_not_set__";

export const PROVIDER_GENDER_OPTIONS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "nonbinary", label: "Nonbinary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

export type ProviderGender = (typeof PROVIDER_GENDER_OPTIONS)[number]["value"];

/** Resolve known stored values for display while leaving legacy strings intact. */
export function providerGenderLabel(value: string | null | undefined): string {
  if (!value) return "Not set";
  return PROVIDER_GENDER_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

/** Add a legacy value to the edit choices so Radix can display it unchanged. */
export function providerGenderOptionsForValue(value: string | null | undefined) {
  if (!value || PROVIDER_GENDER_OPTIONS.some((option) => option.value === value)) {
    return PROVIDER_GENDER_OPTIONS;
  }
  return [...PROVIDER_GENDER_OPTIONS, { value, label: value }];
}
