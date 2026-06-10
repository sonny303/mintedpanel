export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      contracts: {
        Row: {
          created_at: string | null
          effective_date: string | null
          expiration_date: string | null
          group_id: string | null
          id: string
          notes: string | null
          org_id: string
          payer_id: string | null
          state: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          effective_date?: string | null
          expiration_date?: string | null
          group_id?: string | null
          id?: string
          notes?: string | null
          org_id: string
          payer_id?: string | null
          state: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          effective_date?: string | null
          expiration_date?: string | null
          group_id?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          payer_id?: string | null
          state?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contracts_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "provider_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_payer_id_fkey"
            columns: ["payer_id"]
            isOneToOne: false
            referencedRelation: "payers"
            referencedColumns: ["id"]
          },
        ]
      }
      facilities: {
        Row: {
          city: string | null
          created_at: string
          group_id: string | null
          id: string
          is_active: boolean
          name: string
          org_id: string
          state: string | null
          street: string | null
          zip: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          state?: string | null
          street?: string | null
          zip?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          state?: string | null
          street?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facilities_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "provider_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facilities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mso_routing_rules: {
        Row: {
          created_at: string | null
          id: string
          mso_id: string | null
          notes: string | null
          org_id: string
          payer_id: string | null
          route_type: string
          specialty: string
          state: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          mso_id?: string | null
          notes?: string | null
          org_id: string
          payer_id?: string | null
          route_type: string
          specialty?: string
          state: string
        }
        Update: {
          created_at?: string | null
          id?: string
          mso_id?: string | null
          notes?: string | null
          org_id?: string
          payer_id?: string | null
          route_type?: string
          specialty?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "mso_routing_rules_mso_id_fkey"
            columns: ["mso_id"]
            isOneToOne: false
            referencedRelation: "msos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mso_routing_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mso_routing_rules_payer_id_fkey"
            columns: ["payer_id"]
            isOneToOne: false
            referencedRelation: "payers"
            referencedColumns: ["id"]
          },
        ]
      }
      msos: {
        Row: {
          created_at: string | null
          id: string
          name: string
          org_id: string
          portal_url: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          org_id: string
          portal_url?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          org_id?: string
          portal_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "msos_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      payers: {
        Row: {
          avg_decision_days: number | null
          caqh_pull_deadline_days: number | null
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          org_id: string
          payer_billing_id: string | null
          portal_url: string | null
          prior_auth_vendor: string | null
          provider_type_path: string | null
          provisional_billing_allowed: boolean | null
          provisional_billing_notes: string | null
          retro_billing_allowed: boolean | null
          retro_billing_window_days: number | null
        }
        Insert: {
          avg_decision_days?: number | null
          caqh_pull_deadline_days?: number | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          org_id: string
          payer_billing_id?: string | null
          portal_url?: string | null
          prior_auth_vendor?: string | null
          provider_type_path?: string | null
          provisional_billing_allowed?: boolean | null
          provisional_billing_notes?: string | null
          retro_billing_allowed?: boolean | null
          retro_billing_window_days?: number | null
        }
        Update: {
          avg_decision_days?: number | null
          caqh_pull_deadline_days?: number | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          org_id?: string
          payer_billing_id?: string | null
          portal_url?: string | null
          prior_auth_vendor?: string | null
          provider_type_path?: string | null
          provisional_billing_allowed?: boolean | null
          provisional_billing_notes?: string | null
          retro_billing_allowed?: boolean | null
          retro_billing_window_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      provider_facility_assignments: {
        Row: {
          created_at: string | null
          facility_id: string | null
          id: string
          org_id: string
          provider_id: string | null
        }
        Insert: {
          created_at?: string | null
          facility_id?: string | null
          id?: string
          org_id: string
          provider_id?: string | null
        }
        Update: {
          created_at?: string | null
          facility_id?: string | null
          id?: string
          org_id?: string
          provider_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_facility_assignments_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_facility_assignments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_facility_assignments_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_groups: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          npi_type2: string | null
          org_id: string
          states: string[] | null
          tin: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          npi_type2?: string | null
          org_id: string
          states?: string[] | null
          tin?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          npi_type2?: string | null
          org_id?: string
          states?: string[] | null
          tin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_groups_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      providers: {
        Row: {
          caqh_id: string | null
          caqh_last_attested_date: string | null
          created_at: string | null
          credentials: string | null
          date_of_birth: string | null
          dea_number: string | null
          degree: string | null
          email: string | null
          first_name: string
          graduation_date: string | null
          group_id: string | null
          home_city: string | null
          home_state: string | null
          home_street: string | null
          home_zip: string | null
          id: string
          is_new_grad: boolean | null
          last_name: string
          malpractice_carrier: string | null
          malpractice_coverage_end: string | null
          malpractice_coverage_start: string | null
          malpractice_policy_number: string | null
          npi: string | null
          org_id: string
          phone: string | null
          school_name: string | null
          specialty: string | null
          ssn_last4: string | null
          start_date: string | null
          status: string
          taxonomy_code: string | null
          terminated_date: string | null
          updated_at: string | null
        }
        Insert: {
          caqh_id?: string | null
          caqh_last_attested_date?: string | null
          created_at?: string | null
          credentials?: string | null
          date_of_birth?: string | null
          dea_number?: string | null
          degree?: string | null
          email?: string | null
          first_name: string
          graduation_date?: string | null
          group_id?: string | null
          home_city?: string | null
          home_state?: string | null
          home_street?: string | null
          home_zip?: string | null
          id?: string
          is_new_grad?: boolean | null
          last_name: string
          malpractice_carrier?: string | null
          malpractice_coverage_end?: string | null
          malpractice_coverage_start?: string | null
          malpractice_policy_number?: string | null
          npi?: string | null
          org_id: string
          phone?: string | null
          school_name?: string | null
          specialty?: string | null
          ssn_last4?: string | null
          start_date?: string | null
          status?: string
          taxonomy_code?: string | null
          terminated_date?: string | null
          updated_at?: string | null
        }
        Update: {
          caqh_id?: string | null
          caqh_last_attested_date?: string | null
          created_at?: string | null
          credentials?: string | null
          date_of_birth?: string | null
          dea_number?: string | null
          degree?: string | null
          email?: string | null
          first_name?: string
          graduation_date?: string | null
          group_id?: string | null
          home_city?: string | null
          home_state?: string | null
          home_street?: string | null
          home_zip?: string | null
          id?: string
          is_new_grad?: boolean | null
          last_name?: string
          malpractice_carrier?: string | null
          malpractice_coverage_end?: string | null
          malpractice_coverage_start?: string | null
          malpractice_policy_number?: string | null
          npi?: string | null
          org_id?: string
          phone?: string | null
          school_name?: string | null
          specialty?: string | null
          ssn_last4?: string | null
          start_date?: string | null
          status?: string
          taxonomy_code?: string | null
          terminated_date?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "providers_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "provider_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "providers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      state_licenses: {
        Row: {
          created_at: string | null
          expiration_date: string | null
          id: string
          issue_date: string | null
          license_number: string | null
          license_type: string | null
          org_id: string
          provider_id: string | null
          state: string
          status: string | null
        }
        Insert: {
          created_at?: string | null
          expiration_date?: string | null
          id?: string
          issue_date?: string | null
          license_number?: string | null
          license_type?: string | null
          org_id: string
          provider_id?: string | null
          state: string
          status?: string | null
        }
        Update: {
          created_at?: string | null
          expiration_date?: string | null
          id?: string
          issue_date?: string | null
          license_number?: string | null
          license_type?: string | null
          org_id?: string
          provider_id?: string | null
          state?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "state_licenses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "state_licenses_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      user_org_ids: { Args: never; Returns: string[] }
      user_role: { Args: { p_org: string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
