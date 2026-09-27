// Hand-written to match supabase/migrations (Phases 1 and 1B). Replace with
// the output of `supabase gen types typescript` once the Supabase CLI is set up.

type AppRole = "owner" | "employee";
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
