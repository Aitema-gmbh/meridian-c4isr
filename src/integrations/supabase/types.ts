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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      agent_reports: {
        Row: {
          agent_name: string
          confidence: string | null
          created_at: string
          data: Json
          id: string
          items_count: number | null
          report_type: string
          summary: string | null
          threat_level: number | null
        }
        Insert: {
          agent_name: string
          confidence?: string | null
          created_at?: string
          data?: Json
          id?: string
          items_count?: number | null
          report_type?: string
          summary?: string | null
          threat_level?: number | null
        }
        Update: {
          agent_name?: string
          confidence?: string | null
          created_at?: string
          data?: Json
          id?: string
          items_count?: number | null
          report_type?: string
          summary?: string | null
          threat_level?: number | null
        }
        Relationships: []
      }
      intel_snapshots: {
        Row: {
          article_count: number | null
          average_sentiment: number | null
          created_at: string
          dominant_category: string | null
          flash_report: string | null
          id: string
          items: Json | null
          mil_track_count: number | null
          source_type: string | null
        }
        Insert: {
          article_count?: number | null
          average_sentiment?: number | null
          created_at?: string
          dominant_category?: string | null
          flash_report?: string | null
          id?: string
          items?: Json | null
          mil_track_count?: number | null
          source_type?: string | null
        }
        Update: {
          article_count?: number | null
          average_sentiment?: number | null
          created_at?: string
          dominant_category?: string | null
          flash_report?: string | null
          id?: string
          items?: Json | null
          mil_track_count?: number | null
          source_type?: string | null
        }
        Relationships: []
      }
      market_snapshots: {
        Row: {
          created_at: string
          id: string
          markets: Json | null
        }
        Insert: {
          created_at?: string
          id?: string
          markets?: Json | null
        }
        Update: {
          created_at?: string
          id?: string
          markets?: Json | null
        }
        Relationships: []
      }
      threat_assessments: {
        Row: {
          analysis_narrative: string | null
          created_at: string
          cyber_attack: number | null
          direct_confrontation: number | null
          hormuz_closure: number | null
          id: string
          market_divergences: Json | null
          proxy_escalation: number | null
          raw_indicators: Json | null
          tension_index: number | null
          watchcon: string | null
        }
        Insert: {
          analysis_narrative?: string | null
          created_at?: string
          cyber_attack?: number | null
          direct_confrontation?: number | null
          hormuz_closure?: number | null
          id?: string
          market_divergences?: Json | null
          proxy_escalation?: number | null
          raw_indicators?: Json | null
          tension_index?: number | null
          watchcon?: string | null
        }
        Update: {
          analysis_narrative?: string | null
          created_at?: string
          cyber_attack?: number | null
          direct_confrontation?: number | null
          hormuz_closure?: number | null
          id?: string
          market_divergences?: Json | null
          proxy_escalation?: number | null
          raw_indicators?: Json | null
          tension_index?: number | null
          watchcon?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
