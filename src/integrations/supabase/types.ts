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
      athlete_badges: {
        Row: {
          athlete_id: string
          awarded_at: string
          awarded_by: string | null
          badge_id: string
          created_at: string
          evidence: Json | null
          id: string
          updated_at: string
        }
        Insert: {
          athlete_id: string
          awarded_at?: string
          awarded_by?: string | null
          badge_id: string
          created_at?: string
          evidence?: Json | null
          id?: string
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          awarded_at?: string
          awarded_by?: string | null
          badge_id?: string
          created_at?: string
          evidence?: Json | null
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_badges_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athlete_badges_badge_id_fkey"
            columns: ["badge_id"]
            isOneToOne: false
            referencedRelation: "badges"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_kpi_pins: {
        Row: {
          athlete_id: string | null
          created_at: string
          id: string
          metric_key: string
          position: number
          updated_at: string
          user_id: string
        }
        Insert: {
          athlete_id?: string | null
          created_at?: string
          id?: string
          metric_key: string
          position?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          athlete_id?: string | null
          created_at?: string
          id?: string
          metric_key?: string
          position?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_kpi_pins_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_pin_hashes: {
        Row: {
          athlete_id: string
          created_at: string
          failed_attempts: number
          hash: string
          locked_until: string | null
          updated_at: string
        }
        Insert: {
          athlete_id: string
          created_at?: string
          failed_attempts?: number
          hash: string
          locked_until?: string | null
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          created_at?: string
          failed_attempts?: number
          hash?: string
          locked_until?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_pin_hashes_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: true
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_pins: {
        Row: {
          created_at: string
          failed_attempts: number
          locked_until: string | null
          pin_hash: string
          pin_salt: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          failed_attempts?: number
          locked_until?: string | null
          pin_hash: string
          pin_salt: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          failed_attempts?: number
          locked_until?: string | null
          pin_hash?: string
          pin_salt?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      athlete_teams: {
        Row: {
          athlete_id: string
          created_at: string
          joined_at: string
          left_at: string | null
          season: string | null
          team_id: string
          updated_at: string
        }
        Insert: {
          athlete_id: string
          created_at?: string
          joined_at?: string
          left_at?: string | null
          season?: string | null
          team_id: string
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          created_at?: string
          joined_at?: string
          left_at?: string | null
          season?: string | null
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_teams_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athlete_teams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      athletes: {
        Row: {
          archived_at: string | null
          athlete_email: string | null
          bodyweight: number | null
          class_period: string | null
          created_at: string
          date_of_birth: string | null
          first_name: string | null
          gender: string | null
          grade: number | null
          graduation_year: number | null
          height_in: number | null
          id: string
          invite_error: string | null
          invite_opened_at: string | null
          invite_sent_at: string | null
          invite_status: Database["public"]["Enums"]["athlete_invite_status"]
          join_token: string
          last_name: string | null
          name: string
          notes: string | null
          organization_id: string
          parent_email: string | null
          photo_url: string | null
          position: string | null
          preferred_name: string | null
          program_id: string | null
          program_start_date: string | null
          sport: string | null
          sport_fall: string | null
          sport_spring: string | null
          sport_winter: string | null
          status: string
          student_id: string | null
          team_id: string | null
          training_group: string | null
          user_id: string | null
        }
        Insert: {
          archived_at?: string | null
          athlete_email?: string | null
          bodyweight?: number | null
          class_period?: string | null
          created_at?: string
          date_of_birth?: string | null
          first_name?: string | null
          gender?: string | null
          grade?: number | null
          graduation_year?: number | null
          height_in?: number | null
          id?: string
          invite_error?: string | null
          invite_opened_at?: string | null
          invite_sent_at?: string | null
          invite_status?: Database["public"]["Enums"]["athlete_invite_status"]
          join_token?: string
          last_name?: string | null
          name: string
          notes?: string | null
          organization_id?: string
          parent_email?: string | null
          photo_url?: string | null
          position?: string | null
          preferred_name?: string | null
          program_id?: string | null
          program_start_date?: string | null
          sport?: string | null
          sport_fall?: string | null
          sport_spring?: string | null
          sport_winter?: string | null
          status?: string
          student_id?: string | null
          team_id?: string | null
          training_group?: string | null
          user_id?: string | null
        }
        Update: {
          archived_at?: string | null
          athlete_email?: string | null
          bodyweight?: number | null
          class_period?: string | null
          created_at?: string
          date_of_birth?: string | null
          first_name?: string | null
          gender?: string | null
          grade?: number | null
          graduation_year?: number | null
          height_in?: number | null
          id?: string
          invite_error?: string | null
          invite_opened_at?: string | null
          invite_sent_at?: string | null
          invite_status?: Database["public"]["Enums"]["athlete_invite_status"]
          join_token?: string
          last_name?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
          parent_email?: string | null
          photo_url?: string | null
          position?: string | null
          preferred_name?: string | null
          program_id?: string | null
          program_start_date?: string | null
          sport?: string | null
          sport_fall?: string | null
          sport_spring?: string | null
          sport_winter?: string | null
          status?: string
          student_id?: string | null
          team_id?: string | null
          training_group?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "athletes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athletes_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athletes_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance: {
        Row: {
          athlete_id: string
          created_at: string
          id: string
          notes: string | null
          organization_id: string
          present: boolean
          session_date: string
          status: string
          updated_at: string
        }
        Insert: {
          athlete_id: string
          created_at?: string
          id?: string
          notes?: string | null
          organization_id?: string
          present?: boolean
          session_date?: string
          status?: string
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          organization_id?: string
          present?: boolean
          session_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bodyweight_logs: {
        Row: {
          athlete_id: string
          created_at: string
          id: string
          log_date: string
          organization_id: string
          source: string
          value: number
        }
        Insert: {
          athlete_id: string
          created_at?: string
          id?: string
          log_date?: string
          organization_id: string
          source?: string
          value: number
        }
        Update: {
          athlete_id?: string
          created_at?: string
          id?: string
          log_date?: string
          organization_id?: string
          source?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "bodyweight_logs_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bodyweight_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      badges: {
        Row: {
          archived_at: string | null
          color: string
          created_at: string
          created_by: string | null
          criteria: Json
          description: string | null
          icon: string
          id: string
          name: string
          organization_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          color?: string
          created_at?: string
          created_by?: string | null
          criteria?: Json
          description?: string | null
          icon?: string
          id?: string
          name: string
          organization_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          color?: string
          created_at?: string
          created_by?: string | null
          criteria?: Json
          description?: string | null
          icon?: string
          id?: string
          name?: string
          organization_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "badges_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_metrics: {
        Row: {
          archived_at: string | null
          created_at: string
          denominator_test: string | null
          description: string | null
          exercise_name: string | null
          formula: string | null
          id: string
          kind: string
          lower_is_better: boolean
          measurement: string
          name: string
          numerator_test: string | null
          organization_id: string
          since_days: number | null
          test_type: string | null
          unit: string | null
          updated_at: string
          variables: Json
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          denominator_test?: string | null
          description?: string | null
          exercise_name?: string | null
          formula?: string | null
          id?: string
          kind?: string
          lower_is_better?: boolean
          measurement?: string
          name: string
          numerator_test?: string | null
          organization_id?: string
          since_days?: number | null
          test_type?: string | null
          unit?: string | null
          updated_at?: string
          variables?: Json
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          denominator_test?: string | null
          description?: string | null
          exercise_name?: string | null
          formula?: string | null
          id?: string
          kind?: string
          lower_is_better?: boolean
          measurement?: string
          name?: string
          numerator_test?: string | null
          organization_id?: string
          since_days?: number | null
          test_type?: string | null
          unit?: string | null
          updated_at?: string
          variables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "custom_metrics_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      exercise_relationships: {
        Row: {
          created_at: string
          from_exercise_id: string
          id: string
          notes: string | null
          ratio: number
          relationship_type: string
          to_exercise_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          from_exercise_id: string
          id?: string
          notes?: string | null
          ratio: number
          relationship_type?: string
          to_exercise_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          from_exercise_id?: string
          id?: string
          notes?: string | null
          ratio?: number
          relationship_type?: string
          to_exercise_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercise_relationships_from_exercise_id_fkey"
            columns: ["from_exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_relationships_to_exercise_id_fkey"
            columns: ["to_exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      exercises: {
        Row: {
          archived_at: string | null
          category: string | null
          created_at: string
          equipment: string | null
          id: string
          image_url: string | null
          is_custom: boolean
          is_metric: boolean
          measurement_type: string
          name: string
          organization_id: string
          primary_muscles: string[] | null
          updated_at: string
          video_url: string | null
        }
        Insert: {
          archived_at?: string | null
          category?: string | null
          created_at?: string
          equipment?: string | null
          id?: string
          image_url?: string | null
          is_custom?: boolean
          is_metric?: boolean
          measurement_type?: string
          name: string
          organization_id?: string
          primary_muscles?: string[] | null
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          archived_at?: string | null
          category?: string | null
          created_at?: string
          equipment?: string | null
          id?: string
          image_url?: string | null
          is_custom?: boolean
          is_metric?: boolean
          measurement_type?: string
          name?: string
          organization_id?: string
          primary_muscles?: string[] | null
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exercises_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gps_sessions: {
        Row: {
          acceleration_count: number | null
          athlete_id: string | null
          created_at: string
          created_by: string | null
          deceleration_count: number | null
          id: string
          organization_id: string
          peak_acceleration: number | null
          player_load: number | null
          player_name: string
          session_date: string
          source_file: string | null
          sprint_count: number | null
          sprint_yards: number | null
          top_speed: number | null
          updated_at: string
        }
        Insert: {
          acceleration_count?: number | null
          athlete_id?: string | null
          created_at?: string
          created_by?: string | null
          deceleration_count?: number | null
          id?: string
          organization_id: string
          peak_acceleration?: number | null
          player_load?: number | null
          player_name: string
          session_date: string
          source_file?: string | null
          sprint_count?: number | null
          sprint_yards?: number | null
          top_speed?: number | null
          updated_at?: string
        }
        Update: {
          acceleration_count?: number | null
          athlete_id?: string | null
          created_at?: string
          created_by?: string | null
          deceleration_count?: number | null
          id?: string
          organization_id?: string
          peak_acceleration?: number | null
          player_load?: number | null
          player_name?: string
          session_date?: string
          source_file?: string | null
          sprint_count?: number | null
          sprint_yards?: number | null
          top_speed?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gps_sessions_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gps_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leaderboards: {
        Row: {
          archived_at: string | null
          created_at: string
          date_from: string | null
          date_to: string | null
          gender: string | null
          grade: number | null
          id: string
          metric_id: string
          name: string
          organization_id: string
          position: string | null
          row_limit: number
          since_days: number | null
          sport: string | null
          team_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          date_from?: string | null
          date_to?: string | null
          gender?: string | null
          grade?: number | null
          id?: string
          metric_id: string
          name: string
          organization_id?: string
          position?: string | null
          row_limit?: number
          since_days?: number | null
          sport?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          date_from?: string | null
          date_to?: string | null
          gender?: string | null
          grade?: number | null
          id?: string
          metric_id?: string
          name?: string
          organization_id?: string
          position?: string | null
          row_limit?: number
          since_days?: number | null
          sport?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leaderboards_metric_id_fkey"
            columns: ["metric_id"]
            isOneToOne: false
            referencedRelation: "custom_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leaderboards_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leaderboards_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      lift_sets: {
        Row: {
          created_at: string
          id: string
          lift_id: string
          load: number | null
          notes: string | null
          position: number
          reps: number | null
          updated_at: string
          velocity: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          lift_id: string
          load?: number | null
          notes?: string | null
          position?: number
          reps?: number | null
          updated_at?: string
          velocity?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          lift_id?: string
          load?: number | null
          notes?: string | null
          position?: number
          reps?: number | null
          updated_at?: string
          velocity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lift_sets_lift_id_fkey"
            columns: ["lift_id"]
            isOneToOne: false
            referencedRelation: "lifts"
            referencedColumns: ["id"]
          },
        ]
      }
      lifts: {
        Row: {
          athlete_id: string
          created_at: string
          distance_in: number | null
          exercise: string
          id: string
          lift_date: string
          load: number | null
          notes: string | null
          organization_id: string
          reps: number | null
          sets: number | null
          source_rack_log_id: string | null
          time_seconds: number | null
          updated_at: string
          velocity: number | null
        }
        Insert: {
          athlete_id: string
          created_at?: string
          distance_in?: number | null
          exercise: string
          id?: string
          lift_date?: string
          load?: number | null
          notes?: string | null
          organization_id?: string
          reps?: number | null
          sets?: number | null
          source_rack_log_id?: string | null
          time_seconds?: number | null
          updated_at?: string
          velocity?: number | null
        }
        Update: {
          athlete_id?: string
          created_at?: string
          distance_in?: number | null
          exercise?: string
          id?: string
          lift_date?: string
          load?: number | null
          notes?: string | null
          organization_id?: string
          reps?: number | null
          sets?: number | null
          source_rack_log_id?: string | null
          time_seconds?: number | null
          updated_at?: string
          velocity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lifts_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lifts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          organization_id: string
          role: Database["public"]["Enums"]["org_member_role"]
          status: string
          token: string
          updated_at: string
          used_at: string | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id: string
          role?: Database["public"]["Enums"]["org_member_role"]
          status?: string
          token?: string
          updated_at?: string
          used_at?: string | null
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["org_member_role"]
          status?: string
          token?: string
          updated_at?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["org_member_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["org_member_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["org_member_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          brand_primary: string | null
          brand_secondary: string | null
          created_at: string
          created_by: string | null
          default_1rm_formula: string
          default_theme: string | null
          email_sender_name: string | null
          frozen_at: string | null
          id: string
          logo_url: string | null
          name: string
          report_header: string | null
          slug: string | null
          updated_at: string
        }
        Insert: {
          brand_primary?: string | null
          brand_secondary?: string | null
          created_at?: string
          created_by?: string | null
          default_1rm_formula?: string
          default_theme?: string | null
          email_sender_name?: string | null
          frozen_at?: string | null
          id?: string
          logo_url?: string | null
          name: string
          report_header?: string | null
          slug?: string | null
          updated_at?: string
        }
        Update: {
          brand_primary?: string | null
          brand_secondary?: string | null
          created_at?: string
          created_by?: string | null
          default_1rm_formula?: string
          default_theme?: string | null
          email_sender_name?: string | null
          frozen_at?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          report_header?: string | null
          slug?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      program_cycles: {
        Row: {
          created_at: string
          focus: string | null
          id: string
          intensity: string | null
          name: string
          organization_id: string
          phase_id: string
          position: number
          program_id: string
          start_date: string | null
          updated_at: string
          volume: string | null
          weeks: number
        }
        Insert: {
          created_at?: string
          focus?: string | null
          id?: string
          intensity?: string | null
          name: string
          organization_id: string
          phase_id: string
          position?: number
          program_id: string
          start_date?: string | null
          updated_at?: string
          volume?: string | null
          weeks?: number
        }
        Update: {
          created_at?: string
          focus?: string | null
          id?: string
          intensity?: string | null
          name?: string
          organization_id?: string
          phase_id?: string
          position?: number
          program_id?: string
          start_date?: string | null
          updated_at?: string
          volume?: string | null
          weeks?: number
        }
        Relationships: [
          {
            foreignKeyName: "program_cycles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_cycles_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "program_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_cycles_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      program_phases: {
        Row: {
          color: string | null
          created_at: string
          end_date: string | null
          goal: string | null
          id: string
          name: string
          organization_id: string
          position: number
          program_id: string
          start_date: string | null
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          end_date?: string | null
          goal?: string | null
          id?: string
          name: string
          organization_id: string
          position?: number
          program_id: string
          start_date?: string | null
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          end_date?: string | null
          goal?: string | null
          id?: string
          name?: string
          organization_id?: string
          position?: number
          program_id?: string
          start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_phases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_phases_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      program_sessions: {
        Row: {
          created_at: string
          cycle_id: string
          day: number
          id: string
          name: string
          notes: string | null
          organization_id: string
          phase_id: string
          position: number
          program_id: string
          scheduled_date: string | null
          updated_at: string
          week: number
          workout_id: string | null
        }
        Insert: {
          created_at?: string
          cycle_id: string
          day?: number
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          phase_id: string
          position?: number
          program_id: string
          scheduled_date?: string | null
          updated_at?: string
          week?: number
          workout_id?: string | null
        }
        Update: {
          created_at?: string
          cycle_id?: string
          day?: number
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          phase_id?: string
          position?: number
          program_id?: string
          scheduled_date?: string | null
          updated_at?: string
          week?: number
          workout_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "program_sessions_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "program_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_sessions_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "program_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_sessions_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_sessions_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      program_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          label: string
          notes: string | null
          organization_id: string
          program_id: string
          snapshot: Json
          updated_at: string
          version_number: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          notes?: string | null
          organization_id: string
          program_id: string
          snapshot: Json
          updated_at?: string
          version_number?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          notes?: string | null
          organization_id?: string
          program_id?: string
          snapshot?: Json
          updated_at?: string
          version_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "program_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_versions_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      program_workouts: {
        Row: {
          created_at: string
          day: number
          id: string
          position: number
          program_id: string
          updated_at: string
          week: number
          workout_id: string
        }
        Insert: {
          created_at?: string
          day?: number
          id?: string
          position?: number
          program_id: string
          updated_at?: string
          week?: number
          workout_id: string
        }
        Update: {
          created_at?: string
          day?: number
          id?: string
          position?: number
          program_id?: string
          updated_at?: string
          week?: number
          workout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_workouts_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_workouts_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      programs: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          organization_id: string
          team_id: string | null
          updated_at: string
          weeks: number | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          organization_id?: string
          team_id?: string | null
          updated_at?: string
          weeks?: number | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          team_id?: string | null
          updated_at?: string
          weeks?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "programs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programs_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      rack_athlete_exercise_overrides: {
        Row: {
          athlete_id: string
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          rack_session_id: string
          reason: string | null
          substitute_exercise_id: string | null
          substitute_exercise_name: string
          updated_at: string
          workout_exercise_id: string
        }
        Insert: {
          athlete_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          rack_session_id: string
          reason?: string | null
          substitute_exercise_id?: string | null
          substitute_exercise_name: string
          updated_at?: string
          workout_exercise_id: string
        }
        Update: {
          athlete_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          rack_session_id?: string
          reason?: string | null
          substitute_exercise_id?: string | null
          substitute_exercise_name?: string
          updated_at?: string
          workout_exercise_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rack_athlete_exercise_overrides_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rack_athlete_exercise_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rack_athlete_exercise_overrides_rack_session_id_fkey"
            columns: ["rack_session_id"]
            isOneToOne: false
            referencedRelation: "rack_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rack_athlete_exercise_overrides_substitute_exercise_id_fkey"
            columns: ["substitute_exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rack_athlete_exercise_overrides_workout_exercise_id_fkey"
            columns: ["workout_exercise_id"]
            isOneToOne: false
            referencedRelation: "workout_exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      rack_session_athletes: {
        Row: {
          active_workout_id: string | null
          assigned_workout_id: string | null
          athlete_id: string
          created_at: string
          id: string
          last_seen_at: string | null
          notes: string | null
          opened_at: string | null
          override_reason: string
          quadrant: number
          rack_session_id: string
          source_team_id: string | null
          updated_at: string
        }
        Insert: {
          active_workout_id?: string | null
          assigned_workout_id?: string | null
          athlete_id: string
          created_at?: string
          id?: string
          last_seen_at?: string | null
          notes?: string | null
          opened_at?: string | null
          override_reason?: string
          quadrant: number
          rack_session_id: string
          source_team_id?: string | null
          updated_at?: string
        }
        Update: {
          active_workout_id?: string | null
          assigned_workout_id?: string | null
          athlete_id?: string
          created_at?: string
          id?: string
          last_seen_at?: string | null
          notes?: string | null
          opened_at?: string | null
          override_reason?: string
          quadrant?: number
          rack_session_id?: string
          source_team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rack_session_athletes_active_workout_id_fkey"
            columns: ["active_workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rack_session_athletes_assigned_workout_id_fkey"
            columns: ["assigned_workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rack_session_athletes_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rack_session_athletes_rack_session_id_fkey"
            columns: ["rack_session_id"]
            isOneToOne: false
            referencedRelation: "rack_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rack_session_athletes_source_team_id_fkey"
            columns: ["source_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      rack_sessions: {
        Row: {
          active_athlete_id: string | null
          athlete_ids: string[]
          created_at: string
          id: string
          organization_id: string
          rack_number: number
          session_date: string
          status: string
          team_id: string
          updated_at: string
          workout_id: string | null
        }
        Insert: {
          active_athlete_id?: string | null
          athlete_ids?: string[]
          created_at?: string
          id?: string
          organization_id?: string
          rack_number: number
          session_date?: string
          status?: string
          team_id: string
          updated_at?: string
          workout_id?: string | null
        }
        Update: {
          active_athlete_id?: string | null
          athlete_ids?: string[]
          created_at?: string
          id?: string
          organization_id?: string
          rack_number?: number
          session_date?: string
          status?: string
          team_id?: string
          updated_at?: string
          workout_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rack_sessions_active_athlete_id_fkey"
            columns: ["active_athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rack_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rack_sessions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rack_sessions_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      rack_set_logs: {
        Row: {
          active_workout_id: string | null
          approval_status: string
          athlete_id: string
          avg_velocity: number | null
          completed_at: string
          created_at: string
          distance_in: number | null
          estimated_1rm: number | null
          id: string
          load: number | null
          notes: string | null
          override_status: string
          peak_velocity: number | null
          prescribed_load: number | null
          prescribed_reps: number | null
          quadrant: number | null
          rack_session_id: string
          reps: number | null
          rest_seconds: number | null
          rest_started_at: string | null
          review_note: string | null
          review_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          rir: number | null
          rpe: number | null
          set_position: number
          status: string
          time_seconds: number | null
          updated_at: string
          validation_status: string
          workout_exercise_id: string
        }
        Insert: {
          active_workout_id?: string | null
          approval_status?: string
          athlete_id: string
          avg_velocity?: number | null
          completed_at?: string
          created_at?: string
          distance_in?: number | null
          estimated_1rm?: number | null
          id?: string
          load?: number | null
          notes?: string | null
          override_status?: string
          peak_velocity?: number | null
          prescribed_load?: number | null
          prescribed_reps?: number | null
          quadrant?: number | null
          rack_session_id: string
          reps?: number | null
          rest_seconds?: number | null
          rest_started_at?: string | null
          review_note?: string | null
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rir?: number | null
          rpe?: number | null
          set_position: number
          status?: string
          time_seconds?: number | null
          updated_at?: string
          validation_status?: string
          workout_exercise_id: string
        }
        Update: {
          active_workout_id?: string | null
          approval_status?: string
          athlete_id?: string
          avg_velocity?: number | null
          completed_at?: string
          created_at?: string
          distance_in?: number | null
          estimated_1rm?: number | null
          id?: string
          load?: number | null
          notes?: string | null
          override_status?: string
          peak_velocity?: number | null
          prescribed_load?: number | null
          prescribed_reps?: number | null
          quadrant?: number | null
          rack_session_id?: string
          reps?: number | null
          rest_seconds?: number | null
          rest_started_at?: string | null
          review_note?: string | null
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rir?: number | null
          rpe?: number | null
          set_position?: number
          status?: string
          time_seconds?: number | null
          updated_at?: string
          validation_status?: string
          workout_exercise_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rack_set_logs_active_workout_id_fkey"
            columns: ["active_workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rack_set_logs_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rack_set_logs_rack_session_id_fkey"
            columns: ["rack_session_id"]
            isOneToOne: false
            referencedRelation: "rack_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rack_set_logs_workout_exercise_id_fkey"
            columns: ["workout_exercise_id"]
            isOneToOne: false
            referencedRelation: "workout_exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      registrations: {
        Row: {
          athlete_email: string | null
          created_at: string
          date_of_birth: string | null
          first_name: string
          gender: string | null
          grade: number | null
          graduation_year: number | null
          height_in: number | null
          id: string
          last_name: string
          organization_id: string
          parent_email: string | null
          position: string | null
          preferred_name: string | null
          reviewed_at: string | null
          sport: string | null
          sport_fall: string | null
          sport_spring: string | null
          sport_winter: string | null
          status: string
          student_id: string | null
          team_id: string
          updated_at: string
          weight_lb: number | null
        }
        Insert: {
          athlete_email?: string | null
          created_at?: string
          date_of_birth?: string | null
          first_name: string
          gender?: string | null
          grade?: number | null
          graduation_year?: number | null
          height_in?: number | null
          id?: string
          last_name: string
          organization_id?: string
          parent_email?: string | null
          position?: string | null
          preferred_name?: string | null
          reviewed_at?: string | null
          sport?: string | null
          sport_fall?: string | null
          sport_spring?: string | null
          sport_winter?: string | null
          status?: string
          student_id?: string | null
          team_id: string
          updated_at?: string
          weight_lb?: number | null
        }
        Update: {
          athlete_email?: string | null
          created_at?: string
          date_of_birth?: string | null
          first_name?: string
          gender?: string | null
          grade?: number | null
          graduation_year?: number | null
          height_in?: number | null
          id?: string
          last_name?: string
          organization_id?: string
          parent_email?: string | null
          position?: string | null
          preferred_name?: string | null
          reviewed_at?: string | null
          sport?: string | null
          sport_fall?: string | null
          sport_spring?: string | null
          sport_winter?: string | null
          status?: string
          student_id?: string | null
          team_id?: string
          updated_at?: string
          weight_lb?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "registrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      rep_maxes: {
        Row: {
          athlete_id: string
          created_at: string
          exercise_id: string | null
          exercise_name: string
          id: string
          load: number
          notes: string | null
          organization_id: string
          reps: number
          tested_at: string
          updated_at: string
        }
        Insert: {
          athlete_id: string
          created_at?: string
          exercise_id?: string | null
          exercise_name: string
          id?: string
          load: number
          notes?: string | null
          organization_id?: string
          reps: number
          tested_at?: string
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          created_at?: string
          exercise_id?: string | null
          exercise_name?: string
          id?: string
          load?: number
          notes?: string | null
          organization_id?: string
          reps?: number
          tested_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rep_maxes_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rep_maxes_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rep_maxes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          created_at: string
          id: string
          permission: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          permission: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          permission?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: []
      }
      spider_graph_metrics: {
        Row: {
          created_at: string
          display_label: string | null
          hide_if_missing: boolean
          id: string
          metric_key: string
          position: number
          template_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_label?: string | null
          hide_if_missing?: boolean
          id?: string
          metric_key: string
          position?: number
          template_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_label?: string | null
          hide_if_missing?: boolean
          id?: string
          metric_key?: string
          position?: number
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "spider_graph_metrics_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "spider_graph_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      spider_graph_templates: {
        Row: {
          archived_at: string | null
          assignment: Json
          comparison_group: string
          created_at: string
          created_by: string | null
          date_rule: string
          id: string
          is_default: boolean
          kpi_config: Json
          name: string
          normalization_method: string
          options: Json
          organization_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assignment?: Json
          comparison_group?: string
          created_at?: string
          created_by?: string | null
          date_rule?: string
          id?: string
          is_default?: boolean
          kpi_config?: Json
          name: string
          normalization_method?: string
          options?: Json
          organization_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assignment?: Json
          comparison_group?: string
          created_at?: string
          created_by?: string | null
          date_rule?: string
          id?: string
          is_default?: boolean
          kpi_config?: Json
          name?: string
          normalization_method?: string
          options?: Json
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "spider_graph_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      teams: {
        Row: {
          archived_at: string | null
          color: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          organization_id: string
          qr_token: string
          rack_count: number
          season: string | null
          sport: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          color?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          organization_id?: string
          qr_token?: string
          rack_count?: number
          season?: string | null
          sport?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          qr_token?: string
          rack_count?: number
          season?: string | null
          sport?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      test_assignments: {
        Row: {
          athlete_id: string | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          organization_id: string
          scheduled_date: string
          team_id: string | null
          test_type: string
          updated_at: string
        }
        Insert: {
          athlete_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          scheduled_date: string
          team_id?: string | null
          test_type: string
          updated_at?: string
        }
        Update: {
          athlete_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          scheduled_date?: string
          team_id?: string | null
          test_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_assignments_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_assignments_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      test_types: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          group_name: string
          id: string
          label: string
          lower_is_better: boolean
          organization_id: string
          unit: string
          updated_at: string
          value: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          group_name?: string
          id?: string
          label: string
          lower_is_better?: boolean
          organization_id: string
          unit?: string
          updated_at?: string
          value: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          group_name?: string
          id?: string
          label?: string
          lower_is_better?: boolean
          organization_id?: string
          unit?: string
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tests: {
        Row: {
          athlete_id: string
          created_at: string
          id: string
          notes: string | null
          organization_id: string
          test_date: string
          test_type: string
          unit: string | null
          updated_at: string
          value: number
        }
        Insert: {
          athlete_id: string
          created_at?: string
          id?: string
          notes?: string | null
          organization_id?: string
          test_date?: string
          test_type: string
          unit?: string | null
          updated_at?: string
          value: number
        }
        Update: {
          athlete_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          organization_id?: string
          test_date?: string
          test_type?: string
          unit?: string | null
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "tests_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_leads: {
        Row: {
          created_at: string
          email: string
          id: string
          results: Json
          tool: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          results?: Json
          tool: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          results?: Json
          tool?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      workout_assignments: {
        Row: {
          athlete_id: string | null
          created_at: string
          id: string
          notes: string | null
          scheduled_date: string
          status: string
          team_id: string | null
          updated_at: string
          workout_id: string
        }
        Insert: {
          athlete_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          scheduled_date?: string
          status?: string
          team_id?: string | null
          updated_at?: string
          workout_id: string
        }
        Update: {
          athlete_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          scheduled_date?: string
          status?: string
          team_id?: string | null
          updated_at?: string
          workout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_assignments_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_assignments_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_assignments_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_blocks: {
        Row: {
          created_at: string
          id: string
          name: string
          notes: string | null
          position: number
          updated_at: string
          workout_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          position?: number
          updated_at?: string
          workout_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          position?: number
          updated_at?: string
          workout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_blocks_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_exercises: {
        Row: {
          block_id: string | null
          created_at: string
          exercise_id: string | null
          exercise_name: string
          id: string
          load: number | null
          notes: string | null
          percent: number | null
          percent_of_exercise_id: string | null
          position: number
          reps: string | null
          rest_seconds: number | null
          sets: number | null
          superset_group: string | null
          target_velocity_max: number | null
          target_velocity_min: number | null
          tempo: string | null
          updated_at: string
          workout_id: string
        }
        Insert: {
          block_id?: string | null
          created_at?: string
          exercise_id?: string | null
          exercise_name: string
          id?: string
          load?: number | null
          notes?: string | null
          percent?: number | null
          percent_of_exercise_id?: string | null
          position?: number
          reps?: string | null
          rest_seconds?: number | null
          sets?: number | null
          superset_group?: string | null
          target_velocity_max?: number | null
          target_velocity_min?: number | null
          tempo?: string | null
          updated_at?: string
          workout_id: string
        }
        Update: {
          block_id?: string | null
          created_at?: string
          exercise_id?: string | null
          exercise_name?: string
          id?: string
          load?: number | null
          notes?: string | null
          percent?: number | null
          percent_of_exercise_id?: string | null
          position?: number
          reps?: string | null
          rest_seconds?: number | null
          sets?: number | null
          superset_group?: string | null
          target_velocity_max?: number | null
          target_velocity_min?: number | null
          tempo?: string | null
          updated_at?: string
          workout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_exercises_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "workout_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_exercises_percent_of_exercise_id_fkey"
            columns: ["percent_of_exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_exercises_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_sets: {
        Row: {
          created_at: string
          distance_in: number | null
          id: string
          load: number | null
          notes: string | null
          percent: number | null
          percent_of_exercise_id: string | null
          position: number
          reps: string | null
          rm_reps: number | null
          sets: number | null
          target_velocity_max: number | null
          target_velocity_min: number | null
          time_seconds: number | null
          updated_at: string
          workout_exercise_id: string
        }
        Insert: {
          created_at?: string
          distance_in?: number | null
          id?: string
          load?: number | null
          notes?: string | null
          percent?: number | null
          percent_of_exercise_id?: string | null
          position?: number
          reps?: string | null
          rm_reps?: number | null
          sets?: number | null
          target_velocity_max?: number | null
          target_velocity_min?: number | null
          time_seconds?: number | null
          updated_at?: string
          workout_exercise_id: string
        }
        Update: {
          created_at?: string
          distance_in?: number | null
          id?: string
          load?: number | null
          notes?: string | null
          percent?: number | null
          percent_of_exercise_id?: string | null
          position?: number
          reps?: string | null
          rm_reps?: number | null
          sets?: number | null
          target_velocity_max?: number | null
          target_velocity_min?: number | null
          time_seconds?: number | null
          updated_at?: string
          workout_exercise_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_sets_percent_of_exercise_id_fkey"
            columns: ["percent_of_exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_sets_workout_exercise_id_fkey"
            columns: ["workout_exercise_id"]
            isOneToOne: false
            referencedRelation: "workout_exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      workouts: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          team_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          notes?: string | null
          organization_id?: string
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workouts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workouts_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invite: { Args: { _token: string }; Returns: string }
      athlete_can_read_workout: {
        Args: { _workout_id: string }
        Returns: boolean
      }
      claim_athlete: { Args: { _token: string }; Returns: string }
      current_org_id: { Args: never; Returns: string }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      estimate_1rm: {
        Args: { _formula?: string; _load: number; _reps: number }
        Returns: number
      }
      get_athlete_by_join_token: {
        Args: { _token: string }
        Returns: {
          athlete_email: string
          first_name: string
          id: string
          last_name: string
          name: string
          preferred_name: string
        }[]
      }
      get_invite: {
        Args: { _token: string }
        Returns: {
          accepted_at: string
          email: string
          expires_at: string
          member_role: Database["public"]["Enums"]["org_member_role"]
          organization_name: string
        }[]
      }
      get_roster_by_qr_token: {
        Args: { _token: string }
        Returns: {
          athlete_id: string
          class_period: string
          display_name: string
          grade: number
          photo_url: string
          position: string
        }[]
      }
      get_team_by_qr_token: {
        Args: { _token: string }
        Returns: {
          color: string
          id: string
          name: string
          season: string
          sport: string
        }[]
      }
      has_permission: {
        Args: { _permission: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_athlete_of_team: { Args: { _team_id: string }; Returns: boolean }
      is_org_member: { Args: { _org_id: string }; Returns: boolean }
      is_org_owner: { Args: { _org_id: string }; Returns: boolean }
      is_self_athlete: { Args: { _athlete_id: string }; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      merge_athletes: {
        Args: { _drop: string; _keep: string }
        Returns: string
      }
      merge_exercises: {
        Args: { _alias_id: string; _primary_id: string }
        Returns: undefined
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      record_rep_max_candidate: {
        Args: {
          _athlete_id: string
          _exercise_id: string
          _exercise_name: string
          _load: number
          _note: string
          _reps: number
          _tested_at: string
        }
        Returns: undefined
      }
      rollup_rep_maxes: { Args: never; Returns: number }
      roster_check_in: {
        Args: { _athlete_id: string; _bodyweight?: number; _token: string }
        Returns: string
      }
      submit_registration: {
        Args: { _payload: Json; _token: string }
        Returns: string
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "user"
        | "owner"
        | "administrator"
        | "coach"
        | "assistant_coach"
        | "athlete"
        | "sport_coach"
        | "parent"
        | "platform_owner"
      athlete_invite_status:
        | "not_invited"
        | "sent"
        | "delivered"
        | "opened"
        | "pin_set"
        | "active"
        | "expired"
        | "failed"
      org_member_role: "owner" | "coach"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "user",
        "owner",
        "administrator",
        "coach",
        "assistant_coach",
        "athlete",
        "sport_coach",
        "parent",
        "platform_owner",
      ],
      athlete_invite_status: [
        "not_invited",
        "sent",
        "delivered",
        "opened",
        "pin_set",
        "active",
        "expired",
        "failed",
      ],
      org_member_role: ["owner", "coach"],
    },
  },
} as const
