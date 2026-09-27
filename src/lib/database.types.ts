// Hand-written to match supabase/migrations for Phase 1. Replace with the
// output of `supabase gen types typescript` once the Supabase CLI is set up.

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          role: Database["public"]["Enums"]["app_role"];
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string;
          role?: Database["public"]["Enums"]["app_role"];
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          role?: Database["public"]["Enums"]["app_role"];
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      is_active_user: { Args: Record<never, never>; Returns: boolean };
      is_owner: { Args: Record<never, never>; Returns: boolean };
    };
    Enums: {
      app_role: "owner" | "employee";
    };
    CompositeTypes: Record<never, never>;
  };
};
