export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      activities: {
        Row: {
          city_visit_id: string
          created_at: string | null
          created_by: string
          currency: string
          details: Json | null
          documents: Json | null
          end_datetime: string | null
          id: string
          location_address: string | null
          location_latitude: number | null
          location_longitude: number | null
          notes: string | null
          price: number | null
          start_datetime: string | null
          title: string
          trip_id: string
          updated_at: string | null
        }
        Insert: {
          city_visit_id: string
          created_at?: string | null
          created_by: string
          currency: string
          details?: Json | null
          documents?: Json | null
          end_datetime?: string | null
          id?: string
          location_address?: string | null
          location_latitude?: number | null
          location_longitude?: number | null
          notes?: string | null
          price?: number | null
          start_datetime?: string | null
          title: string
          trip_id: string
          updated_at?: string | null
        }
        Update: {
          city_visit_id?: string
          created_at?: string | null
          created_by?: string
          currency?: string
          details?: Json | null
          documents?: Json | null
          end_datetime?: string | null
          id?: string
          location_address?: string | null
          location_latitude?: number | null
          location_longitude?: number | null
          notes?: string | null
          price?: number | null
          start_datetime?: string | null
          title?: string
          trip_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activities_city_visit_id_fkey"
            columns: ["city_visit_id"]
            isOneToOne: false
            referencedRelation: "city_visits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_events: {
        Row: {
          channel: string | null
          cost_breakdown: Json | null
          cost_usd: number | null
          created_at: string
          duration_ms: number | null
          execution_id: string | null
          id: string
          metrics: Json | null
          model: string
          node_name: string | null
          occurred_at: string
          operation: string | null
          pages: number | null
          pricing_complete: boolean | null
          process: string
          provider: string
          requests: number
          run_index: number | null
          status: string
          tag: string | null
          tokens_input: number | null
          tokens_output: number | null
          tokens_total: number | null
          trip_id: string | null
          user_id: string | null
          workflow_id: string | null
        }
        Insert: {
          channel?: string | null
          cost_breakdown?: Json | null
          cost_usd?: number | null
          created_at?: string
          duration_ms?: number | null
          execution_id?: string | null
          id?: string
          metrics?: Json | null
          model: string
          node_name?: string | null
          occurred_at?: string
          operation?: string | null
          pages?: number | null
          pricing_complete?: boolean | null
          process: string
          provider: string
          requests?: number
          run_index?: number | null
          status?: string
          tag?: string | null
          tokens_input?: number | null
          tokens_output?: number | null
          tokens_total?: number | null
          trip_id?: string | null
          user_id?: string | null
          workflow_id?: string | null
        }
        Update: {
          channel?: string | null
          cost_breakdown?: Json | null
          cost_usd?: number | null
          created_at?: string
          duration_ms?: number | null
          execution_id?: string | null
          id?: string
          metrics?: Json | null
          model?: string
          node_name?: string | null
          occurred_at?: string
          operation?: string | null
          pages?: number | null
          pricing_complete?: boolean | null
          process?: string
          provider?: string
          requests?: number
          run_index?: number | null
          status?: string
          tag?: string | null
          tokens_input?: number | null
          tokens_output?: number | null
          tokens_total?: number | null
          trip_id?: string | null
          user_id?: string | null
          workflow_id?: string | null
        }
        Relationships: []
      }
      budget_categories: {
        Row: {
          color: string | null
          created_at: string | null
          created_by: string
          icon: string | null
          id: string
          kind: string
          name: string
          order_index: number | null
          system_key: string | null
          trip_id: string
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          created_by: string
          icon?: string | null
          id?: string
          kind?: string
          name: string
          order_index?: number | null
          system_key?: string | null
          trip_id: string
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          created_by?: string
          icon?: string | null
          id?: string
          kind?: string
          name?: string
          order_index?: number | null
          system_key?: string | null
          trip_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_categories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_categories_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_expenses: {
        Row: {
          category_id: string
          city_name: string | null
          city_visit_id: string | null
          created_at: string | null
          created_by: string
          id: string
          notes: string | null
          original_amount: number | null
          original_currency: string | null
          source_id: string | null
          source_kind: string
          spent_on: string | null
          title: string
          trip_id: string
          updated_at: string | null
        }
        Insert: {
          category_id: string
          city_name?: string | null
          city_visit_id?: string | null
          created_at?: string | null
          created_by: string
          id?: string
          notes?: string | null
          original_amount?: number | null
          original_currency?: string | null
          source_id?: string | null
          source_kind?: string
          spent_on?: string | null
          title: string
          trip_id: string
          updated_at?: string | null
        }
        Update: {
          category_id?: string
          city_name?: string | null
          city_visit_id?: string | null
          created_at?: string | null
          created_by?: string
          id?: string
          notes?: string | null
          original_amount?: number | null
          original_currency?: string | null
          source_id?: string | null
          source_kind?: string
          spent_on?: string | null
          title?: string
          trip_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "budget_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_expenses_city_visit_id_fkey"
            columns: ["city_visit_id"]
            isOneToOne: false
            referencedRelation: "city_visits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_expenses_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          ai_attempts: number
          ai_error: string | null
          ai_finished_at: string | null
          ai_reply_id: string | null
          ai_requested_at: string | null
          ai_status: string | null
          chat_id: string | null
          client_msg_id: string | null
          created_at: string | null
          created_by: string
          id: string
          text: string
          trip_id: string
          updated_at: string | null
          user_full_name: string | null
          user_id: string
        }
        Insert: {
          ai_attempts?: number
          ai_error?: string | null
          ai_finished_at?: string | null
          ai_reply_id?: string | null
          ai_requested_at?: string | null
          ai_status?: string | null
          chat_id?: string | null
          client_msg_id?: string | null
          created_at?: string | null
          created_by: string
          id?: string
          text: string
          trip_id: string
          updated_at?: string | null
          user_full_name?: string | null
          user_id: string
        }
        Update: {
          ai_attempts?: number
          ai_error?: string | null
          ai_finished_at?: string | null
          ai_reply_id?: string | null
          ai_requested_at?: string | null
          ai_status?: string | null
          chat_id?: string | null
          client_msg_id?: string | null
          created_at?: string | null
          created_by?: string
          id?: string
          text?: string
          trip_id?: string
          updated_at?: string | null
          user_full_name?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_ai_reply_fkey"
            columns: ["ai_reply_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_reads: {
        Row: {
          chat_id: string | null
          created_at: string | null
          id: string
          last_read_at: string
          trip_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          chat_id?: string | null
          created_at?: string | null
          id?: string
          last_read_at: string
          trip_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          chat_id?: string | null
          created_at?: string | null
          id?: string
          last_read_at?: string
          trip_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_reads_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_reads_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      chats: {
        Row: {
          created_at: string
          id: string
          trip_id: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          trip_id: string
          type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          trip_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chats_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      cities: {
        Row: {
          cover_image_url: string | null
          geonameid: number | null
          getyourguide_id: string | null
          iata_code: string | null
          id: number
          name_en: string | null
          sp8_id: string | null
          sp8_slug: string | null
          tripster_id: string | null
          tripster_slug: string | null
          updated_at: string
          viator_dest_id: string | null
        }
        Insert: {
          cover_image_url?: string | null
          geonameid?: number | null
          getyourguide_id?: string | null
          iata_code?: string | null
          id?: never
          name_en?: string | null
          sp8_id?: string | null
          sp8_slug?: string | null
          tripster_id?: string | null
          tripster_slug?: string | null
          updated_at?: string
          viator_dest_id?: string | null
        }
        Update: {
          cover_image_url?: string | null
          geonameid?: number | null
          getyourguide_id?: string | null
          iata_code?: string | null
          id?: never
          name_en?: string | null
          sp8_id?: string | null
          sp8_slug?: string | null
          tripster_id?: string | null
          tripster_slug?: string | null
          updated_at?: string
          viator_dest_id?: string | null
        }
        Relationships: []
      }
      city_visits: {
        Row: {
          city_name_en: string | null
          country_code: string | null
          created_at: string | null
          created_by: string
          details: Json | null
          end_date: string | null
          external_city_id: string | null
          geonameid: number | null
          id: string
          kind: string | null
          latitude: number | null
          longitude: number | null
          name_i18n: Json | null
          notes: string | null
          position: number | null
          start_date: string | null
          timezone: string | null
          trip_id: string
          updated_at: string | null
        }
        Insert: {
          city_name_en?: string | null
          country_code?: string | null
          created_at?: string | null
          created_by: string
          details?: Json | null
          end_date?: string | null
          external_city_id?: string | null
          geonameid?: number | null
          id?: string
          kind?: string | null
          latitude?: number | null
          longitude?: number | null
          name_i18n?: Json | null
          notes?: string | null
          position?: number | null
          start_date?: string | null
          timezone?: string | null
          trip_id: string
          updated_at?: string | null
        }
        Update: {
          city_name_en?: string | null
          country_code?: string | null
          created_at?: string | null
          created_by?: string
          details?: Json | null
          end_date?: string | null
          external_city_id?: string | null
          geonameid?: number | null
          id?: string
          kind?: string | null
          latitude?: number | null
          longitude?: number | null
          name_i18n?: Json | null
          notes?: string | null
          position?: number | null
          start_date?: string | null
          timezone?: string | null
          trip_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "city_visits_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "city_visits_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      fx_rates: {
        Row: {
          base: string
          created_at: string | null
          fetched_at: string | null
          id: string
          rates: Json
          source: string | null
          updated_at: string | null
        }
        Insert: {
          base: string
          created_at?: string | null
          fetched_at?: string | null
          id?: string
          rates: Json
          source?: string | null
          updated_at?: string | null
        }
        Update: {
          base?: string
          created_at?: string | null
          fetched_at?: string | null
          id?: string
          rates?: Json
          source?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      geo_admin1: {
        Row: {
          code: string
          geonameid: number | null
        }
        Insert: {
          code: string
          geonameid?: number | null
        }
        Update: {
          code?: string
          geonameid?: number | null
        }
        Relationships: []
      }
      geo_alt_names: {
        Row: {
          alternate_name: string | null
          geonameid: number
          is_preferred: boolean | null
          isolanguage: string
        }
        Insert: {
          alternate_name?: string | null
          geonameid: number
          is_preferred?: boolean | null
          isolanguage: string
        }
        Update: {
          alternate_name?: string | null
          geonameid?: number
          is_preferred?: boolean | null
          isolanguage?: string
        }
        Relationships: []
      }
      geo_country: {
        Row: {
          code: string
          geonameid: number | null
        }
        Insert: {
          code: string
          geonameid?: number | null
        }
        Update: {
          code?: string
          geonameid?: number | null
        }
        Relationships: []
      }
      geo_gazetteer: {
        Row: {
          admin1_code: string | null
          admin1_name: string | null
          all_doc: unknown
          area_doc: unknown
          asciiname: string | null
          blob_doc: unknown
          country_code: string | null
          feature_code: string | null
          geonameid: number
          lat: number | null
          lng: number | null
          name: string
          name_doc: unknown
          population: number | null
          search_blob: string
          timezone: string | null
        }
        Insert: {
          admin1_code?: string | null
          admin1_name?: string | null
          all_doc?: unknown
          area_doc?: unknown
          asciiname?: string | null
          blob_doc?: unknown
          country_code?: string | null
          feature_code?: string | null
          geonameid: number
          lat?: number | null
          lng?: number | null
          name: string
          name_doc?: unknown
          population?: number | null
          search_blob: string
          timezone?: string | null
        }
        Update: {
          admin1_code?: string | null
          admin1_name?: string | null
          all_doc?: unknown
          area_doc?: unknown
          asciiname?: string | null
          blob_doc?: unknown
          country_code?: string | null
          feature_code?: string | null
          geonameid?: number
          lat?: number | null
          lng?: number | null
          name?: string
          name_doc?: unknown
          population?: number | null
          search_blob?: string
          timezone?: string | null
        }
        Relationships: []
      }
      geocode_cache: {
        Row: {
          action: string
          created_at: string
          hit_count: number
          id: number
          lang: string
          last_used_at: string
          query_key: string
          results: Json
        }
        Insert: {
          action: string
          created_at?: string
          hit_count?: number
          id?: never
          lang: string
          last_used_at?: string
          query_key: string
          results: Json
        }
        Update: {
          action?: string
          created_at?: string
          hit_count?: number
          id?: never
          lang?: string
          last_used_at?: string
          query_key?: string
          results?: Json
        }
        Relationships: []
      }
      geocode_queue: {
        Row: {
          enqueued_at: string
          id: number
          priority: number
        }
        Insert: {
          enqueued_at?: string
          id?: number
          priority: number
        }
        Update: {
          enqueued_at?: string
          id?: number
          priority?: number
        }
        Relationships: []
      }
      geocode_rate_bucket: {
        Row: {
          id: number
          tokens: number
          updated_at: string
        }
        Insert: {
          id?: number
          tokens?: number
          updated_at?: string
        }
        Update: {
          id?: number
          tokens?: number
          updated_at?: string
        }
        Relationships: []
      }
      hotel_stays: {
        Row: {
          address: string | null
          booking_reference: string | null
          booking_url: string | null
          check_in_datetime: string | null
          check_out_datetime: string | null
          city_visit_id: string
          created_at: string | null
          created_by: string
          currency: string
          details: Json | null
          documents: Json | null
          email: string | null
          free_cancellation: boolean | null
          free_cancellation_until: string | null
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          notes: string | null
          payment_status: string | null
          phone: string | null
          price: number | null
          trip_id: string
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          booking_reference?: string | null
          booking_url?: string | null
          check_in_datetime?: string | null
          check_out_datetime?: string | null
          city_visit_id: string
          created_at?: string | null
          created_by: string
          currency: string
          details?: Json | null
          documents?: Json | null
          email?: string | null
          free_cancellation?: boolean | null
          free_cancellation_until?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name: string
          notes?: string | null
          payment_status?: string | null
          phone?: string | null
          price?: number | null
          trip_id: string
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          booking_reference?: string | null
          booking_url?: string | null
          check_in_datetime?: string | null
          check_out_datetime?: string | null
          city_visit_id?: string
          created_at?: string | null
          created_by?: string
          currency?: string
          details?: Json | null
          documents?: Json | null
          email?: string | null
          free_cancellation?: boolean | null
          free_cancellation_until?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          notes?: string | null
          payment_status?: string | null
          phone?: string | null
          price?: number | null
          trip_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hotel_stays_city_visit_id_fkey"
            columns: ["city_visit_id"]
            isOneToOne: false
            referencedRelation: "city_visits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_stays_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_stays_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      n8n_chat_histories: {
        Row: {
          id: number
          message: Json
          session_id: string
        }
        Insert: {
          id?: number
          message: Json
          session_id: string
        }
        Update: {
          id?: number
          message?: Json
          session_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          action_url: string | null
          created_at: string | null
          created_by: string | null
          i18n_message_key: string | null
          i18n_params: Json | null
          i18n_title_key: string | null
          id: string
          message: string | null
          read: boolean | null
          title: string | null
          trip_id: string | null
          trip_member_id: string | null
          type: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          action_url?: string | null
          created_at?: string | null
          created_by?: string | null
          i18n_message_key?: string | null
          i18n_params?: Json | null
          i18n_title_key?: string | null
          id?: string
          message?: string | null
          read?: boolean | null
          title?: string | null
          trip_id?: string | null
          trip_member_id?: string | null
          type?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          action_url?: string | null
          created_at?: string | null
          created_by?: string | null
          i18n_message_key?: string | null
          i18n_params?: Json | null
          i18n_title_key?: string | null
          id?: string
          message?: string | null
          read?: boolean | null
          title?: string | null
          trip_id?: string | null
          trip_member_id?: string | null
          type?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_trip_member_id_fkey"
            columns: ["trip_member_id"]
            isOneToOne: false
            referencedRelation: "trip_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_clicks: {
        Row: {
          campaign: string | null
          created_at: string | null
          fallback: boolean | null
          id: string
          link: string
          partner: string
          provider: string | null
          trip_id: string | null
          type: string | null
          user_id: string
        }
        Insert: {
          campaign?: string | null
          created_at?: string | null
          fallback?: boolean | null
          id?: string
          link: string
          partner: string
          provider?: string | null
          trip_id?: string | null
          type?: string | null
          user_id: string
        }
        Update: {
          campaign?: string | null
          created_at?: string | null
          fallback?: boolean | null
          id?: string
          link?: string
          partner?: string
          provider?: string | null
          trip_id?: string | null
          type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_clicks_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_clicks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      product: {
        Row: {
          active: boolean
          billing_interval: string | null
          code: string
          created_at: string
          kind: string
          metadata: Json | null
          scope: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          billing_interval?: string | null
          code: string
          created_at?: string
          kind: string
          metadata?: Json | null
          scope: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          billing_interval?: string | null
          code?: string
          created_at?: string
          kind?: string
          metadata?: Json | null
          scope?: string
          updated_at?: string
        }
        Relationships: []
      }
      provider_customer: {
        Row: {
          created_at: string
          id: string
          provider: string
          provider_customer_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          provider?: string
          provider_customer_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          provider?: string
          provider_customer_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_customer_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_price: {
        Row: {
          active: boolean
          created_at: string
          currency: string | null
          id: string
          price_synced_at: string | null
          product_code: string
          provider: string
          provider_env: string
          provider_price_id: string | null
          provider_product_id: string
          recurring_interval: string | null
          unit_amount: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          currency?: string | null
          id?: string
          price_synced_at?: string | null
          product_code: string
          provider?: string
          provider_env: string
          provider_price_id?: string | null
          provider_product_id: string
          recurring_interval?: string | null
          unit_amount?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          currency?: string | null
          id?: string
          price_synced_at?: string | null
          product_code?: string
          provider?: string
          provider_env?: string
          provider_price_id?: string | null
          provider_product_id?: string
          recurring_interval?: string | null
          unit_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_price_product_code_fkey"
            columns: ["product_code"]
            isOneToOne: false
            referencedRelation: "product"
            referencedColumns: ["code"]
          },
        ]
      }
      purchase: {
        Row: {
          amount: number | null
          created_at: string
          currency: string
          id: string
          needs_review: boolean
          product_code: string
          provider: string
          provider_charge_id: string | null
          provider_ref: string | null
          purchased_at: string | null
          refunded_at: string | null
          status: string
          synced_at: string | null
          trip_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          currency?: string
          id?: string
          needs_review?: boolean
          product_code: string
          provider?: string
          provider_charge_id?: string | null
          provider_ref?: string | null
          purchased_at?: string | null
          refunded_at?: string | null
          status?: string
          synced_at?: string | null
          trip_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          currency?: string
          id?: string
          needs_review?: boolean
          product_code?: string
          provider?: string
          provider_charge_id?: string | null
          provider_ref?: string | null
          purchased_at?: string | null
          refunded_at?: string | null
          status?: string
          synced_at?: string | null
          trip_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_product_code_fkey"
            columns: ["product_code"]
            isOneToOne: false
            referencedRelation: "product"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "purchase_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_hits: {
        Row: {
          bucket: string
          created_at: string
          id: number
          key: string
        }
        Insert: {
          bucket: string
          created_at?: string
          id?: never
          key: string
        }
        Update: {
          bucket?: string
          created_at?: string
          id?: never
          key?: string
        }
        Relationships: []
      }
      subscription: {
        Row: {
          amount: number | null
          billing_interval: string | null
          cancel_at_period_end: boolean
          canceled_at: string | null
          created_at: string
          currency: string
          current_period_end: string | null
          id: string
          needs_review: boolean
          price_synced_at: string | null
          product_code: string
          provider: string
          provider_event_at: string | null
          provider_meta: Json | null
          provider_ref: string | null
          provider_subscription_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number | null
          billing_interval?: string | null
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          id?: string
          needs_review?: boolean
          price_synced_at?: string | null
          product_code: string
          provider?: string
          provider_event_at?: string | null
          provider_meta?: Json | null
          provider_ref?: string | null
          provider_subscription_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number | null
          billing_interval?: string | null
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          id?: string
          needs_review?: boolean
          price_synced_at?: string | null
          product_code?: string
          provider?: string
          provider_event_at?: string | null
          provider_meta?: Json | null
          provider_ref?: string | null
          provider_subscription_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_product_code_fkey"
            columns: ["product_code"]
            isOneToOne: false
            referencedRelation: "product"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "subscription_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_link_tokens: {
        Row: {
          created_at: string | null
          expires_at: string
          id: string
          token: string
          trip_id: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          id?: string
          token: string
          trip_id: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: string
          token?: string
          trip_id?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_link_tokens_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_link_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_reminder_logs: {
        Row: {
          created_at: string | null
          delivered_at: string | null
          event_id: string
          event_kind: string | null
          id: string
          output: string | null
          sent_at: string | null
          trip_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          delivered_at?: string | null
          event_id: string
          event_kind?: string | null
          id?: string
          output?: string | null
          sent_at?: string | null
          trip_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          delivered_at?: string | null
          event_id?: string
          event_kind?: string | null
          id?: string
          output?: string | null
          sent_at?: string | null
          trip_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_reminder_logs_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_reminder_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      transfers: {
        Row: {
          booking_reference: string | null
          booking_url: string | null
          carrier: string | null
          created_at: string | null
          created_by: string
          currency: string
          day_change: boolean
          details: Json | null
          documents: Json | null
          end_datetime: string | null
          flight_number: string | null
          from_address: string | null
          from_city_visit_id: string | null
          from_latitude: number | null
          from_longitude: number | null
          id: string
          notes: string | null
          price: number | null
          start_datetime: string | null
          to_address: string | null
          to_city_visit_id: string | null
          to_latitude: number | null
          to_longitude: number | null
          transport_type: string | null
          trip_id: string
          updated_at: string | null
        }
        Insert: {
          booking_reference?: string | null
          booking_url?: string | null
          carrier?: string | null
          created_at?: string | null
          created_by: string
          currency: string
          day_change?: boolean
          details?: Json | null
          documents?: Json | null
          end_datetime?: string | null
          flight_number?: string | null
          from_address?: string | null
          from_city_visit_id?: string | null
          from_latitude?: number | null
          from_longitude?: number | null
          id?: string
          notes?: string | null
          price?: number | null
          start_datetime?: string | null
          to_address?: string | null
          to_city_visit_id?: string | null
          to_latitude?: number | null
          to_longitude?: number | null
          transport_type?: string | null
          trip_id: string
          updated_at?: string | null
        }
        Update: {
          booking_reference?: string | null
          booking_url?: string | null
          carrier?: string | null
          created_at?: string | null
          created_by?: string
          currency?: string
          day_change?: boolean
          details?: Json | null
          documents?: Json | null
          end_datetime?: string | null
          flight_number?: string | null
          from_address?: string | null
          from_city_visit_id?: string | null
          from_latitude?: number | null
          from_longitude?: number | null
          id?: string
          notes?: string | null
          price?: number | null
          start_datetime?: string | null
          to_address?: string | null
          to_city_visit_id?: string | null
          to_latitude?: number | null
          to_longitude?: number | null
          transport_type?: string | null
          trip_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transfers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_from_city_visit_id_fkey"
            columns: ["from_city_visit_id"]
            isOneToOne: false
            referencedRelation: "city_visits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_to_city_visit_id_fkey"
            columns: ["to_city_visit_id"]
            isOneToOne: false
            referencedRelation: "city_visits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_budgets: {
        Row: {
          created_at: string | null
          created_by: string
          currency: string
          fx_overrides: Json | null
          id: string
          trip_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by: string
          currency: string
          fx_overrides?: Json | null
          id?: string
          trip_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string
          currency?: string
          fx_overrides?: Json | null
          id?: string
          trip_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trip_budgets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_budgets_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: true
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_documents: {
        Row: {
          created_at: string | null
          created_by: string
          created_by_name: string | null
          documents: Json | null
          id: string
          link_url: string | null
          notes: string | null
          title: string
          trip_id: string
          updated_at: string | null
          visibility: string
        }
        Insert: {
          created_at?: string | null
          created_by: string
          created_by_name?: string | null
          documents?: Json | null
          id?: string
          link_url?: string | null
          notes?: string | null
          title: string
          trip_id: string
          updated_at?: string | null
          visibility?: string
        }
        Update: {
          created_at?: string | null
          created_by?: string
          created_by_name?: string | null
          documents?: Json | null
          id?: string
          link_url?: string | null
          notes?: string | null
          title?: string
          trip_id?: string
          updated_at?: string | null
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_documents_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_invite_links: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string
          id: string
          revoked_at: string | null
          role: string
          token: string
          trip_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          revoked_at?: string | null
          role?: string
          token: string
          trip_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          revoked_at?: string | null
          role?: string
          token?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_invite_links_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_member_blocks: {
        Row: {
          blocked_at: string
          blocked_by: string | null
          trip_id: string
          user_id: string
        }
        Insert: {
          blocked_at?: string
          blocked_by?: string | null
          trip_id: string
          user_id: string
        }
        Update: {
          blocked_at?: string
          blocked_by?: string | null
          trip_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_member_blocks_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_members: {
        Row: {
          accepted_at: string | null
          created_at: string | null
          created_by: string | null
          id: string
          invite_email: string | null
          invited_by: string | null
          role: string | null
          status: string | null
          trip_id: string
          updated_at: string | null
          user_full_name: string | null
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          invite_email?: string | null
          invited_by?: string | null
          role?: string | null
          status?: string | null
          trip_id: string
          updated_at?: string | null
          user_full_name?: string | null
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          invite_email?: string | null
          invited_by?: string | null
          role?: string | null
          status?: string | null
          trip_id?: string
          updated_at?: string | null
          user_full_name?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trip_members_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_members_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_services: {
        Row: {
          created_at: string | null
          created_by: string
          currency: string
          details: Json | null
          dropoff_datetime: string | null
          id: string
          kind: string | null
          name: string
          pickup_datetime: string | null
          price: number | null
          trip_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by: string
          currency: string
          details?: Json | null
          dropoff_datetime?: string | null
          id?: string
          kind?: string | null
          name: string
          pickup_datetime?: string | null
          price?: number | null
          trip_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string
          currency?: string
          details?: Json | null
          dropoff_datetime?: string | null
          id?: string
          kind?: string | null
          name?: string
          pickup_datetime?: string | null
          price?: number | null
          trip_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trip_services_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_services_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_telegram_integrations: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          linked_at: string | null
          telegram_chat_id: string
          telegram_first_name: string | null
          telegram_username: string | null
          trip_id: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          linked_at?: string | null
          telegram_chat_id: string
          telegram_first_name?: string | null
          telegram_username?: string | null
          trip_id: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          linked_at?: string | null
          telegram_chat_id?: string
          telegram_first_name?: string | null
          telegram_username?: string | null
          trip_id?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trip_telegram_integrations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_telegram_integrations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          cover_gradient: string | null
          cover_image_url: string | null
          created_at: string | null
          created_by: string
          description: string | null
          details: Json | null
          id: string
          is_pro_trip: boolean | null
          notes: string | null
          share_token: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          cover_gradient?: string | null
          cover_image_url?: string | null
          created_at?: string | null
          created_by: string
          description?: string | null
          details?: Json | null
          id?: string
          is_pro_trip?: boolean | null
          notes?: string | null
          share_token?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          cover_gradient?: string | null
          cover_image_url?: string | null
          created_at?: string | null
          created_by?: string
          description?: string | null
          details?: Json | null
          id?: string
          is_pro_trip?: boolean | null
          notes?: string | null
          share_token?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trips_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_custom_visits: {
        Row: {
          country_code: string | null
          created_at: string
          end_date: string | null
          geonameid: number | null
          id: number
          lat: number | null
          lng: number | null
          name_i18n: Json | null
          start_date: string | null
          user_id: string
        }
        Insert: {
          country_code?: string | null
          created_at?: string
          end_date?: string | null
          geonameid?: number | null
          id?: never
          lat?: number | null
          lng?: number | null
          name_i18n?: Json | null
          start_date?: string | null
          user_id: string
        }
        Update: {
          country_code?: string | null
          created_at?: string
          end_date?: string | null
          geonameid?: number | null
          id?: never
          lat?: number | null
          lng?: number | null
          name_i18n?: Json | null
          start_date?: string | null
          user_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          deleted_at: string | null
          email: string
          entitlement_synced_at: string | null
          full_name: string | null
          id: string
          language: string | null
          signup_gclid: string | null
          signup_utm_campaign: string | null
          signup_utm_medium: string | null
          signup_utm_source: string | null
          subscription_end_date: string | null
          subscription_status: string | null
          unit_system: string
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          deleted_at?: string | null
          email: string
          entitlement_synced_at?: string | null
          full_name?: string | null
          id: string
          language?: string | null
          signup_gclid?: string | null
          signup_utm_campaign?: string | null
          signup_utm_medium?: string | null
          signup_utm_source?: string | null
          subscription_end_date?: string | null
          subscription_status?: string | null
          unit_system?: string
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          deleted_at?: string | null
          email?: string
          entitlement_synced_at?: string | null
          full_name?: string | null
          id?: string
          language?: string | null
          signup_gclid?: string | null
          signup_utm_campaign?: string | null
          signup_utm_medium?: string | null
          signup_utm_source?: string | null
          subscription_end_date?: string | null
          subscription_status?: string | null
          unit_system?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      webhook_event: {
        Row: {
          id: string
          last_error: string | null
          payload: Json | null
          processed_at: string | null
          provider: string
          provider_event_id: string
          received_at: string
          signature_valid: boolean | null
          status: string
          type: string | null
        }
        Insert: {
          id?: string
          last_error?: string | null
          payload?: Json | null
          processed_at?: string | null
          provider?: string
          provider_event_id: string
          received_at?: string
          signature_valid?: boolean | null
          status?: string
          type?: string | null
        }
        Update: {
          id?: string
          last_error?: string | null
          payload?: Json | null
          processed_at?: string | null
          provider?: string
          provider_event_id?: string
          received_at?: string
          signature_valid?: boolean | null
          status?: string
          type?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      ai_cost_by_day: {
        Row: {
          calls: number | null
          cost_usd: number | null
          day: string | null
          pages: number | null
          tokens_input: number | null
          tokens_output: number | null
        }
        Relationships: []
      }
      ai_cost_by_process: {
        Row: {
          calls: number | null
          cost_usd: number | null
          pages: number | null
          process: string | null
          tokens_input: number | null
          tokens_output: number | null
        }
        Relationships: []
      }
      ai_cost_by_run: {
        Row: {
          calls: number | null
          cost_usd: number | null
          execution_id: string | null
          fully_priced: boolean | null
          process: string | null
          started_at: string | null
        }
        Relationships: []
      }
      ai_cost_by_trip: {
        Row: {
          calls: number | null
          cost_usd: number | null
          trip_id: string | null
        }
        Relationships: []
      }
      ai_cost_by_user: {
        Row: {
          calls: number | null
          cost_usd: number | null
          user_id: string | null
        }
        Relationships: []
      }
      ai_cost_by_week: {
        Row: {
          calls: number | null
          cost_usd: number | null
          week_start: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _can_access_trip_document: {
        Args: { p_created_by: string; p_trip_id: string; p_visibility: string }
        Returns: boolean
      }
      _can_access_trip_file: {
        Args: { p_object_name: string }
        Returns: boolean
      }
      _can_edit_trip: {
        Args: { p_trip: string; p_uid: string }
        Returns: boolean
      }
      _can_write_trip_file: {
        Args: { p_object_name: string }
        Returns: boolean
      }
      _trip_anchor_date: { Args: { p_trip: string }; Returns: string }
      _trip_file_not_others_private: {
        Args: { p_object_name: string; p_trip: string }
        Returns: boolean
      }
      _trip_file_trip_id: { Args: { p_object_name: string }; Returns: string }
      active_owned_trips: {
        Args: { p_uid: string }
        Returns: {
          id: string
          title: string
        }[]
      }
      add_city: {
        Args: {
          p_actor: string
          p_city: Json
          p_index?: number
          p_trip: string
        }
        Returns: string
      }
      add_layover_transfer: {
        Args: {
          p_actor: string
          p_from: string
          p_segments: Json
          p_to: string
          p_trip: string
          p_waypoints: Json
        }
        Returns: undefined
      }
      anonymize_my_account: { Args: { p_user_id: string }; Returns: Json }
      auth_email_status: {
        Args: { p_email: string }
        Returns: {
          exists_user: boolean
          has_oauth: boolean
          has_password: boolean
          is_confirmed: boolean
        }[]
      }
      can_create_trip: { Args: { p_uid: string }; Returns: boolean }
      chat_ai_run_watchdog: { Args: never; Returns: number }
      claim_ai_run: {
        Args: { p_message_id: string }
        Returns: {
          ai_attempts: number
          ai_error: string | null
          ai_finished_at: string | null
          ai_reply_id: string | null
          ai_requested_at: string | null
          ai_status: string | null
          chat_id: string | null
          client_msg_id: string | null
          created_at: string | null
          created_by: string
          id: string
          text: string
          trip_id: string
          updated_at: string | null
          user_full_name: string | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      count_active_owned_trips: { Args: { p_uid: string }; Returns: number }
      create_trip_invite_link: {
        Args: { p_actor: string; p_role: string; p_trip: string }
        Returns: Json
      }
      create_trip_with_route: {
        Args: {
          p_actor: string
          p_cities: Json
          p_start_date: string
          p_title: string
        }
        Returns: string
      }
      daitch_mokotoff: { Args: { "": string }; Returns: string[] }
      dmetaphone: { Args: { "": string }; Returns: string }
      dmetaphone_alt: { Args: { "": string }; Returns: string }
      ensure_trip_budget: { Args: { p_trip_id: string }; Returns: undefined }
      finish_ai_run: {
        Args: {
          p_bot_user_id?: string
          p_error?: string
          p_message_id: string
          p_reply?: string
        }
        Returns: string
      }
      gaz_project: {
        Args: { _geonameid: number; _lang?: string }
        Returns: {
          display: string
          name_i18n: Json
          subtitle: string
        }[]
      }
      geocode_dequeue: { Args: { p_ticket: number }; Returns: undefined }
      geocode_enqueue: { Args: { p_priority: number }; Returns: number }
      geocode_serve_fair: {
        Args: {
          p_cap?: number
          p_min?: number
          p_rate?: number
          p_ticket: number
        }
        Returns: boolean
      }
      get_inbox: { Args: { p_actor: string }; Returns: Json }
      get_my_trip_cards: { Args: { p_actor: string }; Returns: Json }
      get_pending_reminders: {
        Args: { window_minutes?: number }
        Returns: {
          chat_id: string
          context: Json
          trip_id: string
          type: string
          user_id: string
          user_locale: string
        }[]
      }
      get_trip_owner_profiles: {
        Args: { trip_id_list: string[] }
        Returns: {
          avatar_url: string
          email: string
          full_name: string
          trip_id: string
          user_id: string
        }[]
      }
      get_user_travel_stats: { Args: { p_actor: string }; Returns: Json }
      invite_trip_member: {
        Args: {
          p_actor: string
          p_email: string
          p_role: string
          p_trip: string
        }
        Returns: Json
      }
      is_trip_creator: { Args: { p_trip_id: string }; Returns: boolean }
      is_trip_participant: { Args: { p_trip_id: string }; Returns: boolean }
      is_trip_pro: { Args: { p_trip_id: string }; Returns: boolean }
      is_user_pro: { Args: { p_uid: string }; Returns: boolean }
      mark_all_notifications_read: {
        Args: { p_actor: string }
        Returns: undefined
      }
      mark_notification_read: {
        Args: { p_actor: string; p_id: string }
        Returns: undefined
      }
      mentions_assistant: { Args: { p_text: string }; Returns: boolean }
      nearest_cities: {
        Args: { _lang?: string; _lat: number; _lim?: number; _lng: number }
        Returns: {
          country_code: string
          display: string
          feature_code: string
          geonameid: number
          lat: number
          lng: number
          name_i18n: Json
          population: number
          subtitle: string
        }[]
      }
      rate_limit_check: {
        Args: {
          p_bucket: string
          p_key: string
          p_max: number
          p_window_seconds: number
        }
        Returns: boolean
      }
      rate_limit_record: {
        Args: { p_bucket: string; p_key: string }
        Returns: undefined
      }
      recompute_trip: {
        Args: { p_base?: string; p_trip: string }
        Returns: undefined
      }
      recompute_trip_entitlement: {
        Args: { p_trip_id: string }
        Returns: undefined
      }
      recompute_user_entitlement: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      reminder_true_instant: {
        Args: { ts: string; tz: string }
        Returns: string
      }
      remove_city: {
        Args: { p_actor: string; p_city: string; p_trip: string }
        Returns: undefined
      }
      remove_trip_member: {
        Args: { p_actor: string; p_member: string; p_trip: string }
        Returns: undefined
      }
      reorder_cities: {
        Args: { p_actor: string; p_order: string[]; p_trip: string }
        Returns: undefined
      }
      respond_trip_invite: {
        Args: {
          p_action: string
          p_actor: string
          p_member: string
          p_trip: string
        }
        Returns: Json
      }
      revoke_trip_pro_addons: {
        Args: { p_trip_id: string }
        Returns: {
          trip_id: string
        }[]
      }
      revoke_user_pro_addons: {
        Args: { p_user_id: string }
        Returns: {
          trip_id: string
        }[]
      }
      search_gazetteer: {
        Args: { lang?: string; lim?: number; q: string }
        Returns: {
          country_code: string
          display: string
          feature_code: string
          geonameid: number
          lat: number
          lng: number
          name_i18n: Json
          population: number
          subtitle: string
        }[]
      }
      search_gazetteer_batch: {
        Args: { items: Json; lang?: string }
        Returns: {
          country_code: string
          display: string
          feature_code: string
          geonameid: number
          lat: number
          lng: number
          name_i18n: Json
          ord: number
          population: number
          subtitle: string
        }[]
      }
      search_gazetteer_core: {
        Args: { cc?: string; lang?: string; lim?: number; q: string }
        Returns: {
          country_code: string
          display: string
          feature_code: string
          geonameid: number
          lat: number
          lng: number
          name_i18n: Json
          population: number
          subtitle: string
        }[]
      }
      send_chat_message: {
        Args: {
          p_actor: string
          p_client_msg_id?: string
          p_text: string
          p_trip: string
        }
        Returns: {
          ai_attempts: number
          ai_error: string | null
          ai_finished_at: string | null
          ai_reply_id: string | null
          ai_requested_at: string | null
          ai_status: string | null
          chat_id: string | null
          client_msg_id: string | null
          created_at: string | null
          created_by: string
          id: string
          text: string
          trip_id: string
          updated_at: string | null
          user_full_name: string | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_city_nights: {
        Args: {
          p_actor: string
          p_city: string
          p_nights: number
          p_trip: string
        }
        Returns: undefined
      }
      set_trip_start_date: {
        Args: { p_actor: string; p_date: string; p_trip: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      soundex: { Args: { "": string }; Returns: string }
      take_geocode_token: {
        Args: { p_cap?: number; p_min?: number; p_rate?: number }
        Returns: boolean
      }
      text_soundex: { Args: { "": string }; Returns: string }
      tg_reminders_undelivered_watchdog: { Args: never; Returns: undefined }
      translit_ru_lat: { Args: { s: string }; Returns: string }
      unaccent: { Args: { "": string }; Returns: string }
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

