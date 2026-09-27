// Hand-written to match supabase/migrations (Phases 1, 1B, and 2). Replace with
// the output of `supabase gen types typescript` once the Supabase CLI is set up.

type AppRole = "owner" | "employee";
type WorkflowStageKind = "employee_stage" | "owner_milestone" | "completion_work";
type WorkflowBlockKind = "ordered_list" | "reference_list" | "checklist";
type AccountEventType =
  | "account_created"
  | "temporary_password_issued"
  | "deactivated"
  | "reactivated"
  | "password_changed";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          role: AppRole;
          active: boolean;
          email: string | null;
          must_change_password: boolean;
          temp_password_issued_at: string | null;
          temp_password_issued_by: string | null;
          password_changed_at: string | null;
          deactivated_at: string | null;
          deactivated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string;
          role?: AppRole;
          active?: boolean;
          email?: string | null;
          must_change_password?: boolean;
          temp_password_issued_at?: string | null;
          temp_password_issued_by?: string | null;
          password_changed_at?: string | null;
          deactivated_at?: string | null;
          deactivated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      account_events: {
        Row: {
          id: number;
          target_id: string | null;
          actor_id: string | null;
          event_type: AccountEventType;
          created_at: string;
        };
        Insert: {
          target_id?: string | null;
          actor_id?: string | null;
          event_type: AccountEventType;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["account_events"]["Insert"]>;
        Relationships: [];
      };
      // Workflow templates (Phase 2). Written only by migrations, so the app
      // never inserts or updates them.
      workflow_templates: {
        Row: {
          id: string;
          key: string;
          name: string;
          version: number;
          status: "draft" | "active" | "retired";
          source: string;
          content_sha256: string;
          created_at: string;
          activated_at: string | null;
          retired_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      workflow_stage_templates: {
        Row: {
          id: string;
          template_id: string;
          position: number;
          key: string;
          name: string;
          kind: WorkflowStageKind;
          description: string | null;
          rules_heading: string | null;
          rules: string[];
          owner_action_label: string | null;
          waiting_status_label: string | null;
          completed_status_label: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      workflow_step_templates: {
        Row: {
          id: string;
          stage_id: string;
          stage_kind: WorkflowStageKind;
          position: number;
          key: string;
          title: string;
          kind: "standard" | "completion_item";
          note: string | null;
          goal: string | null;
          reference_image_key: string | null;
          proof_type: "none" | "picture" | "video";
          proof_text: string | null;
          confirmation_text: string | null;
          applies_when: "caulking_required" | "baseboard_required" | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      workflow_step_blocks: {
        Row: {
          id: string;
          step_id: string;
          step_kind: "standard" | "completion_item";
          position: number;
          heading: string;
          kind: WorkflowBlockKind;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      workflow_step_block_items: {
        Row: {
          id: string;
          block_id: string;
          block_kind: WorkflowBlockKind;
          position: number;
          text: string;
          required: boolean;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      workflow_step_inputs: {
        Row: {
          id: string;
          step_id: string;
          step_kind: "standard" | "completion_item";
          position: number;
          key: string;
          label: string;
          input_type: "text" | "number" | "single_select";
          required: boolean;
          unit: string | null;
          choices: string[] | null;
          whole_number: boolean;
          minimum: number | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      workflow_step_proof_requirements: {
        Row: {
          id: string;
          step_id: string;
          step_proof_type: "none" | "picture" | "video";
          position: number;
          label: string;
          media_type: "picture" | "video";
          min_count: number;
          allow_multiple: boolean;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      is_active_user: { Args: Record<never, never>; Returns: boolean };
      is_owner: { Args: Record<never, never>; Returns: boolean };
      record_own_password_change: {
        Args: Record<never, never>;
        Returns: undefined;
      };
      admin_record_account_created: {
        Args: { p_target: string; p_actor: string; p_full_name: string };
        Returns: undefined;
      };
      admin_record_temporary_password: {
        Args: { p_target: string; p_actor: string };
        Returns: undefined;
      };
      admin_set_account_active: {
        Args: { p_target: string; p_actor: string; p_active: boolean };
        Returns: undefined;
      };
    };
    Enums: {
      app_role: AppRole;
      account_event_type: AccountEventType;
    };
    CompositeTypes: Record<never, never>;
  };
};
