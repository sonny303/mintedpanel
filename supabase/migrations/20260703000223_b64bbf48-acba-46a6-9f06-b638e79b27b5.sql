-- A2 part 3 (signed off): de-dup state_licenses (keep oldest per
-- provider/state/number) and enforce uniqueness going forward.
-- Applied to the dev project via MCP as "dedupe_state_licenses_unique_index".

DELETE FROM public.state_licenses s
USING public.state_licenses k
WHERE s.provider_id = k.provider_id
  AND s.state = k.state
  AND s.license_number IS NOT DISTINCT FROM k.license_number
  AND k.created_at < s.created_at;

CREATE UNIQUE INDEX uq_state_licenses_provider_state_number
  ON public.state_licenses (provider_id, state, license_number);
