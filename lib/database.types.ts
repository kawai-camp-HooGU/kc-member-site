// ============================================================
// Supabase Database 型（現行スキーマ = schema.sql + 全 migration を反映）
// `supabase gen types typescript` 相当のハンドメイド版。
// createClient<Database> に渡してクエリを型安全にするための土台。
// スキーマ変更時はこのファイルも更新すること。
// ============================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type RiskLevel = "normal" | "caution" | "high";
export type TaskStatus = "pending" | "in_progress" | "completed";
export type MemberRole = "管理者" | "リーダー" | "メンバー" | "外部";

export interface Database {
  public: {
    Tables: {
      projects: {
        Row: {
          id: number;
          name: string;
          abbreviation: string | null;
          start_date: string | null;
          due_date: string | null;
          close_date: string | null;
          notify_chat: string | null;
          checkpoint1_name: string | null;
          checkpoint1_date: string | null;
          checkpoint2_name: string | null;
          checkpoint2_date: string | null;
          checkpoint3_name: string | null;
          checkpoint3_date: string | null;
          progress: number;
          risk: RiskLevel;
          last_updated: string | null;
          tasks_due_this_week: number;
          tasks_delayed: number;
          tasks_completed: number;
          member_names: string[];
          notify_overrides: Json;
          is_deleted: boolean;
          created_at: string | null;
          created_by: string | null;
        };
        Insert: {
          id?: number;
          name: string;
          abbreviation?: string | null;
          start_date?: string | null;
          due_date?: string | null;
          close_date?: string | null;
          notify_chat?: string | null;
          checkpoint1_name?: string | null;
          checkpoint1_date?: string | null;
          checkpoint2_name?: string | null;
          checkpoint2_date?: string | null;
          checkpoint3_name?: string | null;
          checkpoint3_date?: string | null;
          progress?: number;
          risk?: RiskLevel;
          last_updated?: string | null;
          tasks_due_this_week?: number;
          tasks_delayed?: number;
          tasks_completed?: number;
          member_names?: string[];
          notify_overrides?: Json;
          is_deleted?: boolean;
          created_at?: string | null;
          created_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["projects"]["Insert"]>;
        Relationships: [];
      };
      anken: {
        Row: {
          id: number;
          project_id: number;
          name: string;
          abbreviation: string | null;
          leader: string | null;
          leader_id: number | null;
          progress: number;
          risk: RiskLevel;
          due_date: string | null;
          last_updated: string | null;
          tasks_due_this_week: number;
          tasks_delayed: number;
          tasks_completed: number;
          is_deleted: boolean;
          created_at: string | null;
        };
        Insert: {
          id?: number;
          project_id: number;
          name: string;
          abbreviation?: string | null;
          leader?: string | null;
          leader_id?: number | null;
          progress?: number;
          risk?: RiskLevel;
          due_date?: string | null;
          last_updated?: string | null;
          tasks_due_this_week?: number;
          tasks_delayed?: number;
          tasks_completed?: number;
          is_deleted?: boolean;
          created_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["anken"]["Insert"]>;
        Relationships: [];
      };
      tasks: {
        Row: {
          id: number;
          project_id: number;
          anken_id: number;
          name: string;
          assignees: string[];
          assignee_ids: number[];
          start_date: string | null;
          end_date: string | null;
          status: TaskStatus;
          risk: RiskLevel;
          progress_memo: string;
          special_notes: string;
          materials: string;
          importance: number | null;
          completed_at: string | null;
          updated_by: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: number;
          project_id: number;
          anken_id: number;
          name: string;
          assignees?: string[];
          assignee_ids?: number[];
          start_date?: string | null;
          end_date?: string | null;
          status?: TaskStatus;
          risk?: RiskLevel;
          progress_memo?: string;
          special_notes?: string;
          materials?: string;
          importance?: number | null;
          completed_at?: string | null;
          updated_by?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["tasks"]["Insert"]>;
        Relationships: [];
      };
      members: {
        Row: {
          id: number;
          name: string;
          role: MemberRole;
          email: string | null;
          company: string | null;
          chat_id: string | null;
          user_id: string | null;
          is_deleted: boolean;
          created_at: string | null;
        };
        Insert: {
          id?: number;
          name: string;
          role?: MemberRole;
          email?: string | null;
          company?: string | null;
          chat_id?: string | null;
          user_id?: string | null;
          is_deleted?: boolean;
          created_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["members"]["Insert"]>;
        Relationships: [];
      };
      templates: {
        Row: {
          id: number;
          name: string;
          is_deleted: boolean;
          created_at: string | null;
          created_by: string | null;
        };
        Insert: {
          id?: number;
          name: string;
          is_deleted?: boolean;
          created_at?: string | null;
          created_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["templates"]["Insert"]>;
        Relationships: [];
      };
      template_anken: {
        Row: {
          id: number;
          template_id: number;
          name: string;
          sort_order: number;
        };
        Insert: {
          id?: number;
          template_id: number;
          name: string;
          sort_order?: number;
        };
        Update: Partial<Database["public"]["Tables"]["template_anken"]["Insert"]>;
        Relationships: [];
      };
      template_tasks: {
        Row: {
          id: number;
          template_anken_id: number;
          name: string;
          start_offset: number | null;
          end_offset: number | null;
          importance: number | null;
          progress_memo: string | null;
          special_notes: string | null;
          materials: string | null;
          sort_order: number;
        };
        Insert: {
          id?: number;
          template_anken_id: number;
          name: string;
          start_offset?: number | null;
          end_offset?: number | null;
          importance?: number | null;
          progress_memo?: string | null;
          special_notes?: string | null;
          materials?: string | null;
          sort_order?: number;
        };
        Update: Partial<Database["public"]["Tables"]["template_tasks"]["Insert"]>;
        Relationships: [];
      };
      notify_settings: {
        Row: {
          category: string;
          enabled: boolean;
          header: string | null;
          lead: string | null;
          task_line: string | null;
          tail: string | null;
          updated_at: string | null;
        };
        Insert: {
          category: string;
          enabled?: boolean;
          header?: string | null;
          lead?: string | null;
          task_line?: string | null;
          tail?: string | null;
          updated_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["notify_settings"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      get_user_id_by_email: {
        Args: { email_input: string };
        Returns: string;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}

// 便利エイリアス
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
