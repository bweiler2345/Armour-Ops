// Hand-written to match supabase/migrations (Phases 1 to 5). Replace with
// the output of `supabase gen types typescript` once the Supabase CLI is set up.

type AppRole = "owner" | "employee";
type WorkflowStageKind = "employee_stage" | "owner_milestone" | "completion_work";
type WorkflowBlockKind = "ordered_list" | "reference_list" | "checklist";
type JobStatus =
  | "scheduled"
  | "available_to_claim"
  | "claimed"
  | "initial_prep_in_progress"
  | "waiting_for_base_coat_installation"
  | "base_coat_installed"
  | "top_coat_prep_in_progress"
  | "waiting_for_top_coat_installation"
  | "top_coat_installed"
  | "completion_work_in_progress"
  | "complete";
type JobActivityType =
  | "job_created"
  | "job_details_edited"
  | "made_available"
  | "returned_to_scheduled"
  | "claimed"
  | "employee_joined"
  | "employee_added"
  | "employee_removed"
  | "lead_changed"
  | "join_setting_changed"
  | "step_started"
  | "step_completed"
  | "status_changed"
  | "step_hold_cleared";
type BlockKind = "ordered_list" | "reference_list" | "checklist";
type AssignmentRole = "lead" | "member";
type AssignmentMethod = "claimed" | "joined" | "added_by_owner" | "lead_change";
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
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
      // Jobs (Phase 3). Written only through the owner functions below.
      jobs: {
        Row: {
          id: string;
          job_number: number;
          client_name: string;
          address: string;
          square_feet: number;
          flake_color: string;
          scheduled_date: string;
          general_notes: string;
          caulking_required: boolean;
          baseboard_required: boolean;
          allow_employees_to_join: boolean;
          status: JobStatus;
          workflow_template_id: string;
          workflow_key: string;
          workflow_version: number;
          workflow_content_sha256: string;
          made_available_at: string | null;
          last_activity_at: string;
          completed_at: string | null;
          completed_by: string | null;
          media_delete_after: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      job_stages: {
        Row: {
          id: string;
          job_id: string;
          source_stage_template_id: string | null;
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
      job_steps: {
        Row: {
          id: string;
          job_id: string;
          job_stage_id: string;
          source_step_template_id: string | null;
          is_custom: boolean;
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
      job_assignments: {
        Row: {
          id: string;
          job_id: string;
          employee_id: string;
          role: AssignmentRole;
          method: AssignmentMethod;
          assigned_at: string;
          assigned_by: string;
          ended_at: string | null;
          ended_by: string | null;
          end_reason: "removed_by_owner" | "role_changed" | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      job_step_blocks: {
        Row: {
          id: string;
          job_id: string;
          job_step_id: string;
          source_block_id: string | null;
          position: number;
          heading: string;
          kind: BlockKind;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      job_step_block_items: {
        Row: {
          id: string;
          job_id: string;
          job_block_id: string;
          block_kind: BlockKind;
          source_item_id: string | null;
          position: number;
          text: string;
          required: boolean;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      job_step_inputs: {
        Row: {
          id: string;
          job_id: string;
          job_step_id: string;
          source_input_id: string | null;
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
      job_step_proof_requirements: {
        Row: {
          id: string;
          job_id: string;
          job_step_id: string;
          source_requirement_id: string | null;
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
      step_attempts: {
        Row: {
          id: string;
          job_id: string;
          job_step_id: string;
          attempt_number: number;
          status: "draft" | "completed" | "superseded";
          started_by: string;
          started_at: string;
          employee_notes: string;
          notes_updated_by: string | null;
          notes_updated_at: string | null;
          completed_by: string | null;
          completed_at: string | null;
          confirmation_text_shown: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      step_check_responses: {
        Row: {
          attempt_id: string;
          job_step_id: string;
          job_block_item_id: string;
          item_text_shown: string;
          checked: boolean;
          updated_by: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      step_input_responses: {
        Row: {
          attempt_id: string;
          job_step_id: string;
          job_step_input_id: string;
          label_shown: string;
          value_text: string | null;
          value_number: number | null;
          value_choice: string | null;
          updated_by: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      job_activity: {
        Row: {
          id: number;
          job_id: string;
          actor_id: string | null;
          activity_type: JobActivityType;
          details: Json;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: {
      job_step_status: {
        Row: {
          job_id: string;
          job_step_id: string;
          state: "completed" | "in_progress" | "available" | "locked";
          attempt_id: string | null;
          attempt_status: "draft" | "completed" | "superseded" | null;
          started_by: string | null;
          started_at: string | null;
          completed_by: string | null;
          completed_by_name: string | null;
          completed_at: string | null;
          hold_held_by: string | null;
          hold_held_by_name: string | null;
          hold_expires_at: string | null;
        };
        Relationships: [];
      };
      job_team: {
        Row: {
          job_id: string;
          employee_id: string;
          role: AssignmentRole;
          method: AssignmentMethod;
          assigned_at: string;
          full_name: string;
          employee_active: boolean;
        };
        Relationships: [];
      };
      job_progress: {
        Row: {
          job_id: string;
          total_units: number;
          completed_units: number;
          current_stage_name: string | null;
          current_step_title: string | null;
        };
        Relationships: [];
      };
    };
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
      create_job: {
        Args: {
          p_client_name: string;
          p_address: string;
          p_square_feet: number;
          p_flake_color: string;
          p_scheduled_date: string;
          p_general_notes?: string;
          p_caulking_required?: boolean;
          p_baseboard_required?: boolean;
          p_allow_employees_to_join?: boolean;
        };
        Returns: string;
      };
      update_job_details: {
        Args: {
          p_job: string;
          p_client_name: string;
          p_address: string;
          p_square_feet: number;
          p_flake_color: string;
          p_scheduled_date: string;
          p_general_notes: string;
          p_caulking_required: boolean;
          p_baseboard_required: boolean;
          p_allow_employees_to_join: boolean;
        };
        Returns: undefined;
      };
      make_job_available: { Args: { p_job: string }; Returns: undefined };
      claim_job: { Args: { p_job: string }; Returns: undefined };
      acquire_step_edit: {
        Args: { p_step: string };
        Returns: { lease_id: string; expires_at: string }[];
      };
      renew_step_edit: { Args: { p_step: string; p_lease: string }; Returns: string };
      release_step_edit: { Args: { p_step: string; p_lease: string }; Returns: undefined };
      clear_step_edit: { Args: { p_step: string }; Returns: undefined };
      save_step_check: {
        Args: { p_step: string; p_lease: string; p_item: string; p_checked: boolean };
        Returns: undefined;
      };
      save_step_input: {
        Args: { p_step: string; p_lease: string; p_input: string; p_value: string };
        Returns: undefined;
      };
      save_step_notes: {
        Args: { p_step: string; p_lease: string; p_notes: string };
        Returns: undefined;
      };
      complete_step: {
        Args: { p_step: string; p_lease: string; p_confirmed: boolean };
        Returns: undefined;
      };
      join_job: { Args: { p_job: string }; Returns: undefined };
      add_team_member: { Args: { p_job: string; p_employee: string }; Returns: undefined };
      change_lead: { Args: { p_job: string; p_new_lead: string }; Returns: undefined };
      remove_team_member: {
        Args: { p_job: string; p_employee: string; p_new_lead?: string | null };
        Returns: undefined;
      };
      set_job_join_setting: { Args: { p_job: string; p_allow: boolean }; Returns: undefined };
      return_job_to_scheduled: { Args: { p_job: string }; Returns: undefined };
      admin_set_account_active: {
        Args: { p_target: string; p_actor: string; p_active: boolean };
        Returns: undefined;
      };
    };
    Enums: {
      app_role: AppRole;
      job_status: JobStatus;
      job_activity_type: JobActivityType;
      account_event_type: AccountEventType;
    };
    CompositeTypes: Record<never, never>;
  };
};
