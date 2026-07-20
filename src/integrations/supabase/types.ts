export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      audit_log: {
        Row: {
          action_type: string;
          after: Json | null;
          before: Json | null;
          created_at: string | null;
          description: string | null;
          entity_id: string | null;
          entity_type: string;
          id: string;
          org_id: string;
          ts: string | null;
          user_id: string | null;
          user_name: string | null;
        };
        Insert: {
          action_type: string;
          after?: Json | null;
          before?: Json | null;
          created_at?: string | null;
          description?: string | null;
          entity_id?: string | null;
          entity_type: string;
          id?: string;
          org_id: string;
          ts?: string | null;
          user_id?: string | null;
          user_name?: string | null;
        };
        Update: {
          action_type?: string;
          after?: Json | null;
          before?: Json | null;
          created_at?: string | null;
          description?: string | null;
          entity_id?: string | null;
          entity_type?: string;
          id?: string;
          org_id?: string;
          ts?: string | null;
          user_id?: string | null;
          user_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      case_generation_exclusions: {
        Row: {
          created_at: string;
          created_by: string;
          group_id: string;
          id: string;
          note: string | null;
          org_id: string;
          payer_id: string;
          provider_id: string;
          reason: string;
          state: string;
          status: string;
          voided_at: string | null;
          voided_by: string | null;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          group_id: string;
          id?: string;
          note?: string | null;
          org_id: string;
          payer_id: string;
          provider_id: string;
          reason: string;
          state: string;
          status?: string;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          group_id?: string;
          id?: string;
          note?: string | null;
          org_id?: string;
          payer_id?: string;
          provider_id?: string;
          reason?: string;
          state?: string;
          status?: string;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "case_generation_exclusions_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_generation_exclusions_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "provider_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_generation_exclusions_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_generation_exclusions_payer_id_fkey";
            columns: ["payer_id"];
            isOneToOne: false;
            referencedRelation: "payers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_generation_exclusions_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_generation_exclusions_voided_by_fkey";
            columns: ["voided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      case_generation_run_rows: {
        Row: {
          case_id: string | null;
          created_at: string;
          disposition: string;
          exclusion_id: string | null;
          group_id: string;
          id: string;
          org_id: string;
          payer_id: string;
          provider_id: string;
          reason: string | null;
          run_id: string;
          sop_resolution_tier: string | null;
          sop_template_id: string | null;
          sop_version: number | null;
          state: string;
        };
        Insert: {
          case_id?: string | null;
          created_at?: string;
          disposition: string;
          exclusion_id?: string | null;
          group_id: string;
          id?: string;
          org_id: string;
          payer_id: string;
          provider_id: string;
          reason?: string | null;
          run_id: string;
          sop_resolution_tier?: string | null;
          sop_template_id?: string | null;
          sop_version?: number | null;
          state: string;
        };
        Update: {
          case_id?: string | null;
          created_at?: string;
          disposition?: string;
          exclusion_id?: string | null;
          group_id?: string;
          id?: string;
          org_id?: string;
          payer_id?: string;
          provider_id?: string;
          reason?: string | null;
          run_id?: string;
          sop_resolution_tier?: string | null;
          sop_template_id?: string | null;
          sop_version?: number | null;
          state?: string;
        };
        Relationships: [
          {
            foreignKeyName: "case_generation_run_rows_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "credential_cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_generation_run_rows_exclusion_id_fkey";
            columns: ["exclusion_id"];
            isOneToOne: false;
            referencedRelation: "case_generation_exclusions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_generation_run_rows_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "provider_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_generation_run_rows_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_generation_run_rows_payer_id_fkey";
            columns: ["payer_id"];
            isOneToOne: false;
            referencedRelation: "payers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_generation_run_rows_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_generation_run_rows_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "case_generation_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      case_generation_runs: {
        Row: {
          created_at: string;
          created_by: string | null;
          created_count: number;
          excluded_count: number;
          failed_count: number;
          id: string;
          org_id: string;
          proposed_count: number;
          release_scope: Json | null;
          skipped_existing_count: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          created_count: number;
          excluded_count: number;
          failed_count: number;
          id?: string;
          org_id: string;
          proposed_count: number;
          release_scope?: Json | null;
          skipped_existing_count: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          created_count?: number;
          excluded_count?: number;
          failed_count?: number;
          id?: string;
          org_id?: string;
          proposed_count?: number;
          release_scope?: Json | null;
          skipped_existing_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "case_generation_runs_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_generation_runs_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      case_status_history: {
        Row: {
          actor_kind: string;
          case_id: string;
          changed_at: string;
          changed_by: string | null;
          evidence_touch_id: string | null;
          from_status: string | null;
          id: string;
          is_correction: boolean;
          note: string | null;
          org_id: string;
          reason_code_id: string | null;
          to_status: string;
        };
        Insert: {
          actor_kind?: string;
          case_id: string;
          changed_at?: string;
          changed_by?: string | null;
          evidence_touch_id?: string | null;
          from_status?: string | null;
          id?: string;
          is_correction?: boolean;
          note?: string | null;
          org_id: string;
          reason_code_id?: string | null;
          to_status: string;
        };
        Update: {
          actor_kind?: string;
          case_id?: string;
          changed_at?: string;
          changed_by?: string | null;
          evidence_touch_id?: string | null;
          from_status?: string | null;
          id?: string;
          is_correction?: boolean;
          note?: string | null;
          org_id?: string;
          reason_code_id?: string | null;
          to_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "case_status_history_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "credential_cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_status_history_evidence_touch_id_fkey";
            columns: ["evidence_touch_id"];
            isOneToOne: false;
            referencedRelation: "touches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_status_history_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_status_history_reason_code_id_fkey";
            columns: ["reason_code_id"];
            isOneToOne: false;
            referencedRelation: "denial_reason_codes";
            referencedColumns: ["id"];
          },
        ];
      };
      communication_event: {
        Row: {
          channel: string;
          created_at: string | null;
          created_by: string | null;
          id: string;
          occurred_at: string;
          org_id: string;
          payer_id: string;
        };
        Insert: {
          channel: string;
          created_at?: string | null;
          created_by?: string | null;
          id?: string;
          occurred_at?: string;
          org_id: string;
          payer_id: string;
        };
        Update: {
          channel?: string;
          created_at?: string | null;
          created_by?: string | null;
          id?: string;
          occurred_at?: string;
          org_id?: string;
          payer_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "communication_event_payer_id_fkey";
            columns: ["payer_id"];
            isOneToOne: false;
            referencedRelation: "payers";
            referencedColumns: ["id"];
          },
        ];
      };
      contracts: {
        Row: {
          contracting_status_id: string | null;
          created_at: string | null;
          effective_date: string | null;
          expiration_date: string | null;
          group_id: string | null;
          id: string;
          notes: string | null;
          org_id: string;
          payer_group_id: string | null;
          payer_id: string | null;
          state: string;
          updated_at: string | null;
        };
        Insert: {
          contracting_status_id?: string | null;
          created_at?: string | null;
          effective_date?: string | null;
          expiration_date?: string | null;
          group_id?: string | null;
          id?: string;
          notes?: string | null;
          org_id: string;
          payer_group_id?: string | null;
          payer_id?: string | null;
          state: string;
          updated_at?: string | null;
        };
        Update: {
          contracting_status_id?: string | null;
          created_at?: string | null;
          effective_date?: string | null;
          expiration_date?: string | null;
          group_id?: string | null;
          id?: string;
          notes?: string | null;
          org_id?: string;
          payer_group_id?: string | null;
          payer_id?: string | null;
          state?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "contracts_contracting_status_id_fkey";
            columns: ["contracting_status_id"];
            isOneToOne: false;
            referencedRelation: "status_configs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contracts_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "provider_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contracts_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contracts_payer_id_fkey";
            columns: ["payer_id"];
            isOneToOne: false;
            referencedRelation: "payers";
            referencedColumns: ["id"];
          },
        ];
      };
      credential_cases: {
        Row: {
          approved_date: string | null;
          assigned_to: string | null;
          case_email_token: string;
          case_status: string;
          confirmed_effective_date: string | null;
          contract_executed_date: string | null;
          created_at: string | null;
          created_by: string | null;
          credentialing_status_id: string | null;
          expected_effective_date: string | null;
          facility_id: string | null;
          generation_run_id: string | null;
          group_id: string | null;
          id: string;
          mso_id: string | null;
          org_id: string;
          payer_group_provider_id: string | null;
          payer_id: string;
          payer_individual_provider_id: string | null;
          payer_pipeline_state: string;
          payer_reference_id: string | null;
          provider_id: string;
          specialty: string | null;
          state: string;
          submitted_date: string | null;
          termination_date: string | null;
          updated_at: string | null;
        };
        Insert: {
          approved_date?: string | null;
          assigned_to?: string | null;
          case_email_token?: string;
          case_status?: string;
          confirmed_effective_date?: string | null;
          contract_executed_date?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          credentialing_status_id?: string | null;
          expected_effective_date?: string | null;
          facility_id?: string | null;
          generation_run_id?: string | null;
          group_id?: string | null;
          id?: string;
          mso_id?: string | null;
          org_id: string;
          payer_group_provider_id?: string | null;
          payer_id: string;
          payer_individual_provider_id?: string | null;
          payer_pipeline_state?: string;
          payer_reference_id?: string | null;
          provider_id: string;
          specialty?: string | null;
          state: string;
          submitted_date?: string | null;
          termination_date?: string | null;
          updated_at?: string | null;
        };
        Update: {
          approved_date?: string | null;
          assigned_to?: string | null;
          case_email_token?: string;
          case_status?: string;
          confirmed_effective_date?: string | null;
          contract_executed_date?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          credentialing_status_id?: string | null;
          expected_effective_date?: string | null;
          facility_id?: string | null;
          generation_run_id?: string | null;
          group_id?: string | null;
          id?: string;
          mso_id?: string | null;
          org_id?: string;
          payer_group_provider_id?: string | null;
          payer_id?: string;
          payer_individual_provider_id?: string | null;
          payer_pipeline_state?: string;
          payer_reference_id?: string | null;
          provider_id?: string;
          specialty?: string | null;
          state?: string;
          submitted_date?: string | null;
          termination_date?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "credential_cases_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "credential_cases_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "credential_cases_credentialing_status_id_fkey";
            columns: ["credentialing_status_id"];
            isOneToOne: false;
            referencedRelation: "status_configs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "credential_cases_facility_id_fkey";
            columns: ["facility_id"];
            isOneToOne: false;
            referencedRelation: "facilities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "credential_cases_generation_run_id_fkey";
            columns: ["generation_run_id"];
            isOneToOne: false;
            referencedRelation: "case_generation_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "credential_cases_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "provider_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "credential_cases_mso_id_fkey";
            columns: ["mso_id"];
            isOneToOne: false;
            referencedRelation: "msos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "credential_cases_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "credential_cases_payer_id_fkey";
            columns: ["payer_id"];
            isOneToOne: false;
            referencedRelation: "payers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "credential_cases_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      denial_reason_codes: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          id: string;
          label: string;
          org_id: string | null;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          id?: string;
          label: string;
          org_id?: string | null;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          id?: string;
          label?: string;
          org_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "denial_reason_codes_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      enrollment_facts: {
        Row: {
          created_at: string;
          created_by: string | null;
          effective_date: string | null;
          expired_at: string | null;
          expired_by: string | null;
          group_id: string;
          id: string;
          org_id: string;
          payer_id: string;
          provider_id: string;
          source: string;
          state: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          effective_date?: string | null;
          expired_at?: string | null;
          expired_by?: string | null;
          group_id: string;
          id?: string;
          org_id: string;
          payer_id: string;
          provider_id: string;
          source?: string;
          state: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          effective_date?: string | null;
          expired_at?: string | null;
          expired_by?: string | null;
          group_id?: string;
          id?: string;
          org_id?: string;
          payer_id?: string;
          provider_id?: string;
          source?: string;
          state?: string;
        };
        Relationships: [
          {
            foreignKeyName: "enrollment_facts_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "provider_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "enrollment_facts_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "enrollment_facts_payer_id_fkey";
            columns: ["payer_id"];
            isOneToOne: false;
            referencedRelation: "payers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "enrollment_facts_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      facilities: {
        Row: {
          accepting_new_patients: boolean | null;
          ada_compliance: Json | null;
          appointment_phone: string | null;
          city: string | null;
          contact_name: string | null;
          county: string | null;
          created_at: string;
          effective_date: string | null;
          email: string | null;
          fax: string | null;
          group_id: string | null;
          hours: Json | null;
          id: string;
          interpreter_languages: string[] | null;
          is_active: boolean;
          language_line: boolean | null;
          languages_offered: string[] | null;
          name: string;
          org_id: string;
          phone: string | null;
          reference_only: boolean;
          service_types: Json | null;
          state: string | null;
          status_id: string | null;
          street: string | null;
          suite: string | null;
          treating_categories: Json | null;
          zip: string | null;
        };
        Insert: {
          accepting_new_patients?: boolean | null;
          ada_compliance?: Json | null;
          appointment_phone?: string | null;
          city?: string | null;
          contact_name?: string | null;
          county?: string | null;
          created_at?: string;
          effective_date?: string | null;
          email?: string | null;
          fax?: string | null;
          group_id?: string | null;
          hours?: Json | null;
          id?: string;
          interpreter_languages?: string[] | null;
          is_active?: boolean;
          language_line?: boolean | null;
          languages_offered?: string[] | null;
          name: string;
          org_id: string;
          phone?: string | null;
          reference_only?: boolean;
          service_types?: Json | null;
          state?: string | null;
          status_id?: string | null;
          street?: string | null;
          suite?: string | null;
          treating_categories?: Json | null;
          zip?: string | null;
        };
        Update: {
          accepting_new_patients?: boolean | null;
          ada_compliance?: Json | null;
          appointment_phone?: string | null;
          city?: string | null;
          contact_name?: string | null;
          county?: string | null;
          created_at?: string;
          effective_date?: string | null;
          email?: string | null;
          fax?: string | null;
          group_id?: string | null;
          hours?: Json | null;
          id?: string;
          interpreter_languages?: string[] | null;
          is_active?: boolean;
          language_line?: boolean | null;
          languages_offered?: string[] | null;
          name?: string;
          org_id?: string;
          phone?: string | null;
          reference_only?: boolean;
          service_types?: Json | null;
          state?: string | null;
          status_id?: string | null;
          street?: string | null;
          suite?: string | null;
          treating_categories?: Json | null;
          zip?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "facilities_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "provider_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "facilities_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "facilities_status_id_fkey";
            columns: ["status_id"];
            isOneToOne: false;
            referencedRelation: "status_configs";
            referencedColumns: ["id"];
          },
        ];
      };
      field_dictionary: {
        Row: {
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
          id: string;
          label_normalized: string;
          org_id: string;
          seen_count: number;
          status: string;
          token: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          id?: string;
          label_normalized: string;
          org_id: string;
          seen_count?: number;
          status?: string;
          token: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          id?: string;
          label_normalized?: string;
          org_id?: string;
          seen_count?: number;
          status?: string;
          token?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "field_dictionary_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      fill_sessions: {
        Row: {
          case_id: string | null;
          completed_at: string | null;
          docs_attached: Json | null;
          fields_filled: number;
          fields_skipped: Json | null;
          fill_mode: string;
          id: string;
          is_test: boolean;
          org_id: string;
          performed_by: string | null;
          portal_key: string;
          provider_id: string | null;
          started_at: string;
        };
        Insert: {
          case_id?: string | null;
          completed_at?: string | null;
          docs_attached?: Json | null;
          fields_filled?: number;
          fields_skipped?: Json | null;
          fill_mode?: string;
          id?: string;
          is_test?: boolean;
          org_id: string;
          performed_by?: string | null;
          portal_key: string;
          provider_id?: string | null;
          started_at?: string;
        };
        Update: {
          case_id?: string | null;
          completed_at?: string | null;
          docs_attached?: Json | null;
          fields_filled?: number;
          fields_skipped?: Json | null;
          fill_mode?: string;
          id?: string;
          is_test?: boolean;
          org_id?: string;
          performed_by?: string | null;
          portal_key?: string;
          provider_id?: string | null;
          started_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fill_sessions_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "credential_cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fill_sessions_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fill_sessions_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      group_insurance_policies: {
        Row: {
          created_at: string | null;
          group_id: string;
          id: string;
          insurance_type: string;
          insurer_name: string;
          notes: string | null;
          org_id: string;
          policy_end_date: string;
          policy_number: string;
          policy_start_date: string;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          group_id: string;
          id?: string;
          insurance_type: string;
          insurer_name: string;
          notes?: string | null;
          org_id: string;
          policy_end_date: string;
          policy_number: string;
          policy_start_date: string;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          group_id?: string;
          id?: string;
          insurance_type?: string;
          insurer_name?: string;
          notes?: string | null;
          org_id?: string;
          policy_end_date?: string;
          policy_number?: string;
          policy_start_date?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "group_insurance_policies_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "provider_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_insurance_policies_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      import_rows: {
        Row: {
          created_at: string;
          error_column: string | null;
          error_reason: string | null;
          id: string;
          line: number;
          mapped: Json | null;
          org_id: string;
          raw: Json;
          row_state: string | null;
          run_id: string;
        };
        Insert: {
          created_at?: string;
          error_column?: string | null;
          error_reason?: string | null;
          id?: string;
          line: number;
          mapped?: Json | null;
          org_id: string;
          raw: Json;
          row_state?: string | null;
          run_id: string;
        };
        Update: {
          created_at?: string;
          error_column?: string | null;
          error_reason?: string | null;
          id?: string;
          line?: number;
          mapped?: Json | null;
          org_id?: string;
          raw?: Json;
          row_state?: string | null;
          run_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "import_rows_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "import_rows_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "import_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      import_runs: {
        Row: {
          committed_at: string | null;
          created_at: string;
          created_by: string;
          created_provider_ids: string[] | null;
          entity_kind: string;
          error_report: Json | null;
          error_rows: number | null;
          file_name: string | null;
          id: string;
          org_id: string;
          source: string;
          staged_rows: number | null;
          state: string;
          total_rows: number | null;
          updated_at: string;
          updated_provider_ids: string[] | null;
        };
        Insert: {
          committed_at?: string | null;
          created_at?: string;
          created_by: string;
          created_provider_ids?: string[] | null;
          entity_kind?: string;
          error_report?: Json | null;
          error_rows?: number | null;
          file_name?: string | null;
          id?: string;
          org_id: string;
          source: string;
          staged_rows?: number | null;
          state?: string;
          total_rows?: number | null;
          updated_at?: string;
          updated_provider_ids?: string[] | null;
        };
        Update: {
          committed_at?: string | null;
          created_at?: string;
          created_by?: string;
          created_provider_ids?: string[] | null;
          entity_kind?: string;
          error_report?: Json | null;
          error_rows?: number | null;
          file_name?: string | null;
          id?: string;
          org_id?: string;
          source?: string;
          staged_rows?: number | null;
          state?: string;
          total_rows?: number | null;
          updated_at?: string;
          updated_provider_ids?: string[] | null;
        };
        Relationships: [
          {
            foreignKeyName: "import_runs_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "import_runs_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      inbound_leads: {
        Row: {
          address_line1: string | null;
          address_line2: string | null;
          city: string | null;
          contact_email: string;
          contact_name: string;
          contact_phone: string | null;
          converted_org_id: string | null;
          country: string | null;
          created_at: string;
          id: string;
          org_name: string;
          postal_code: string | null;
          state: string | null;
          status: string;
        };
        Insert: {
          address_line1?: string | null;
          address_line2?: string | null;
          city?: string | null;
          contact_email: string;
          contact_name: string;
          contact_phone?: string | null;
          converted_org_id?: string | null;
          country?: string | null;
          created_at?: string;
          id?: string;
          org_name: string;
          postal_code?: string | null;
          state?: string | null;
          status?: string;
        };
        Update: {
          address_line1?: string | null;
          address_line2?: string | null;
          city?: string | null;
          contact_email?: string;
          contact_name?: string;
          contact_phone?: string | null;
          converted_org_id?: string | null;
          country?: string | null;
          created_at?: string;
          id?: string;
          org_name?: string;
          postal_code?: string | null;
          state?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inbound_leads_converted_org_id_fkey";
            columns: ["converted_org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      launches: {
        Row: {
          address: string | null;
          city: string | null;
          clinic_director_name: string | null;
          clinic_director_provider_id: string | null;
          confirmed_start_date: string | null;
          created_at: string | null;
          facility_id: string | null;
          group_id: string;
          gym_name: string | null;
          id: string;
          name: string;
          org_id: string;
          state: string;
          status: string;
          target_month: string | null;
        };
        Insert: {
          address?: string | null;
          city?: string | null;
          clinic_director_name?: string | null;
          clinic_director_provider_id?: string | null;
          confirmed_start_date?: string | null;
          created_at?: string | null;
          facility_id?: string | null;
          group_id: string;
          gym_name?: string | null;
          id?: string;
          name: string;
          org_id: string;
          state: string;
          status?: string;
          target_month?: string | null;
        };
        Update: {
          address?: string | null;
          city?: string | null;
          clinic_director_name?: string | null;
          clinic_director_provider_id?: string | null;
          confirmed_start_date?: string | null;
          created_at?: string | null;
          facility_id?: string | null;
          group_id?: string;
          gym_name?: string | null;
          id?: string;
          name?: string;
          org_id?: string;
          state?: string;
          status?: string;
          target_month?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "launches_clinic_director_provider_id_fkey";
            columns: ["clinic_director_provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "launches_facility_id_fkey";
            columns: ["facility_id"];
            isOneToOne: false;
            referencedRelation: "facilities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "launches_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "provider_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "launches_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      memberships: {
        Row: {
          created_at: string;
          id: string;
          org_id: string;
          role: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          org_id: string;
          role: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          org_id?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "memberships_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memberships_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      mso_routing_rules: {
        Row: {
          created_at: string | null;
          id: string;
          mso_id: string | null;
          notes: string | null;
          org_id: string;
          payer_id: string | null;
          route_type: string;
          specialty: string;
          state: string;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          mso_id?: string | null;
          notes?: string | null;
          org_id: string;
          payer_id?: string | null;
          route_type: string;
          specialty?: string;
          state: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          mso_id?: string | null;
          notes?: string | null;
          org_id?: string;
          payer_id?: string | null;
          route_type?: string;
          specialty?: string;
          state?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mso_routing_rules_mso_id_fkey";
            columns: ["mso_id"];
            isOneToOne: false;
            referencedRelation: "msos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mso_routing_rules_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mso_routing_rules_payer_id_fkey";
            columns: ["payer_id"];
            isOneToOne: false;
            referencedRelation: "payers";
            referencedColumns: ["id"];
          },
        ];
      };
      msos: {
        Row: {
          created_at: string | null;
          id: string;
          name: string;
          org_id: string;
          portal_url: string | null;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          name: string;
          org_id: string;
          portal_url?: string | null;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          name?: string;
          org_id?: string;
          portal_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "msos_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      next_best_action_configs: {
        Row: {
          org_id: string;
          ranking: Json;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          org_id: string;
          ranking: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          org_id?: string;
          ranking?: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "next_best_action_configs_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      notes: {
        Row: {
          author_id: string | null;
          content: string;
          created_at: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          org_id: string;
        };
        Insert: {
          author_id?: string | null;
          content: string;
          created_at?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          org_id: string;
        };
        Update: {
          author_id?: string | null;
          content?: string;
          created_at?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          org_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notes_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notes_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      notes_pre_touchlog_backup: {
        Row: {
          author_id: string | null;
          content: string | null;
          created_at: string | null;
          entity_id: string | null;
          entity_type: string | null;
          id: string | null;
          org_id: string | null;
        };
        Insert: {
          author_id?: string | null;
          content?: string | null;
          created_at?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string | null;
          org_id?: string | null;
        };
        Update: {
          author_id?: string | null;
          content?: string | null;
          created_at?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string | null;
          org_id?: string | null;
        };
        Relationships: [];
      };
      org_payer_assignments: {
        Row: {
          archived_at: string | null;
          created_at: string;
          id: string;
          org_id: string;
          payer_id: string;
          starter: boolean;
          status: string;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          id?: string;
          org_id: string;
          payer_id: string;
          starter?: boolean;
          status?: string;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          id?: string;
          org_id?: string;
          payer_id?: string;
          starter?: boolean;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "org_payer_assignments_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "org_payer_assignments_payer_id_fkey";
            columns: ["payer_id"];
            isOneToOne: false;
            referencedRelation: "payers";
            referencedColumns: ["id"];
          },
        ];
      };
      org_payer_settings: {
        Row: {
          created_at: string;
          id: string;
          org_id: string;
          payer_id: string;
          resolution_id_expected: boolean | null;
          resolution_id_label: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          org_id: string;
          payer_id: string;
          resolution_id_expected?: boolean | null;
          resolution_id_label?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          org_id?: string;
          payer_id?: string;
          resolution_id_expected?: boolean | null;
          resolution_id_label?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "org_payer_settings_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "org_payer_settings_payer_id_fkey";
            columns: ["payer_id"];
            isOneToOne: false;
            referencedRelation: "payers";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          id: string;
          lifecycle_state: string;
          name: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          lifecycle_state?: string;
          name: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          lifecycle_state?: string;
          name?: string;
        };
        Relationships: [];
      };
      parties: {
        Row: {
          address_line1: string | null;
          address_line2: string | null;
          city: string | null;
          country: string | null;
          created_at: string;
          created_by: string;
          email: string | null;
          id: string;
          name: string;
          party_type: string;
          phone_mobile: string | null;
          phone_office: string | null;
          postal_code: string | null;
          state: string | null;
        };
        Insert: {
          address_line1?: string | null;
          address_line2?: string | null;
          city?: string | null;
          country?: string | null;
          created_at?: string;
          created_by: string;
          email?: string | null;
          id?: string;
          name: string;
          party_type?: string;
          phone_mobile?: string | null;
          phone_office?: string | null;
          postal_code?: string | null;
          state?: string | null;
        };
        Update: {
          address_line1?: string | null;
          address_line2?: string | null;
          city?: string | null;
          country?: string | null;
          created_at?: string;
          created_by?: string;
          email?: string | null;
          id?: string;
          name?: string;
          party_type?: string;
          phone_mobile?: string | null;
          phone_office?: string | null;
          postal_code?: string | null;
          state?: string | null;
        };
        Relationships: [];
      };
      party_capture_links: {
        Row: {
          created_at: string;
          created_by: string;
          expires_at: string;
          id: string;
          org_id: string;
          party_id: string;
          recipient_email: string;
          state: string;
          token_hash: string;
          used_at: string | null;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          expires_at: string;
          id?: string;
          org_id: string;
          party_id: string;
          recipient_email: string;
          state?: string;
          token_hash: string;
          used_at?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          expires_at?: string;
          id?: string;
          org_id?: string;
          party_id?: string;
          recipient_email?: string;
          state?: string;
          token_hash?: string;
          used_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "party_capture_links_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "party_capture_links_party_id_fkey";
            columns: ["party_id"];
            isOneToOne: false;
            referencedRelation: "parties";
            referencedColumns: ["id"];
          },
        ];
      };
      party_role_assignments: {
        Row: {
          created_at: string;
          id: string;
          org_id: string;
          party_id: string;
          role_key: string;
          scope_id: string | null;
          scope_type: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          org_id: string;
          party_id: string;
          role_key: string;
          scope_id?: string | null;
          scope_type?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          org_id?: string;
          party_id?: string;
          role_key?: string;
          scope_id?: string | null;
          scope_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "party_role_assignments_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "party_role_assignments_party_id_fkey";
            columns: ["party_id"];
            isOneToOne: false;
            referencedRelation: "parties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "party_role_assignments_role_key_fkey";
            columns: ["role_key"];
            isOneToOne: false;
            referencedRelation: "party_role_types";
            referencedColumns: ["role_key"];
          },
        ];
      };
      party_role_types: {
        Row: {
          is_active: boolean;
          label: string;
          role_key: string;
        };
        Insert: {
          is_active: boolean;
          label: string;
          role_key: string;
        };
        Update: {
          is_active?: boolean;
          label?: string;
          role_key?: string;
        };
        Relationships: [];
      };
      payer_catalog_changes: {
        Row: {
          created_at: string;
          field: string;
          id: string;
          new_value: string | null;
          old_value: string | null;
          payer_id: string;
          review_state: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          source: string;
        };
        Insert: {
          created_at?: string;
          field: string;
          id?: string;
          new_value?: string | null;
          old_value?: string | null;
          payer_id: string;
          review_state?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source?: string;
        };
        Update: {
          created_at?: string;
          field?: string;
          id?: string;
          new_value?: string | null;
          old_value?: string | null;
          payer_id?: string;
          review_state?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payer_catalog_changes_payer_id_fkey";
            columns: ["payer_id"];
            isOneToOne: false;
            referencedRelation: "payers";
            referencedColumns: ["id"];
          },
        ];
      };
      payer_network_targets: {
        Row: {
          created_at: string;
          group_id: string;
          id: string;
          org_id: string;
          payer_id: string;
          state: string;
          status: string;
        };
        Insert: {
          created_at?: string;
          group_id: string;
          id?: string;
          org_id: string;
          payer_id: string;
          state: string;
          status?: string;
        };
        Update: {
          created_at?: string;
          group_id?: string;
          id?: string;
          org_id?: string;
          payer_id?: string;
          state?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payer_network_targets_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "provider_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payer_network_targets_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payer_network_targets_payer_id_fkey";
            columns: ["payer_id"];
            isOneToOne: false;
            referencedRelation: "payers";
            referencedColumns: ["id"];
          },
        ];
      };
      payer_pipeline_history: {
        Row: {
          case_id: string;
          changed_at: string;
          changed_by: string | null;
          from_state: string | null;
          id: string;
          is_correction: boolean;
          justification: string | null;
          org_id: string;
          reason_code_id: string | null;
          to_state: string;
        };
        Insert: {
          case_id: string;
          changed_at?: string;
          changed_by?: string | null;
          from_state?: string | null;
          id?: string;
          is_correction?: boolean;
          justification?: string | null;
          org_id: string;
          reason_code_id?: string | null;
          to_state: string;
        };
        Update: {
          case_id?: string;
          changed_at?: string;
          changed_by?: string | null;
          from_state?: string | null;
          id?: string;
          is_correction?: boolean;
          justification?: string | null;
          org_id?: string;
          reason_code_id?: string | null;
          to_state?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payer_pipeline_history_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "credential_cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payer_pipeline_history_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payer_pipeline_history_reason_code_id_fkey";
            columns: ["reason_code_id"];
            isOneToOne: false;
            referencedRelation: "denial_reason_codes";
            referencedColumns: ["id"];
          },
        ];
      };
      payers: {
        Row: {
          aliases: string[] | null;
          avg_decision_days: number | null;
          created_at: string | null;
          delegation_note: string | null;
          id: string;
          is_active: boolean | null;
          last_synced_at: string | null;
          merged_into_id: string | null;
          name: string;
          org_id: string | null;
          payer_kind: string;
          payer_slug: string | null;
          resolution_id_expected: boolean | null;
          resolution_id_label: string | null;
          states: string[] | null;
          status: string;
        };
        Insert: {
          aliases?: string[] | null;
          avg_decision_days?: number | null;
          created_at?: string | null;
          delegation_note?: string | null;
          id?: string;
          is_active?: boolean | null;
          last_synced_at?: string | null;
          merged_into_id?: string | null;
          name: string;
          org_id?: string | null;
          payer_kind?: string;
          payer_slug?: string | null;
          resolution_id_expected?: boolean | null;
          resolution_id_label?: string | null;
          states?: string[] | null;
          status?: string;
        };
        Update: {
          aliases?: string[] | null;
          avg_decision_days?: number | null;
          created_at?: string | null;
          delegation_note?: string | null;
          id?: string;
          is_active?: boolean | null;
          last_synced_at?: string | null;
          merged_into_id?: string | null;
          name?: string;
          org_id?: string | null;
          payer_kind?: string;
          payer_slug?: string | null;
          resolution_id_expected?: boolean | null;
          resolution_id_label?: string | null;
          states?: string[] | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payers_merged_into_id_fkey";
            columns: ["merged_into_id"];
            isOneToOne: false;
            referencedRelation: "payers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payers_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      pending_invites: {
        Row: {
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          invited_by: string | null;
          org_id: string;
          role: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          full_name?: string | null;
          id?: string;
          invited_by?: string | null;
          org_id: string;
          role: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          invited_by?: string | null;
          org_id?: string;
          role?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pending_invites_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      portal_field_maps: {
        Row: {
          confidence: number | null;
          created_at: string;
          field_label: string | null;
          field_type: string;
          form_section: string | null;
          hardcoded_value: string | null;
          id: string;
          map_type: string;
          notes: string | null;
          org_id: string | null;
          page_step: string | null;
          portal_key: string;
          selector: string;
          selector_fallbacks: Json | null;
          source: string;
          status: string;
          token: string | null;
          transform: string | null;
          updated_at: string;
          url_pattern: string | null;
        };
        Insert: {
          confidence?: number | null;
          created_at?: string;
          field_label?: string | null;
          field_type: string;
          form_section?: string | null;
          hardcoded_value?: string | null;
          id?: string;
          map_type: string;
          notes?: string | null;
          org_id?: string | null;
          page_step?: string | null;
          portal_key: string;
          selector: string;
          selector_fallbacks?: Json | null;
          source: string;
          status?: string;
          token?: string | null;
          transform?: string | null;
          updated_at?: string;
          url_pattern?: string | null;
        };
        Update: {
          confidence?: number | null;
          created_at?: string;
          field_label?: string | null;
          field_type?: string;
          form_section?: string | null;
          hardcoded_value?: string | null;
          id?: string;
          map_type?: string;
          notes?: string | null;
          org_id?: string | null;
          page_step?: string | null;
          portal_key?: string;
          selector?: string;
          selector_fallbacks?: Json | null;
          source?: string;
          status?: string;
          token?: string | null;
          transform?: string | null;
          updated_at?: string;
          url_pattern?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "portal_field_maps_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      portals: {
        Row: {
          created_at: string;
          form_url: string | null;
          id: string;
          is_verified: boolean;
          last_verified_at: string | null;
          name: string;
          org_id: string | null;
          payer_id: string | null;
          portal_key: string;
          proven_at: string | null;
          updated_at: string;
          url_changed_at: string | null;
        };
        Insert: {
          created_at?: string;
          form_url?: string | null;
          id?: string;
          is_verified?: boolean;
          last_verified_at?: string | null;
          name: string;
          org_id?: string | null;
          payer_id?: string | null;
          portal_key: string;
          proven_at?: string | null;
          updated_at?: string;
          url_changed_at?: string | null;
        };
        Update: {
          created_at?: string;
          form_url?: string | null;
          id?: string;
          is_verified?: boolean;
          last_verified_at?: string | null;
          name?: string;
          org_id?: string | null;
          payer_id?: string | null;
          portal_key?: string;
          proven_at?: string | null;
          updated_at?: string;
          url_changed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "portals_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "portals_payer_id_fkey";
            columns: ["payer_id"];
            isOneToOne: false;
            referencedRelation: "payers";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          email: string | null;
          full_name: string | null;
          id: string;
        };
        Insert: {
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id: string;
        };
        Update: {
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
        };
        Relationships: [];
      };
      provider_documents: {
        Row: {
          case_id: string | null;
          created_at: string;
          doc_type: string;
          document_family_id: string;
          effective_date: string | null;
          expiration_date: string | null;
          file_name: string;
          file_path: string;
          group_id: string | null;
          id: string;
          org_id: string;
          provider_id: string | null;
          supersedes_document_id: string | null;
          uploaded_by: string | null;
          version_number: number;
        };
        Insert: {
          case_id?: string | null;
          created_at?: string;
          doc_type: string;
          document_family_id?: string;
          effective_date?: string | null;
          expiration_date?: string | null;
          file_name: string;
          file_path: string;
          group_id?: string | null;
          id?: string;
          org_id: string;
          provider_id?: string | null;
          supersedes_document_id?: string | null;
          uploaded_by?: string | null;
          version_number?: number;
        };
        Update: {
          case_id?: string | null;
          created_at?: string;
          doc_type?: string;
          document_family_id?: string;
          effective_date?: string | null;
          expiration_date?: string | null;
          file_name?: string;
          file_path?: string;
          group_id?: string | null;
          id?: string;
          org_id?: string;
          provider_id?: string | null;
          supersedes_document_id?: string | null;
          uploaded_by?: string | null;
          version_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: "provider_documents_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "credential_cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "provider_documents_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "provider_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "provider_documents_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "provider_documents_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "provider_documents_supersedes_fkey";
            columns: ["supersedes_document_id"];
            isOneToOne: false;
            referencedRelation: "provider_documents";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_facility_assignments: {
        Row: {
          created_at: string | null;
          facility_id: string | null;
          id: string;
          is_primary: boolean | null;
          org_id: string;
          practice_frequency: string | null;
          provider_id: string | null;
          start_date: string | null;
        };
        Insert: {
          created_at?: string | null;
          facility_id?: string | null;
          id?: string;
          is_primary?: boolean | null;
          org_id: string;
          practice_frequency?: string | null;
          provider_id?: string | null;
          start_date?: string | null;
        };
        Update: {
          created_at?: string | null;
          facility_id?: string | null;
          id?: string;
          is_primary?: boolean | null;
          org_id?: string;
          practice_frequency?: string | null;
          provider_id?: string | null;
          start_date?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "provider_facility_assignments_facility_id_fkey";
            columns: ["facility_id"];
            isOneToOne: false;
            referencedRelation: "facilities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "provider_facility_assignments_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "provider_facility_assignments_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_group_assignments: {
        Row: {
          created_at: string;
          end_date: string | null;
          group_id: string;
          id: string;
          is_primary: boolean;
          org_id: string;
          provider_id: string;
          start_date: string | null;
        };
        Insert: {
          created_at?: string;
          end_date?: string | null;
          group_id: string;
          id?: string;
          is_primary?: boolean;
          org_id: string;
          provider_id: string;
          start_date?: string | null;
        };
        Update: {
          created_at?: string;
          end_date?: string | null;
          group_id?: string;
          id?: string;
          is_primary?: boolean;
          org_id?: string;
          provider_id?: string;
          start_date?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "provider_group_assignments_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "provider_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "provider_group_assignments_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "provider_group_assignments_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_groups: {
        Row: {
          billing_city: string | null;
          billing_contact_name: string | null;
          billing_email: string | null;
          billing_fax: string | null;
          billing_phone: string | null;
          billing_state: string | null;
          billing_street: string | null;
          billing_suite: string | null;
          billing_zip: string | null;
          contract_signer_email: string | null;
          contract_signer_name: string | null;
          contracting_contact_email: string | null;
          contracting_contact_name: string | null;
          contracting_contact_title: string | null;
          correspondence_city: string | null;
          correspondence_contact_name: string | null;
          correspondence_email: string | null;
          correspondence_fax: string | null;
          correspondence_phone: string | null;
          correspondence_state: string | null;
          correspondence_street: string | null;
          correspondence_suite: string | null;
          correspondence_zip: string | null;
          created_at: string;
          credentialing_city: string | null;
          credentialing_contact_name: string | null;
          credentialing_email: string | null;
          credentialing_fax: string | null;
          credentialing_phone: string | null;
          credentialing_state: string | null;
          credentialing_street: string | null;
          credentialing_suite: string | null;
          credentialing_zip: string | null;
          id: string;
          is_active: boolean;
          name: string;
          npi_type2: string | null;
          org_id: string;
          preferred_contact_method: string | null;
          states: string[] | null;
          tax_id_type: string | null;
          tin: string | null;
          website_url: string | null;
        };
        Insert: {
          billing_city?: string | null;
          billing_contact_name?: string | null;
          billing_email?: string | null;
          billing_fax?: string | null;
          billing_phone?: string | null;
          billing_state?: string | null;
          billing_street?: string | null;
          billing_suite?: string | null;
          billing_zip?: string | null;
          contract_signer_email?: string | null;
          contract_signer_name?: string | null;
          contracting_contact_email?: string | null;
          contracting_contact_name?: string | null;
          contracting_contact_title?: string | null;
          correspondence_city?: string | null;
          correspondence_contact_name?: string | null;
          correspondence_email?: string | null;
          correspondence_fax?: string | null;
          correspondence_phone?: string | null;
          correspondence_state?: string | null;
          correspondence_street?: string | null;
          correspondence_suite?: string | null;
          correspondence_zip?: string | null;
          created_at?: string;
          credentialing_city?: string | null;
          credentialing_contact_name?: string | null;
          credentialing_email?: string | null;
          credentialing_fax?: string | null;
          credentialing_phone?: string | null;
          credentialing_state?: string | null;
          credentialing_street?: string | null;
          credentialing_suite?: string | null;
          credentialing_zip?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          npi_type2?: string | null;
          org_id: string;
          preferred_contact_method?: string | null;
          states?: string[] | null;
          tax_id_type?: string | null;
          tin?: string | null;
          website_url?: string | null;
        };
        Update: {
          billing_city?: string | null;
          billing_contact_name?: string | null;
          billing_email?: string | null;
          billing_fax?: string | null;
          billing_phone?: string | null;
          billing_state?: string | null;
          billing_street?: string | null;
          billing_suite?: string | null;
          billing_zip?: string | null;
          contract_signer_email?: string | null;
          contract_signer_name?: string | null;
          contracting_contact_email?: string | null;
          contracting_contact_name?: string | null;
          contracting_contact_title?: string | null;
          correspondence_city?: string | null;
          correspondence_contact_name?: string | null;
          correspondence_email?: string | null;
          correspondence_fax?: string | null;
          correspondence_phone?: string | null;
          correspondence_state?: string | null;
          correspondence_street?: string | null;
          correspondence_suite?: string | null;
          correspondence_zip?: string | null;
          created_at?: string;
          credentialing_city?: string | null;
          credentialing_contact_name?: string | null;
          credentialing_email?: string | null;
          credentialing_fax?: string | null;
          credentialing_phone?: string | null;
          credentialing_state?: string | null;
          credentialing_street?: string | null;
          credentialing_suite?: string | null;
          credentialing_zip?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          npi_type2?: string | null;
          org_id?: string;
          preferred_contact_method?: string | null;
          states?: string[] | null;
          tax_id_type?: string | null;
          tin?: string | null;
          website_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "provider_groups_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_ssn_intake_links: {
        Row: {
          created_at: string;
          created_by: string;
          expires_at: string;
          id: string;
          org_id: string;
          provider_id: string;
          recipient_email: string;
          state: string;
          token_hash: string;
          used_at: string | null;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          expires_at: string;
          id?: string;
          org_id: string;
          provider_id: string;
          recipient_email: string;
          state?: string;
          token_hash: string;
          used_at?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          expires_at?: string;
          id?: string;
          org_id?: string;
          provider_id?: string;
          recipient_email?: string;
          state?: string;
          token_hash?: string;
          used_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "provider_ssn_intake_links_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "provider_ssn_intake_links_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_ssn_vault: {
        Row: {
          algo: string;
          created_at: string;
          created_by: string | null;
          key_version: number;
          org_id: string;
          provider_id: string;
          ssn_ciphertext: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          algo?: string;
          created_at?: string;
          created_by?: string | null;
          key_version?: number;
          org_id: string;
          provider_id: string;
          ssn_ciphertext: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          algo?: string;
          created_at?: string;
          created_by?: string | null;
          key_version?: number;
          org_id?: string;
          provider_id?: string;
          ssn_ciphertext?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "provider_ssn_vault_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "provider_ssn_vault_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: true;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      providers: {
        Row: {
          additional_certifications: Json | null;
          age_groups_served: string[] | null;
          board_certified: boolean | null;
          caqh_id: string | null;
          caqh_last_attested_date: string | null;
          created_at: string | null;
          credentials: string | null;
          cultural_competency_training: boolean | null;
          date_of_birth: string | null;
          dea_expiration_date: string | null;
          dea_number: string | null;
          degree: string | null;
          email: string | null;
          ethnicity: string | null;
          first_name: string;
          gender: string | null;
          graduation_date: string | null;
          group_id: string | null;
          home_city: string | null;
          home_state: string | null;
          home_street: string | null;
          home_zip: string | null;
          id: string;
          is_new_grad: boolean | null;
          is_test_provider: boolean;
          languages: string[] | null;
          last_name: string;
          launch_id: string | null;
          license_expiration_date: string | null;
          license_issue_date: string | null;
          license_number: string | null;
          license_state: string | null;
          malpractice_carrier: string | null;
          malpractice_coverage_end: string | null;
          malpractice_coverage_start: string | null;
          malpractice_policy_number: string | null;
          medicaid_attested: boolean | null;
          middle_initial: string | null;
          npi: string | null;
          org_id: string;
          phone: string | null;
          reference_only: boolean;
          school_name: string | null;
          specialty: string | null;
          ssn_last4: string | null;
          start_date: string | null;
          status: string;
          sub_specialty: string | null;
          suffix: string | null;
          taxonomy_code: string | null;
          terminated_date: string | null;
          updated_at: string | null;
          verification_state: string;
        };
        Insert: {
          additional_certifications?: Json | null;
          age_groups_served?: string[] | null;
          board_certified?: boolean | null;
          caqh_id?: string | null;
          caqh_last_attested_date?: string | null;
          created_at?: string | null;
          credentials?: string | null;
          cultural_competency_training?: boolean | null;
          date_of_birth?: string | null;
          dea_expiration_date?: string | null;
          dea_number?: string | null;
          degree?: string | null;
          email?: string | null;
          ethnicity?: string | null;
          first_name: string;
          gender?: string | null;
          graduation_date?: string | null;
          group_id?: string | null;
          home_city?: string | null;
          home_state?: string | null;
          home_street?: string | null;
          home_zip?: string | null;
          id?: string;
          is_new_grad?: boolean | null;
          is_test_provider?: boolean;
          languages?: string[] | null;
          last_name: string;
          launch_id?: string | null;
          license_expiration_date?: string | null;
          license_issue_date?: string | null;
          license_number?: string | null;
          license_state?: string | null;
          malpractice_carrier?: string | null;
          malpractice_coverage_end?: string | null;
          malpractice_coverage_start?: string | null;
          malpractice_policy_number?: string | null;
          medicaid_attested?: boolean | null;
          middle_initial?: string | null;
          npi?: string | null;
          org_id: string;
          phone?: string | null;
          reference_only?: boolean;
          school_name?: string | null;
          specialty?: string | null;
          ssn_last4?: string | null;
          start_date?: string | null;
          status?: string;
          sub_specialty?: string | null;
          suffix?: string | null;
          taxonomy_code?: string | null;
          terminated_date?: string | null;
          updated_at?: string | null;
          verification_state?: string;
        };
        Update: {
          additional_certifications?: Json | null;
          age_groups_served?: string[] | null;
          board_certified?: boolean | null;
          caqh_id?: string | null;
          caqh_last_attested_date?: string | null;
          created_at?: string | null;
          credentials?: string | null;
          cultural_competency_training?: boolean | null;
          date_of_birth?: string | null;
          dea_expiration_date?: string | null;
          dea_number?: string | null;
          degree?: string | null;
          email?: string | null;
          ethnicity?: string | null;
          first_name?: string;
          gender?: string | null;
          graduation_date?: string | null;
          group_id?: string | null;
          home_city?: string | null;
          home_state?: string | null;
          home_street?: string | null;
          home_zip?: string | null;
          id?: string;
          is_new_grad?: boolean | null;
          is_test_provider?: boolean;
          languages?: string[] | null;
          last_name?: string;
          launch_id?: string | null;
          license_expiration_date?: string | null;
          license_issue_date?: string | null;
          license_number?: string | null;
          license_state?: string | null;
          malpractice_carrier?: string | null;
          malpractice_coverage_end?: string | null;
          malpractice_coverage_start?: string | null;
          malpractice_policy_number?: string | null;
          medicaid_attested?: boolean | null;
          middle_initial?: string | null;
          npi?: string | null;
          org_id?: string;
          phone?: string | null;
          reference_only?: boolean;
          school_name?: string | null;
          specialty?: string | null;
          ssn_last4?: string | null;
          start_date?: string | null;
          status?: string;
          sub_specialty?: string | null;
          suffix?: string | null;
          taxonomy_code?: string | null;
          terminated_date?: string | null;
          updated_at?: string | null;
          verification_state?: string;
        };
        Relationships: [
          {
            foreignKeyName: "providers_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "provider_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "providers_launch_id_fkey";
            columns: ["launch_id"];
            isOneToOne: false;
            referencedRelation: "launches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "providers_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      public_rpc_attempts: {
        Row: {
          attempted_at: string;
          caller_hash: string;
          id: string;
          rpc_name: string;
          was_valid: boolean;
        };
        Insert: {
          attempted_at?: string;
          caller_hash: string;
          id?: string;
          rpc_name: string;
          was_valid?: boolean;
        };
        Update: {
          attempted_at?: string;
          caller_hash?: string;
          id?: string;
          rpc_name?: string;
          was_valid?: boolean;
        };
        Relationships: [];
      };
      report_shares: {
        Row: {
          created_at: string;
          created_by: string;
          expires_at: string;
          id: string;
          recipient_email: string;
          report_key: string;
          revoked_at: string | null;
          scope: string;
          scope_org_id: string | null;
          state: string;
          token_hash: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          expires_at: string;
          id?: string;
          recipient_email: string;
          report_key: string;
          revoked_at?: string | null;
          scope: string;
          scope_org_id?: string | null;
          state?: string;
          token_hash: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          expires_at?: string;
          id?: string;
          recipient_email?: string;
          report_key?: string;
          revoked_at?: string | null;
          scope?: string;
          scope_org_id?: string | null;
          state?: string;
          token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "report_shares_scope_org_id_fkey";
            columns: ["scope_org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      sop_template_drafts: {
        Row: {
          created_at: string;
          id: string;
          org_id: string;
          payload: Json;
          template_id: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          org_id: string;
          payload: Json;
          template_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          org_id?: string;
          payload?: Json;
          template_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "sop_template_drafts_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sop_template_drafts_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "sop_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      sop_template_versions: {
        Row: {
          change_note: string | null;
          id: string;
          name: string;
          published_at: string;
          published_by: string | null;
          required_profile_attributes: Json;
          task_definitions: Json;
          template_id: string;
          version: number;
        };
        Insert: {
          change_note?: string | null;
          id?: string;
          name: string;
          published_at?: string;
          published_by?: string | null;
          required_profile_attributes?: Json;
          task_definitions: Json;
          template_id: string;
          version: number;
        };
        Update: {
          change_note?: string | null;
          id?: string;
          name?: string;
          published_at?: string;
          published_by?: string | null;
          required_profile_attributes?: Json;
          task_definitions?: Json;
          template_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "sop_template_versions_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "sop_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      sop_templates: {
        Row: {
          archived: boolean;
          created_at: string | null;
          current_version: number;
          group_id: string | null;
          id: string;
          name: string;
          org_id: string | null;
          payer_id: string | null;
          required_profile_attributes: Json;
          specialty: string | null;
          state: string | null;
          task_definitions: Json;
          updated_at: string | null;
        };
        Insert: {
          archived?: boolean;
          created_at?: string | null;
          current_version?: number;
          group_id?: string | null;
          id?: string;
          name: string;
          org_id?: string | null;
          payer_id?: string | null;
          required_profile_attributes?: Json;
          specialty?: string | null;
          state?: string | null;
          task_definitions?: Json;
          updated_at?: string | null;
        };
        Update: {
          archived?: boolean;
          created_at?: string | null;
          current_version?: number;
          group_id?: string | null;
          id?: string;
          name?: string;
          org_id?: string | null;
          payer_id?: string | null;
          required_profile_attributes?: Json;
          specialty?: string | null;
          state?: string | null;
          task_definitions?: Json;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "sop_templates_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "provider_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sop_templates_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sop_templates_payer_id_fkey";
            columns: ["payer_id"];
            isOneToOne: false;
            referencedRelation: "payers";
            referencedColumns: ["id"];
          },
        ];
      };
      state_licenses: {
        Row: {
          created_at: string | null;
          expiration_date: string | null;
          id: string;
          issue_date: string | null;
          license_number: string | null;
          license_type: string | null;
          org_id: string;
          provider_id: string | null;
          state: string;
          status: string | null;
          verification_source_url: string | null;
          verified_at: string | null;
          verified_by: string | null;
          verified_status: string;
        };
        Insert: {
          created_at?: string | null;
          expiration_date?: string | null;
          id?: string;
          issue_date?: string | null;
          license_number?: string | null;
          license_type?: string | null;
          org_id: string;
          provider_id?: string | null;
          state: string;
          status?: string | null;
          verification_source_url?: string | null;
          verified_at?: string | null;
          verified_by?: string | null;
          verified_status?: string;
        };
        Update: {
          created_at?: string | null;
          expiration_date?: string | null;
          id?: string;
          issue_date?: string | null;
          license_number?: string | null;
          license_type?: string | null;
          org_id?: string;
          provider_id?: string | null;
          state?: string;
          status?: string | null;
          verification_source_url?: string | null;
          verified_at?: string | null;
          verified_by?: string | null;
          verified_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "state_licenses_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "state_licenses_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      status_configs: {
        Row: {
          action_bucket: string;
          color: string;
          created_at: string | null;
          id: string;
          label: string;
          org_id: string;
          required_fields: Json | null;
          sort_order: number;
          track: string;
        };
        Insert: {
          action_bucket?: string;
          color: string;
          created_at?: string | null;
          id?: string;
          label: string;
          org_id: string;
          required_fields?: Json | null;
          sort_order: number;
          track: string;
        };
        Update: {
          action_bucket?: string;
          color?: string;
          created_at?: string | null;
          id?: string;
          label?: string;
          org_id?: string;
          required_fields?: Json | null;
          sort_order?: number;
          track?: string;
        };
        Relationships: [
          {
            foreignKeyName: "status_configs_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      status_history: {
        Row: {
          case_id: string | null;
          changed_at: string | null;
          changed_by: string | null;
          contract_id: string | null;
          created_at: string | null;
          from_status_id: string | null;
          id: string;
          metadata: Json | null;
          org_id: string;
          to_status_id: string | null;
          track: string;
        };
        Insert: {
          case_id?: string | null;
          changed_at?: string | null;
          changed_by?: string | null;
          contract_id?: string | null;
          created_at?: string | null;
          from_status_id?: string | null;
          id?: string;
          metadata?: Json | null;
          org_id: string;
          to_status_id?: string | null;
          track: string;
        };
        Update: {
          case_id?: string | null;
          changed_at?: string | null;
          changed_by?: string | null;
          contract_id?: string | null;
          created_at?: string | null;
          from_status_id?: string | null;
          id?: string;
          metadata?: Json | null;
          org_id?: string;
          to_status_id?: string | null;
          track?: string;
        };
        Relationships: [
          {
            foreignKeyName: "status_history_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "credential_cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "status_history_changed_by_fkey";
            columns: ["changed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "status_history_contract_id_fkey";
            columns: ["contract_id"];
            isOneToOne: false;
            referencedRelation: "contracts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "status_history_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          case_id: string | null;
          completed_date: string | null;
          created_at: string | null;
          description: string | null;
          due_date: string | null;
          execution_type: string | null;
          id: string;
          is_auto_generated: boolean | null;
          org_id: string;
          provider_id: string | null;
          sop_content: Json | null;
          sop_resolution_tier: string | null;
          sop_template_id: string | null;
          sop_version: number | null;
          sort_order: number | null;
          status: string;
          title: string;
          updated_at: string | null;
        };
        Insert: {
          case_id?: string | null;
          completed_date?: string | null;
          created_at?: string | null;
          description?: string | null;
          due_date?: string | null;
          execution_type?: string | null;
          id?: string;
          is_auto_generated?: boolean | null;
          org_id: string;
          provider_id?: string | null;
          sop_content?: Json | null;
          sop_resolution_tier?: string | null;
          sop_template_id?: string | null;
          sop_version?: number | null;
          sort_order?: number | null;
          status?: string;
          title: string;
          updated_at?: string | null;
        };
        Update: {
          case_id?: string | null;
          completed_date?: string | null;
          created_at?: string | null;
          description?: string | null;
          due_date?: string | null;
          execution_type?: string | null;
          id?: string;
          is_auto_generated?: boolean | null;
          org_id?: string;
          provider_id?: string | null;
          sop_content?: Json | null;
          sop_resolution_tier?: string | null;
          sop_template_id?: string | null;
          sop_version?: number | null;
          sort_order?: number | null;
          status?: string;
          title?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "credential_cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_sop_version_fkey";
            columns: ["sop_template_id", "sop_version"];
            isOneToOne: false;
            referencedRelation: "sop_template_versions";
            referencedColumns: ["template_id", "version"];
          },
        ];
      };
      touches: {
        Row: {
          case_id: string;
          clears_follow_up: boolean;
          communication_event_id: string | null;
          coordinator_id: string | null;
          corrects_touch_id: string | null;
          created_at: string | null;
          entry_type: string;
          id: string;
          next_follow_up_date: string | null;
          notes: string | null;
          org_id: string;
          outcome: string | null;
          recipient_contact: string | null;
          recipient_name: string | null;
          source: string | null;
          task_id: string | null;
          touch_date: string;
          touch_type: string | null;
        };
        Insert: {
          case_id: string;
          clears_follow_up?: boolean;
          communication_event_id?: string | null;
          coordinator_id?: string | null;
          corrects_touch_id?: string | null;
          created_at?: string | null;
          entry_type?: string;
          id?: string;
          next_follow_up_date?: string | null;
          notes?: string | null;
          org_id: string;
          outcome?: string | null;
          recipient_contact?: string | null;
          recipient_name?: string | null;
          source?: string | null;
          task_id?: string | null;
          touch_date: string;
          touch_type?: string | null;
        };
        Update: {
          case_id?: string;
          clears_follow_up?: boolean;
          communication_event_id?: string | null;
          coordinator_id?: string | null;
          corrects_touch_id?: string | null;
          created_at?: string | null;
          entry_type?: string;
          id?: string;
          next_follow_up_date?: string | null;
          notes?: string | null;
          org_id?: string;
          outcome?: string | null;
          recipient_contact?: string | null;
          recipient_name?: string | null;
          source?: string | null;
          task_id?: string | null;
          touch_date?: string;
          touch_type?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "touches_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "credential_cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "touches_communication_event_id_fkey";
            columns: ["communication_event_id"];
            isOneToOne: false;
            referencedRelation: "communication_event";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "touches_coordinator_id_fkey";
            columns: ["coordinator_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "touches_corrects_touch_id_fkey";
            columns: ["corrects_touch_id"];
            isOneToOne: false;
            referencedRelation: "touches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "touches_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "touches_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      user_table_prefs: {
        Row: {
          id: string;
          page_key: string;
          prefs: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          id?: string;
          page_key: string;
          prefs?: Json;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          id?: string;
          page_key?: string;
          prefs?: Json;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      _apply_case_status_auto: {
        Args: {
          p_case_id: string;
          p_evidence_touch_id?: string;
          p_to_status: string;
        };
        Returns: undefined;
      };
      _ssn_decrypt: { Args: { p_ciphertext: string }; Returns: string };
      _ssn_digits: { Args: { p_raw: string }; Returns: string };
      _ssn_encrypt: { Args: { p_plaintext: string }; Returns: string };
      _ssn_vault_key: { Args: never; Returns: string };
      _ssn_vault_upsert: {
        Args: {
          p_actor: string;
          p_org_id: string;
          p_provider_id: string;
          p_ssn: string;
        };
        Returns: string;
      };
      advance_payer_pipeline: {
        Args: {
          p_case_id: string;
          p_effective_date?: string;
          p_expected_state?: string;
          p_group_provider_id?: string;
          p_individual_provider_id?: string;
          p_is_correction?: boolean;
          p_justification?: string;
          p_reason_code_id?: string;
          p_to_state: string;
        };
        Returns: Json;
      };
      archive_org_payer_assignment: {
        Args: { p_org_id: string; p_payer_id: string };
        Returns: Json;
      };
      assert_contact_valid: {
        Args: { p: Json; p_label: string };
        Returns: undefined;
      };
      author_global_sop: {
        Args: {
          p_archived?: boolean;
          p_group_id: string;
          p_id: string;
          p_name: string;
          p_payer_id: string;
          p_required_profile_attributes?: Json;
          p_state: string;
          p_task_definitions?: Json;
        };
        Returns: {
          archived: boolean;
          created_at: string | null;
          current_version: number;
          group_id: string | null;
          id: string;
          name: string;
          org_id: string | null;
          payer_id: string | null;
          required_profile_attributes: Json;
          specialty: string | null;
          state: string | null;
          task_definitions: Json;
          updated_at: string | null;
        };
      };
      check_rpc_throttle: {
        Args: {
          p_count_all?: boolean;
          p_max_attempts: number;
          p_rpc_name: string;
          p_window_minutes: number;
        };
        Returns: boolean;
      };
      claim_invites: { Args: never; Returns: number };
      commit_import_run: {
        Args: { p_plan: Json; p_run_id: string };
        Returns: Json;
      };
      create_capture_link: {
        Args: {
          p_org_id: string;
          p_party_id: string;
          p_recipient_email: string;
          p_recipient_name?: string;
        };
        Returns: Json;
      };
      create_case_with_tasks: {
        Args: { p_input: Json; p_tasks?: Json };
        Returns: Json;
      };
      create_organization:
        | { Args: { p_name: string }; Returns: string }
        | {
            Args: {
              p_name: string;
              p_owner_email: string;
              p_owner_name: string;
            };
            Returns: string;
          }
        | {
            Args: {
              p_customer: Json;
              p_name: string;
              p_owner_email: string;
              p_owner_name: string;
              p_sales_rep?: Json;
            };
            Returns: string;
          };
      create_report_share: {
        Args: {
          p_recipient_email: string;
          p_report_key: string;
          p_scope: string;
          p_scope_org_id: string;
        };
        Returns: Json;
      };
      create_ssn_intake_link: {
        Args: {
          p_provider_id: string;
          p_recipient_email: string;
          p_recipient_name?: string;
        };
        Returns: Json;
      };
      document_storage_org_id: { Args: { p_name: string }; Returns: string };
      get_sop_field_tokens: { Args: never; Returns: Json };
      insert_contact_party: {
        Args: { p: Json; p_uid: string };
        Returns: string;
      };
      list_global_payers: {
        Args: never;
        Returns: {
          aliases: string[] | null;
          avg_decision_days: number | null;
          created_at: string | null;
          delegation_note: string | null;
          id: string;
          is_active: boolean | null;
          last_synced_at: string | null;
          merged_into_id: string | null;
          name: string;
          org_id: string | null;
          payer_kind: string;
          payer_slug: string | null;
          resolution_id_expected: boolean | null;
          resolution_id_label: string | null;
          states: string[] | null;
          status: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "payers";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      mark_rpc_attempt_valid: {
        Args: { p_rpc_name: string };
        Returns: undefined;
      };
      publish_sop_template_version: {
        Args: {
          p_change_note?: string;
          p_expected_version: number;
          p_name: string;
          p_required_profile_attributes?: Json;
          p_task_definitions: Json;
          p_template_id: string;
        };
        Returns: Json;
      };
      release_ssn_for_fill: {
        Args: { p_case_id: string; p_org_id: string; p_provider_id: string };
        Returns: Json;
      };
      reveal_ssn: {
        Args: { p_justification: string; p_provider_id: string };
        Returns: Json;
      };
      review_payer_catalog_change: {
        Args: { p_accept: boolean; p_change_id: string };
        Returns: undefined;
      };
      revoke_report_share: { Args: { p_id: string }; Returns: undefined };
      set_case_status: {
        Args: {
          p_case_id: string;
          p_contract_executed_date?: string;
          p_effective_date?: string;
          p_evidence_touch_id?: string;
          p_expected_status?: string;
          p_group_provider_id?: string;
          p_individual_provider_id?: string;
          p_is_correction?: boolean;
          p_note?: string;
          p_reason_code_id?: string;
          p_to_status: string;
        };
        Returns: Json;
      };
      set_global_portal_flags: {
        Args: { p_id: string; p_proven?: boolean; p_verified?: boolean };
        Returns: {
          created_at: string;
          form_url: string | null;
          id: string;
          is_verified: boolean;
          last_verified_at: string | null;
          name: string;
          org_id: string | null;
          payer_id: string | null;
          portal_key: string;
          proven_at: string | null;
          updated_at: string;
          url_changed_at: string | null;
        };
      };
      set_primary_assignment: {
        Args: { p_assignment_id: string; p_provider_id: string };
        Returns: undefined;
      };
      stage_import_rows: {
        Args: { p_rows: Json; p_run_id: string };
        Returns: undefined;
      };
      store_ssn: {
        Args: { p_provider_id: string; p_ssn: string };
        Returns: Json;
      };
      submit_capture: {
        Args: { p_payload: Json; p_token: string };
        Returns: Json;
      };
      submit_inbound_lead: { Args: { p_payload: Json }; Returns: Json };
      submit_ssn_intake: {
        Args: { p_ssn: string; p_token: string };
        Returns: Json;
      };
      train_global_field_map: {
        Args: {
          p_field_label?: string;
          p_id: string;
          p_source: string;
          p_status: string;
          p_token?: string;
        };
        Returns: {
          confidence: number | null;
          created_at: string;
          field_label: string | null;
          field_type: string;
          form_section: string | null;
          hardcoded_value: string | null;
          id: string;
          map_type: string;
          notes: string | null;
          org_id: string | null;
          page_step: string | null;
          portal_key: string;
          selector: string;
          selector_fallbacks: Json | null;
          source: string;
          status: string;
          token: string | null;
          transform: string | null;
          updated_at: string;
          url_pattern: string | null;
        };
      };
      user_org_ids: { Args: never; Returns: string[] };
      user_role: { Args: { p_org: string }; Returns: string };
      upsert_global_portal: {
        Args: {
          p_form_url?: string;
          p_id: string;
          p_name: string;
          p_payer_id?: string;
          p_portal_key: string;
        };
        Returns: {
          created_at: string;
          form_url: string | null;
          id: string;
          is_verified: boolean;
          last_verified_at: string | null;
          name: string;
          org_id: string | null;
          payer_id: string | null;
          portal_key: string;
          proven_at: string | null;
          updated_at: string;
          url_changed_at: string | null;
        };
      };
      validate_capture_token: { Args: { p_token: string }; Returns: Json };
      validate_report_share: { Args: { p_token: string }; Returns: Json };
      validate_ssn_intake_token: { Args: { p_token: string }; Returns: Json };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
