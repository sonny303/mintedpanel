-- Schema only; no application rows, function bodies, defaults, or credentials
-- leave the process. Definitions contribute to the final digest in memory.
WITH ns AS (
  SELECT oid, nspname FROM pg_catalog.pg_namespace
  WHERE nspname IN ('public', 'private')
), rel AS (
  SELECT c.*, n.nspname FROM pg_catalog.pg_class c JOIN ns n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S')
)
SELECT jsonb_build_object(
  'relations', (SELECT coalesce(jsonb_agg(jsonb_build_array(nspname, relname, relkind,
    relrowsecurity, relforcerowsecurity, relacl) ORDER BY nspname, relname), '[]') FROM rel),
  'columns', (SELECT coalesce(jsonb_agg(jsonb_build_array(r.nspname, r.relname, a.attname,
    format_type(a.atttypid,a.atttypmod), a.attnotnull, a.attidentity, a.attgenerated,
    pg_get_expr(d.adbin,d.adrelid)) ORDER BY r.nspname,r.relname,a.attname), '[]')
    FROM pg_catalog.pg_attribute a JOIN rel r ON r.oid=a.attrelid
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attnum>0 AND NOT a.attisdropped),
  'constraints', (SELECT coalesce(jsonb_agg(jsonb_build_array(r.nspname,r.relname,c.conname,
    pg_get_constraintdef(c.oid,true)) ORDER BY r.nspname,r.relname,c.conname), '[]')
    FROM pg_catalog.pg_constraint c JOIN rel r ON r.oid=c.conrelid),
  'indexes', (SELECT coalesce(jsonb_agg(jsonb_build_array(r.nspname,r.relname,c.relname,
    pg_get_indexdef(i.indexrelid)) ORDER BY r.nspname,r.relname,c.relname), '[]')
    FROM pg_catalog.pg_index i JOIN rel r ON r.oid=i.indrelid JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid),
  'functions', (SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,p.proname,
    pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid),p.proacl)
    ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)), '[]')
    FROM pg_catalog.pg_proc p JOIN ns n ON n.oid=p.pronamespace WHERE p.prokind IN ('f','p')),
  'policies', (SELECT coalesce(jsonb_agg(jsonb_build_array(r.nspname,r.relname,p.polname,
    p.polcmd,p.polpermissive,(SELECT array_agg(rolname ORDER BY rolname) FROM pg_catalog.pg_roles WHERE oid=ANY(p.polroles)),
    0=ANY(p.polroles),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))
    ORDER BY r.nspname,r.relname,p.polname), '[]') FROM pg_catalog.pg_policy p JOIN rel r ON r.oid=p.polrelid),
  'triggers', (SELECT coalesce(jsonb_agg(jsonb_build_array(r.nspname,r.relname,t.tgname,t.tgenabled,
    pg_get_triggerdef(t.oid,true)) ORDER BY r.nspname,r.relname,t.tgname), '[]')
    FROM pg_catalog.pg_trigger t JOIN rel r ON r.oid=t.tgrelid WHERE NOT t.tgisinternal),
  'views', (SELECT coalesce(jsonb_agg(jsonb_build_array(nspname,relname,pg_get_viewdef(oid,true))
    ORDER BY nspname,relname), '[]') FROM rel WHERE relkind IN ('v','m')),
  'enums', (SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,t.typname,e.enumlabel,e.enumsortorder)
    ORDER BY n.nspname,t.typname,e.enumsortorder), '[]')
    FROM pg_catalog.pg_enum e JOIN pg_catalog.pg_type t ON t.oid=e.enumtypid JOIN ns n ON n.oid=t.typnamespace),
  'defaultAcls', (SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,pg_get_userbyid(d.defaclrole),d.defaclobjtype,d.defaclacl)
    ORDER BY n.nspname,pg_get_userbyid(d.defaclrole),d.defaclobjtype), '[]') FROM pg_catalog.pg_default_acl d JOIN ns n ON n.oid=d.defaclnamespace)
);
