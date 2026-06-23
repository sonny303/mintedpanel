CREATE OR REPLACE FUNCTION public.get_sop_field_tokens()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_agg(jsonb_build_object('token', token, 'table', tbl, 'column', col) ORDER BY ord)
  FROM (VALUES
    ('provider.npi','providers','npi',1),
    ('provider.caqhId','providers','caqh_id',2),
    ('provider.taxonomyCode','providers','taxonomy_code',3),
    ('provider.firstName','providers','first_name',4),
    ('provider.lastName','providers','last_name',5),
    ('provider.email','providers','email',6),
    ('provider.licenseNumber','providers','license_number',7),
    ('provider.dea','providers','dea',8),
    ('provider.ssnLast4','providers','ssn_last4',9),
    ('group.name','provider_groups','name',20),
    ('group.tin','provider_groups','tin',21),
    ('group.npiType2','provider_groups','npi_type2',22),
    ('facility.name','facilities','name',40),
    ('facility.address','facilities','street',41),
    ('facility.city','facilities','city',42),
    ('facility.state','facilities','state',43),
    ('facility.zip','facilities','zip',44),
    ('mso.name','msos','name',60),
    ('mso.portalUrl','msos','portal_url',61),
    ('group_insurance.insurerName','group_insurance_policies','insurer_name',80),
    ('group_insurance.policyNumber','group_insurance_policies','policy_number',81),
    ('group_insurance.policyStartDate','group_insurance_policies','policy_start_date',82),
    ('group_insurance.policyEndDate','group_insurance_policies','policy_end_date',83),
    ('group_insurance.insuranceType','group_insurance_policies','insurance_type',84)
  ) AS t(token,tbl,col,ord);
$$;

GRANT EXECUTE ON FUNCTION public.get_sop_field_tokens() TO authenticated, anon;