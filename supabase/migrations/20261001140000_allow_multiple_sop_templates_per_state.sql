-- Migration: 20261001140000_allow_multiple_sop_templates_per_state.sql
-- Allow organizations to author multiple active payer templates covering the same state
-- (e.g. for different specialties or request types like initial vs recredentialing).

DROP TRIGGER IF EXISTS trg_sop_template_state_overlap ON public.sop_templates;
