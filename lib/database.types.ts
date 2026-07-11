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
export type MemberRole = "管理者" | "オペレーター" | "メンバー" | "外部";

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
          kana: string | null;
          tel: string | null;
          prefecture: string | null;
          source: string | null;
          welcomed_at: string | null;
          first_login_at: string | null;
          last_login_at: string | null;
          login_count: number;
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
          kana?: string | null;
          tel?: string | null;
          prefecture?: string | null;
          source?: string | null;
          welcomed_at?: string | null;
          first_login_at?: string | null;
          last_login_at?: string | null;
          login_count?: number;
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
      app_settings: {
        Row: {
          id: number;
          chatwork_enabled: boolean;
          bulk_register_enabled: boolean;
          content_enabled: boolean;
          welcome_enabled: boolean;
          welcome_default: string | null;
          welcome_routes: Json;
          updated_at: string | null;
          /** 添削AI（③）が従う事務局の文体ガイド */
          ai_style_guide: string | null;
        };
        Insert: {
          id?: number;
          chatwork_enabled?: boolean;
          bulk_register_enabled?: boolean;
          content_enabled?: boolean;
          welcome_enabled?: boolean;
          welcome_default?: string | null;
          welcome_routes?: Json;
          updated_at?: string | null;
          ai_style_guide?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["app_settings"]["Insert"]>;
        Relationships: [];
      };
      role_permissions: {
        Row: { role: string; feature: string; enabled: boolean };
        Insert: { role: string; feature: string; enabled?: boolean };
        Update: Partial<Database["public"]["Tables"]["role_permissions"]["Insert"]>;
        Relationships: [];
      };
      // ── AI機能（migration_add_ai.sql）──────────────────
      ai_conversations: {
        Row: {
          id: number; member_id: number; title: string | null;
          escalated_conversation_id: number | null; created_at: string | null;
        };
        Insert: {
          id?: number; member_id: number; title?: string | null;
          escalated_conversation_id?: number | null; created_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["ai_conversations"]["Insert"]>;
        Relationships: [];
      };
      ai_messages: {
        Row: {
          id: number; ai_conversation_id: number; role: string; body: string;
          citations: Json; escalate: boolean | null; created_at: string | null;
        };
        Insert: {
          id?: number; ai_conversation_id: number; role: string; body?: string;
          citations?: Json; escalate?: boolean | null; created_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["ai_messages"]["Insert"]>;
        Relationships: [];
      };
      ai_knowledge: {
        Row: {
          id: number; title: string; body: string; tags: string[] | null;
          published: boolean; sort_order: number | null; created_at: string | null;
        };
        Insert: {
          id?: number; title?: string; body?: string; tags?: string[] | null;
          published?: boolean; sort_order?: number | null; created_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["ai_knowledge"]["Insert"]>;
        Relationships: [];
      };
      ai_logs: {
        Row: {
          id: number; feature: string; member_id: number | null; model: string;
          tokens_in: number | null; tokens_out: number | null; latency_ms: number | null;
          ok: boolean; error: string | null; created_at: string | null;
        };
        Insert: {
          id?: number; feature: string; member_id?: number | null; model?: string;
          tokens_in?: number | null; tokens_out?: number | null; latency_ms?: number | null;
          ok?: boolean; error?: string | null; created_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["ai_logs"]["Insert"]>;
        Relationships: [];
      };
      chat_conversations: {
        Row: {
          id: number; member_id: number; assigned_to: number | null;
          last_message_at: string | null; last_message_snip: string | null;
          staff_last_read_at: string | null; member_last_read_at: string | null; created_at: string | null;
        };
        Insert: {
          id?: number; member_id: number; assigned_to?: number | null;
          last_message_at?: string | null; last_message_snip?: string | null;
          staff_last_read_at?: string | null; member_last_read_at?: string | null; created_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["chat_conversations"]["Insert"]>;
        Relationships: [];
      };
      chat_messages: {
        Row: {
          id: number; conversation_id: number; sender_member_id: number | null;
          sender_side: string; body: string; created_at: string | null;
        };
        Insert: {
          id?: number; conversation_id: number; sender_member_id?: number | null;
          sender_side: string; body?: string; created_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["chat_messages"]["Insert"]>;
        Relationships: [];
      };
      chat_attachments: {
        Row: {
          id: number; message_id: number; file_name: string; storage_path: string;
          mime_type: string | null; size_bytes: number | null; created_at: string | null;
        };
        Insert: {
          id?: number; message_id: number; file_name: string; storage_path: string;
          mime_type?: string | null; size_bytes?: number | null; created_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["chat_attachments"]["Insert"]>;
        Relationships: [];
      };
      broadcasts: {
        Row: {
          id: number; title: string; status: string; target_mode: string;
          target_attr_ids: Json; target_source: string | null;
          channel_chat: boolean; channel_email: boolean;
          scheduled_at: string | null; message_body: string; recipient_count: number;
          sent_at: string | null; created_at: string | null; updated_at: string | null;
          ai_assisted: boolean | null;
        };
        Insert: {
          id?: number; title?: string; status?: string; target_mode?: string;
          target_attr_ids?: Json; target_source?: string | null;
          channel_chat?: boolean; channel_email?: boolean;
          scheduled_at?: string | null; message_body?: string; recipient_count?: number;
          sent_at?: string | null; created_at?: string | null; updated_at?: string | null;
          ai_assisted?: boolean | null;
        };
        Update: Partial<Database["public"]["Tables"]["broadcasts"]["Insert"]>;
        Relationships: [];
      };
      broadcast_links: {
        Row: { id: number; broadcast_id: number; url: string };
        Insert: { id?: number; broadcast_id: number; url: string };
        Update: Partial<Database["public"]["Tables"]["broadcast_links"]["Insert"]>;
        Relationships: [];
      };
      broadcast_clicks: {
        Row: { id: number; link_id: number; member_id: number | null; clicked_at: string | null };
        Insert: { id?: number; link_id: number; member_id?: number | null; clicked_at?: string | null };
        Update: Partial<Database["public"]["Tables"]["broadcast_clicks"]["Insert"]>;
        Relationships: [];
      };
      scenarios: {
        Row: {
          id: number; name: string; active: boolean; trigger_type: string;
          target_source: string | null; target_attr_ids: Json;
          created_at: string | null; updated_at: string | null;
        };
        Insert: {
          id?: number; name?: string; active?: boolean; trigger_type?: string;
          target_source?: string | null; target_attr_ids?: Json;
          created_at?: string | null; updated_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["scenarios"]["Insert"]>;
        Relationships: [];
      };
      scenario_steps: {
        Row: {
          id: number; scenario_id: number; sort_order: number; delay_unit: string; delay_value: number;
          time_of_day: string | null; channel_chat: boolean; channel_email: boolean; message_body: string;
        };
        Insert: {
          id?: number; scenario_id: number; sort_order?: number; delay_unit?: string; delay_value?: number;
          time_of_day?: string | null; channel_chat?: boolean; channel_email?: boolean; message_body?: string;
        };
        Update: Partial<Database["public"]["Tables"]["scenario_steps"]["Insert"]>;
        Relationships: [];
      };
      scenario_entries: {
        Row: {
          id: number; scenario_id: number; member_id: number; entered_at: string;
          next_step: number; status: string; last_sent_at: string | null;
        };
        Insert: {
          id?: number; scenario_id: number; member_id: number; entered_at?: string;
          next_step?: number; status?: string; last_sent_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["scenario_entries"]["Insert"]>;
        Relationships: [];
      };
      scenario_links: {
        Row: { id: number; scenario_id: number; step_id: number; url: string };
        Insert: { id?: number; scenario_id: number; step_id: number; url: string };
        Update: Partial<Database["public"]["Tables"]["scenario_links"]["Insert"]>;
        Relationships: [];
      };
      scenario_clicks: {
        Row: { id: number; link_id: number; member_id: number | null; clicked_at: string | null };
        Insert: { id?: number; link_id: number; member_id?: number | null; clicked_at?: string | null };
        Update: Partial<Database["public"]["Tables"]["scenario_clicks"]["Insert"]>;
        Relationships: [];
      };
      attribute_levels: {
        Row: { level: number; name: string };
        Insert: { level: number; name: string };
        Update: Partial<Database["public"]["Tables"]["attribute_levels"]["Insert"]>;
        Relationships: [];
      };
      attributes: {
        Row: {
          id: number;
          level: number;
          parent_id: number | null;
          name: string;
          color: string;
          bg: boolean;
          bold: boolean;
          title_color: boolean;
          visible: boolean;
          sort_order: number;
          is_deleted: boolean;
          created_at: string | null;
        };
        Insert: {
          id?: number;
          level: number;
          parent_id?: number | null;
          name?: string;
          color?: string;
          bg?: boolean;
          bold?: boolean;
          title_color?: boolean;
          visible?: boolean;
          sort_order?: number;
          is_deleted?: boolean;
          created_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["attributes"]["Insert"]>;
        Relationships: [];
      };
      member_attributes: {
        Row: { member_id: number; attribute_id: number };
        Insert: { member_id: number; attribute_id: number };
        Update: Partial<Database["public"]["Tables"]["member_attributes"]["Insert"]>;
        Relationships: [];
      };
      member_memos: {
        Row: {
          id: number;
          member_id: number;
          title: string;
          body: string;
          sort_order: number;
          updated_at: string | null;
        };
        Insert: {
          id?: number;
          member_id: number;
          title?: string;
          body?: string;
          sort_order?: number;
          updated_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["member_memos"]["Insert"]>;
        Relationships: [];
      };
      content_pages: {
        Row: {
          id: number; name: string; abbr: string; attr_mode: string;
          sort_order: number; is_deleted: boolean; created_at: string | null;
        };
        Insert: {
          id?: number; name?: string; abbr?: string; attr_mode?: string;
          sort_order?: number; is_deleted?: boolean; created_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["content_pages"]["Insert"]>;
        Relationships: [];
      };
      contents: {
        Row: {
          id: number; page_id: number; name: string; kind: string; url: string;
          none_mode: string; body_text: string; body_html: string; thumb_url: string;
          published: boolean; attr_mode: string; sort_order: number; is_deleted: boolean; created_at: string | null;
          ai_assisted: boolean | null;
        };
        Insert: {
          id?: number; page_id: number; name?: string; kind?: string; url?: string;
          none_mode?: string; body_text?: string; body_html?: string; thumb_url?: string;
          published?: boolean; attr_mode?: string; sort_order?: number; is_deleted?: boolean; created_at?: string | null;
          ai_assisted?: boolean | null;
        };
        Update: Partial<Database["public"]["Tables"]["contents"]["Insert"]>;
        Relationships: [];
      };
      content_page_attributes: {
        Row: { page_id: number; attribute_id: number };
        Insert: { page_id: number; attribute_id: number };
        Update: Partial<Database["public"]["Tables"]["content_page_attributes"]["Insert"]>;
        Relationships: [];
      };
      content_attributes: {
        Row: { content_id: number; attribute_id: number };
        Insert: { content_id: number; attribute_id: number };
        Update: Partial<Database["public"]["Tables"]["content_attributes"]["Insert"]>;
        Relationships: [];
      };
      news: {
        Row: {
          id: number; category: string; title: string; body_mode: string;
          body_text: string; body_html: string; important: boolean; published: boolean;
          published_at: string | null; attr_mode: string; sort_order: number; is_deleted: boolean; created_at: string | null;
        };
        Insert: {
          id?: number; category?: string; title?: string; body_mode?: string;
          body_text?: string; body_html?: string; important?: boolean; published?: boolean;
          published_at?: string | null; attr_mode?: string; sort_order?: number; is_deleted?: boolean; created_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["news"]["Insert"]>;
        Relationships: [];
      };
      news_attributes: {
        Row: { news_id: number; attribute_id: number };
        Insert: { news_id: number; attribute_id: number };
        Update: Partial<Database["public"]["Tables"]["news_attributes"]["Insert"]>;
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: number; member_id: number; endpoint: string; p256dh: string; auth: string;
          user_agent: string | null; created_at: string | null;
        };
        Insert: {
          id?: number; member_id: number; endpoint: string; p256dh: string; auth: string;
          user_agent?: string | null; created_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["push_subscriptions"]["Insert"]>;
        Relationships: [];
      };
      notification_settings: {
        Row: {
          member_id: number; enabled: boolean; chat_enabled: boolean; news_enabled: boolean; updated_at: string | null;
        };
        Insert: {
          member_id: number; enabled?: boolean; chat_enabled?: boolean; news_enabled?: boolean; updated_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["notification_settings"]["Insert"]>;
        Relationships: [];
      };
      content_views: {
        Row: {
          member_id: number; content_id: number;
          first_viewed_at: string; last_viewed_at: string; view_count: number;
        };
        Insert: {
          member_id: number; content_id: number;
          first_viewed_at?: string; last_viewed_at?: string; view_count?: number;
        };
        Update: Partial<Database["public"]["Tables"]["content_views"]["Insert"]>;
        Relationships: [];
      };
      // ── フォーム機能 ──────────────────────────────────
      forms: {
        Row: {
          id: number; name: string; folder: string | null; slug: string;
          title: string; description: string; status: string; visibility: string;
          deadline_at: string | null; deadline_message: string; answer_limit: number;
          confirm_dialog: boolean; confirm_text: string;
          thanks_url: string; thanks_text: string;
          design: Json; after_actions: Json;
          autofill_member: boolean; notify_enabled: boolean;
          created_at: string | null; updated_at: string | null;
        };
        Insert: {
          id?: number; name?: string; folder?: string | null; slug: string;
          title?: string; description?: string; status?: string; visibility?: string;
          deadline_at?: string | null; deadline_message?: string; answer_limit?: number;
          confirm_dialog?: boolean; confirm_text?: string;
          thanks_url?: string; thanks_text?: string;
          design?: Json; after_actions?: Json;
          autofill_member?: boolean; notify_enabled?: boolean;
          created_at?: string | null; updated_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["forms"]["Insert"]>;
        Relationships: [];
      };
      form_sections: {
        Row: { id: number; form_id: number; name: string; condition: Json | null; sort_order: number };
        Insert: { id?: number; form_id: number; name?: string; condition?: Json | null; sort_order?: number };
        Update: Partial<Database["public"]["Tables"]["form_sections"]["Insert"]>;
        Relationships: [];
      };
      form_fields: {
        Row: {
          id: number; section_id: number; type: string; label: string; description: string;
          placeholder: string; default_value: string; required: boolean;
          rule: string | null; min_len: number | null; max_len: number | null; max_select: number | null;
          save_to: string | null; options: Json; condition: Json | null; sort_order: number;
        };
        Insert: {
          id?: number; section_id: number; type?: string; label?: string; description?: string;
          placeholder?: string; default_value?: string; required?: boolean;
          rule?: string | null; min_len?: number | null; max_len?: number | null; max_select?: number | null;
          save_to?: string | null; options?: Json; condition?: Json | null; sort_order?: number;
        };
        Update: Partial<Database["public"]["Tables"]["form_fields"]["Insert"]>;
        Relationships: [];
      };
      form_submissions: {
        Row: {
          id: number; form_id: number; member_id: number | null;
          guest_name: string; guest_email: string; status: string;
          assignee_id: number | null; source: string; submitted_at: string;
        };
        Insert: {
          id?: number; form_id: number; member_id?: number | null;
          guest_name?: string; guest_email?: string; status?: string;
          assignee_id?: number | null; source?: string; submitted_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["form_submissions"]["Insert"]>;
        Relationships: [];
      };
      form_answers: {
        Row: {
          id: number; submission_id: number; field_id: number | null;
          label: string; value: string; value_list: Json | null; file_path: string | null;
        };
        Insert: {
          id?: number; submission_id: number; field_id?: number | null;
          label?: string; value?: string; value_list?: Json | null; file_path?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["form_answers"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: {
      // migration_phase1_rls.sql：members の機微カラムをマスクしたビュー
      // （本人・運営以外には email 等が null で返る）
      members_visible: {
        Row: {
          id: number;
          name: string;
          role: MemberRole;
          is_deleted: boolean;
          created_at: string | null;
          email: string | null;
          company: string | null;
          chat_id: string | null;
          user_id: string | null;
          kana: string | null;
          tel: string | null;
          prefecture: string | null;
          source: string | null;
          welcomed_at: string | null;
          first_login_at: string | null;
          last_login_at: string | null;
          login_count: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      get_user_id_by_email: {
        Args: { email_input: string };
        Returns: string;
      };
      touch_login: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      record_content_view: {
        Args: { p_content_id: number };
        Returns: undefined;
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
