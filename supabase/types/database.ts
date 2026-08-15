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
    PostgrestVersion: "13.0.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      artworks: {
        Row: {
          artwork_url: string | null
          audio_url: string | null
          created_at: string | null
          description: string | null
          id: string
          subtitle: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          artwork_url?: string | null
          audio_url?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          subtitle?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          artwork_url?: string | null
          audio_url?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          subtitle?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      dummy_data: {
        Row: {
          created_at: string
          id: string
        }
        Insert: {
          created_at?: string
          id?: string
        }
        Update: {
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      finance_allocations: {
        Row: {
          allocation_type: string
          amount_cents: number
          category_code: string
          classification_rule_id: string | null
          created_at: string
          created_by: string
          evidence_object_id: string | null
          household_id: string
          human_decision_id: string | null
          id: string
          income_stream: string | null
          logical_allocation_id: string
          memo: string | null
          person_key: string | null
          property_unit: string | null
          record_status: string
          revision_number: number
          supersedes_allocation_id: string | null
          tax_treatment: string
          tax_year: number | null
          transaction_id: string
        }
        Insert: {
          allocation_type: string
          amount_cents: number
          category_code: string
          classification_rule_id?: string | null
          created_at?: string
          created_by: string
          evidence_object_id?: string | null
          household_id: string
          human_decision_id?: string | null
          id?: string
          income_stream?: string | null
          logical_allocation_id?: string
          memo?: string | null
          person_key?: string | null
          property_unit?: string | null
          record_status?: string
          revision_number?: number
          supersedes_allocation_id?: string | null
          tax_treatment?: string
          tax_year?: number | null
          transaction_id: string
        }
        Update: {
          allocation_type?: string
          amount_cents?: number
          category_code?: string
          classification_rule_id?: string | null
          created_at?: string
          created_by?: string
          evidence_object_id?: string | null
          household_id?: string
          human_decision_id?: string | null
          id?: string
          income_stream?: string | null
          logical_allocation_id?: string
          memo?: string | null
          person_key?: string | null
          property_unit?: string | null
          record_status?: string
          revision_number?: number
          supersedes_allocation_id?: string | null
          tax_treatment?: string
          tax_year?: number | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_allocations_decision_same_household_fkey"
            columns: ["household_id", "human_decision_id"]
            isOneToOne: false
            referencedRelation: "finance_current_human_decisions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_decision_same_household_fkey"
            columns: ["household_id", "human_decision_id"]
            isOneToOne: false
            referencedRelation: "finance_human_decisions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_allocations_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_allocations_rule_same_household_fkey"
            columns: ["household_id", "classification_rule_id"]
            isOneToOne: false
            referencedRelation: "finance_classification_rules"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_rule_same_household_fkey"
            columns: ["household_id", "classification_rule_id"]
            isOneToOne: false
            referencedRelation: "finance_current_classification_rules"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_allocation_id"]
            isOneToOne: false
            referencedRelation: "finance_allocations"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_allocation_id"]
            isOneToOne: false
            referencedRelation: "finance_current_allocations"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_allocation_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_allocations"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_transaction_same_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_current_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_transaction_same_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_transaction_same_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transaction_balances"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_transaction_same_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_classification_rules: {
        Row: {
          created_at: string
          created_by: string
          created_from_decision_id: string | null
          financial_account_id: string | null
          household_id: string
          id: string
          logical_rule_id: string
          match_conditions: Json
          name: string
          priority: number
          record_status: string
          revision_number: number
          rule_actions: Json
          rule_status: string
          source_id: string | null
          supersedes_rule_id: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          created_from_decision_id?: string | null
          financial_account_id?: string | null
          household_id: string
          id?: string
          logical_rule_id?: string
          match_conditions: Json
          name: string
          priority?: number
          record_status?: string
          revision_number?: number
          rule_actions: Json
          rule_status?: string
          source_id?: string | null
          supersedes_rule_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          created_from_decision_id?: string | null
          financial_account_id?: string | null
          household_id?: string
          id?: string
          logical_rule_id?: string
          match_conditions?: Json
          name?: string
          priority?: number
          record_status?: string
          revision_number?: number
          rule_actions?: Json
          rule_status?: string
          source_id?: string | null
          supersedes_rule_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_classification_rules_account_same_household_fkey"
            columns: ["household_id", "financial_account_id"]
            isOneToOne: false
            referencedRelation: "finance_current_accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_classification_rules_account_same_household_fkey"
            columns: ["household_id", "financial_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_classification_rules_decision_same_household_fkey"
            columns: ["household_id", "created_from_decision_id"]
            isOneToOne: false
            referencedRelation: "finance_current_human_decisions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_classification_rules_decision_same_household_fkey"
            columns: ["household_id", "created_from_decision_id"]
            isOneToOne: false
            referencedRelation: "finance_human_decisions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_classification_rules_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_classification_rules_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_classification_rules_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_current_sources"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_classification_rules_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_source_health"
            referencedColumns: ["household_id", "source_id"]
          },
          {
            foreignKeyName: "finance_classification_rules_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_sources"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_classification_rules_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_rule_id"]
            isOneToOne: false
            referencedRelation: "finance_classification_rules"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_classification_rules_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_rule_id"]
            isOneToOne: false
            referencedRelation: "finance_current_classification_rules"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_close_periods: {
        Row: {
          close_status: string
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string
          household_id: string
          id: string
          logical_close_period_id: string
          notes: string | null
          period_end_on: string
          period_start_on: string
          record_status: string
          revision_number: number
          supersedes_close_period_id: string | null
        }
        Insert: {
          close_status?: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by: string
          household_id: string
          id?: string
          logical_close_period_id?: string
          notes?: string | null
          period_end_on: string
          period_start_on: string
          record_status?: string
          revision_number?: number
          supersedes_close_period_id?: string | null
        }
        Update: {
          close_status?: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string
          household_id?: string
          id?: string
          logical_close_period_id?: string
          notes?: string | null
          period_end_on?: string
          period_start_on?: string
          record_status?: string
          revision_number?: number
          supersedes_close_period_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_close_periods_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_close_periods_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_close_periods_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_close_period_id"]
            isOneToOne: false
            referencedRelation: "finance_close_periods"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_document_line_items: {
        Row: {
          created_at: string
          created_by: string
          description: string
          document_id: string
          document_page_id: string | null
          extraction_metadata: Json
          gross_cents: number | null
          household_id: string
          id: string
          line_number: number
          logical_line_item_id: string
          merchant_sku: string | null
          net_cents: number | null
          proposed_category: string | null
          proposed_use: string | null
          quantity: number | null
          record_status: string
          revision_number: number
          supersedes_line_item_id: string | null
          unit_price_cents: number | null
          vat_cents: number | null
        }
        Insert: {
          created_at?: string
          created_by: string
          description: string
          document_id: string
          document_page_id?: string | null
          extraction_metadata?: Json
          gross_cents?: number | null
          household_id: string
          id?: string
          line_number: number
          logical_line_item_id?: string
          merchant_sku?: string | null
          net_cents?: number | null
          proposed_category?: string | null
          proposed_use?: string | null
          quantity?: number | null
          record_status?: string
          revision_number?: number
          supersedes_line_item_id?: string | null
          unit_price_cents?: number | null
          vat_cents?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string
          document_id?: string
          document_page_id?: string | null
          extraction_metadata?: Json
          gross_cents?: number | null
          household_id?: string
          id?: string
          line_number?: number
          logical_line_item_id?: string
          merchant_sku?: string | null
          net_cents?: number | null
          proposed_category?: string | null
          proposed_use?: string | null
          quantity?: number | null
          record_status?: string
          revision_number?: number
          supersedes_line_item_id?: string | null
          unit_price_cents?: number | null
          vat_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_document_line_items_document_same_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_current_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_line_items_document_same_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_line_items_document_same_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_line_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_document_line_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_document_line_items_page_same_household_fkey"
            columns: ["household_id", "document_page_id"]
            isOneToOne: false
            referencedRelation: "finance_current_document_pages"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_line_items_page_same_household_fkey"
            columns: ["household_id", "document_page_id"]
            isOneToOne: false
            referencedRelation: "finance_document_pages"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_line_items_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_line_item_id"]
            isOneToOne: false
            referencedRelation: "finance_current_document_line_items"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_line_items_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_line_item_id"]
            isOneToOne: false
            referencedRelation: "finance_document_line_items"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_document_pages: {
        Row: {
          created_at: string
          created_by: string
          document_id: string
          evidence_object_id: string | null
          extracted_text: string | null
          extraction_metadata: Json
          household_id: string
          id: string
          image_sha256: string | null
          logical_page_id: string
          ocr_method: string | null
          page_number: number
          record_status: string
          revision_number: number
          supersedes_page_id: string | null
          text_sha256: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          document_id: string
          evidence_object_id?: string | null
          extracted_text?: string | null
          extraction_metadata?: Json
          household_id: string
          id?: string
          image_sha256?: string | null
          logical_page_id?: string
          ocr_method?: string | null
          page_number: number
          record_status?: string
          revision_number?: number
          supersedes_page_id?: string | null
          text_sha256?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          document_id?: string
          evidence_object_id?: string | null
          extracted_text?: string | null
          extraction_metadata?: Json
          household_id?: string
          id?: string
          image_sha256?: string | null
          logical_page_id?: string
          ocr_method?: string | null
          page_number?: number
          record_status?: string
          revision_number?: number
          supersedes_page_id?: string | null
          text_sha256?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_document_pages_document_same_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_current_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_pages_document_same_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_pages_document_same_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_pages_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_pages_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_pages_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_pages_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_document_pages_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_document_pages_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_page_id"]
            isOneToOne: false
            referencedRelation: "finance_current_document_pages"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_pages_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_page_id"]
            isOneToOne: false
            referencedRelation: "finance_document_pages"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_document_relationships: {
        Row: {
          confidence: number | null
          created_at: string
          created_by: string
          from_document_id: string
          household_id: string
          id: string
          logical_relationship_id: string
          rationale: string | null
          record_status: string
          related_amount_cents: number | null
          relationship_type: string
          revision_number: number
          supersedes_relationship_id: string | null
          to_document_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          created_by: string
          from_document_id: string
          household_id: string
          id?: string
          logical_relationship_id?: string
          rationale?: string | null
          record_status?: string
          related_amount_cents?: number | null
          relationship_type: string
          revision_number?: number
          supersedes_relationship_id?: string | null
          to_document_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          created_by?: string
          from_document_id?: string
          household_id?: string
          id?: string
          logical_relationship_id?: string
          rationale?: string | null
          record_status?: string
          related_amount_cents?: number | null
          relationship_type?: string
          revision_number?: number
          supersedes_relationship_id?: string | null
          to_document_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_document_relationships_from_same_household_fkey"
            columns: ["household_id", "from_document_id"]
            isOneToOne: false
            referencedRelation: "finance_current_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_relationships_from_same_household_fkey"
            columns: ["household_id", "from_document_id"]
            isOneToOne: false
            referencedRelation: "finance_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_relationships_from_same_household_fkey"
            columns: ["household_id", "from_document_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_relationships_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_document_relationships_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_document_relationships_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_relationship_id"]
            isOneToOne: false
            referencedRelation: "finance_document_relationships"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_relationships_to_same_household_fkey"
            columns: ["household_id", "to_document_id"]
            isOneToOne: false
            referencedRelation: "finance_current_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_relationships_to_same_household_fkey"
            columns: ["household_id", "to_document_id"]
            isOneToOne: false
            referencedRelation: "finance_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_relationships_to_same_household_fkey"
            columns: ["household_id", "to_document_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_documents"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_documents: {
        Row: {
          created_at: string
          created_by: string
          currency: string
          document_number: string | null
          document_type: string
          due_on: string | null
          evidence_object_id: string
          extracted_metadata: Json
          extraction_confidence: number | null
          extraction_method: string | null
          household_id: string
          id: string
          issued_on: string | null
          issuer_name: string | null
          logical_document_id: string
          normalized_text_sha256: string | null
          payment_status: string | null
          recipient_name: string | null
          record_status: string
          revision_number: number
          service_end_on: string | null
          service_start_on: string | null
          subtotal_cents: number | null
          supersedes_document_id: string | null
          total_cents: number | null
          vat_cents: number | null
        }
        Insert: {
          created_at?: string
          created_by: string
          currency?: string
          document_number?: string | null
          document_type: string
          due_on?: string | null
          evidence_object_id: string
          extracted_metadata?: Json
          extraction_confidence?: number | null
          extraction_method?: string | null
          household_id: string
          id?: string
          issued_on?: string | null
          issuer_name?: string | null
          logical_document_id?: string
          normalized_text_sha256?: string | null
          payment_status?: string | null
          recipient_name?: string | null
          record_status?: string
          revision_number?: number
          service_end_on?: string | null
          service_start_on?: string | null
          subtotal_cents?: number | null
          supersedes_document_id?: string | null
          total_cents?: number | null
          vat_cents?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string
          currency?: string
          document_number?: string | null
          document_type?: string
          due_on?: string | null
          evidence_object_id?: string
          extracted_metadata?: Json
          extraction_confidence?: number | null
          extraction_method?: string | null
          household_id?: string
          id?: string
          issued_on?: string | null
          issuer_name?: string | null
          logical_document_id?: string
          normalized_text_sha256?: string | null
          payment_status?: string | null
          recipient_name?: string | null
          record_status?: string
          revision_number?: number
          service_end_on?: string | null
          service_start_on?: string | null
          subtotal_cents?: number | null
          supersedes_document_id?: string | null
          total_cents?: number | null
          vat_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_documents_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_documents_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_documents_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_documents_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_documents_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_documents_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_document_id"]
            isOneToOne: false
            referencedRelation: "finance_current_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_documents_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_document_id"]
            isOneToOne: false
            referencedRelation: "finance_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_documents_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_document_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_documents"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_evidence_objects: {
        Row: {
          acquired_at: string
          byte_size: number | null
          created_at: string
          created_by: string
          duplicate_of_evidence_id: string | null
          evidence_kind: string
          exact_sha256: string
          has_local_copy: boolean | null
          has_storage_copy: boolean | null
          household_id: string
          id: string
          import_record_id: string | null
          import_run_id: string | null
          last_verified_at: string | null
          local_path: string | null
          logical_evidence_id: string
          media_type: string | null
          metadata: Json
          normalized_sha256: string | null
          original_filename: string | null
          page_text_sha256: string | null
          record_status: string
          retention_status: string
          revision_number: number
          source_created_at: string | null
          source_id: string | null
          source_object_key: string | null
          storage_bucket: string | null
          storage_path: string | null
          supersedes_evidence_id: string | null
        }
        Insert: {
          acquired_at?: string
          byte_size?: number | null
          created_at?: string
          created_by: string
          duplicate_of_evidence_id?: string | null
          evidence_kind: string
          exact_sha256: string
          has_local_copy?: boolean | null
          has_storage_copy?: boolean | null
          household_id: string
          id?: string
          import_record_id?: string | null
          import_run_id?: string | null
          last_verified_at?: string | null
          local_path?: string | null
          logical_evidence_id?: string
          media_type?: string | null
          metadata?: Json
          normalized_sha256?: string | null
          original_filename?: string | null
          page_text_sha256?: string | null
          record_status?: string
          retention_status?: string
          revision_number?: number
          source_created_at?: string | null
          source_id?: string | null
          source_object_key?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          supersedes_evidence_id?: string | null
        }
        Update: {
          acquired_at?: string
          byte_size?: number | null
          created_at?: string
          created_by?: string
          duplicate_of_evidence_id?: string | null
          evidence_kind?: string
          exact_sha256?: string
          has_local_copy?: boolean | null
          has_storage_copy?: boolean | null
          household_id?: string
          id?: string
          import_record_id?: string | null
          import_run_id?: string | null
          last_verified_at?: string | null
          local_path?: string | null
          logical_evidence_id?: string
          media_type?: string | null
          metadata?: Json
          normalized_sha256?: string | null
          original_filename?: string | null
          page_text_sha256?: string | null
          record_status?: string
          retention_status?: string
          revision_number?: number
          source_created_at?: string | null
          source_id?: string | null
          source_object_key?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          supersedes_evidence_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_evidence_objects_duplicate_same_household_fkey"
            columns: ["household_id", "duplicate_of_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_duplicate_same_household_fkey"
            columns: ["household_id", "duplicate_of_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_duplicate_same_household_fkey"
            columns: ["household_id", "duplicate_of_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_import_record_same_household_fkey"
            columns: ["household_id", "import_record_id"]
            isOneToOne: false
            referencedRelation: "finance_import_records"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_run_same_household_fkey"
            columns: ["household_id", "import_run_id"]
            isOneToOne: false
            referencedRelation: "finance_current_import_runs"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_run_same_household_fkey"
            columns: ["household_id", "import_run_id"]
            isOneToOne: false
            referencedRelation: "finance_import_runs"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_current_sources"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_source_health"
            referencedColumns: ["household_id", "source_id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_sources"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_human_decisions: {
        Row: {
          answer_text: string
          answered_at: string
          answered_by: string
          application_scope: string
          created_at: string
          decision_context: Json
          household_id: string
          id: string
          logical_decision_id: string
          question_snapshot: string
          record_status: string
          review_item_id: string
          revision_number: number
          selected_option: string | null
          supersedes_decision_id: string | null
        }
        Insert: {
          answer_text: string
          answered_at?: string
          answered_by: string
          application_scope?: string
          created_at?: string
          decision_context?: Json
          household_id: string
          id?: string
          logical_decision_id?: string
          question_snapshot: string
          record_status?: string
          review_item_id: string
          revision_number?: number
          selected_option?: string | null
          supersedes_decision_id?: string | null
        }
        Update: {
          answer_text?: string
          answered_at?: string
          answered_by?: string
          application_scope?: string
          created_at?: string
          decision_context?: Json
          household_id?: string
          id?: string
          logical_decision_id?: string
          question_snapshot?: string
          record_status?: string
          review_item_id?: string
          revision_number?: number
          selected_option?: string | null
          supersedes_decision_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_human_decisions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_human_decisions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_human_decisions_review_same_household_fkey"
            columns: ["household_id", "review_item_id"]
            isOneToOne: false
            referencedRelation: "finance_anomaly_inbox"
            referencedColumns: ["household_id", "review_item_id"]
          },
          {
            foreignKeyName: "finance_human_decisions_review_same_household_fkey"
            columns: ["household_id", "review_item_id"]
            isOneToOne: false
            referencedRelation: "finance_current_review_items"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_human_decisions_review_same_household_fkey"
            columns: ["household_id", "review_item_id"]
            isOneToOne: false
            referencedRelation: "finance_review_items"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_human_decisions_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_decision_id"]
            isOneToOne: false
            referencedRelation: "finance_current_human_decisions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_human_decisions_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_decision_id"]
            isOneToOne: false
            referencedRelation: "finance_human_decisions"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_import_records: {
        Row: {
          created_at: string
          household_id: string
          id: string
          import_run_id: string
          logical_import_record_id: string
          occurred_at: string | null
          payload_sha256: string
          raw_payload: Json
          record_status: string
          record_type: string
          revision_number: number
          source_id: string
          source_locator: Json
          source_record_key: string
          supersedes_import_record_id: string | null
        }
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          import_run_id: string
          logical_import_record_id?: string
          occurred_at?: string | null
          payload_sha256: string
          raw_payload?: Json
          record_status?: string
          record_type: string
          revision_number?: number
          source_id: string
          source_locator?: Json
          source_record_key: string
          supersedes_import_record_id?: string | null
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          import_run_id?: string
          logical_import_record_id?: string
          occurred_at?: string | null
          payload_sha256?: string
          raw_payload?: Json
          record_status?: string
          record_type?: string
          revision_number?: number
          source_id?: string
          source_locator?: Json
          source_record_key?: string
          supersedes_import_record_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_import_records_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_import_records_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_import_records_run_same_household_fkey"
            columns: ["household_id", "import_run_id"]
            isOneToOne: false
            referencedRelation: "finance_current_import_runs"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_import_records_run_same_household_fkey"
            columns: ["household_id", "import_run_id"]
            isOneToOne: false
            referencedRelation: "finance_import_runs"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_import_records_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_current_sources"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_import_records_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_source_health"
            referencedColumns: ["household_id", "source_id"]
          },
          {
            foreignKeyName: "finance_import_records_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_sources"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_import_records_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_import_record_id"]
            isOneToOne: false
            referencedRelation: "finance_import_records"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_import_runs: {
        Row: {
          adapter_name: string
          adapter_version: string
          completed_at: string | null
          coverage_end_on: string | null
          coverage_start_on: string | null
          created_at: string
          created_by: string
          discovered_record_count: number
          duplicate_record_count: number
          error_summary: Json
          financial_account_id: string | null
          household_id: string
          id: string
          import_mode: string
          inserted_record_count: number
          logical_import_id: string
          record_status: string
          review_record_count: number
          revision_number: number
          run_key: string
          run_status: string
          source_fingerprint: string
          source_id: string
          started_at: string
          supersedes_import_run_id: string | null
        }
        Insert: {
          adapter_name: string
          adapter_version: string
          completed_at?: string | null
          coverage_end_on?: string | null
          coverage_start_on?: string | null
          created_at?: string
          created_by: string
          discovered_record_count?: number
          duplicate_record_count?: number
          error_summary?: Json
          financial_account_id?: string | null
          household_id: string
          id?: string
          import_mode: string
          inserted_record_count?: number
          logical_import_id?: string
          record_status?: string
          review_record_count?: number
          revision_number?: number
          run_key: string
          run_status: string
          source_fingerprint: string
          source_id: string
          started_at: string
          supersedes_import_run_id?: string | null
        }
        Update: {
          adapter_name?: string
          adapter_version?: string
          completed_at?: string | null
          coverage_end_on?: string | null
          coverage_start_on?: string | null
          created_at?: string
          created_by?: string
          discovered_record_count?: number
          duplicate_record_count?: number
          error_summary?: Json
          financial_account_id?: string | null
          household_id?: string
          id?: string
          import_mode?: string
          inserted_record_count?: number
          logical_import_id?: string
          record_status?: string
          review_record_count?: number
          revision_number?: number
          run_key?: string
          run_status?: string
          source_fingerprint?: string
          source_id?: string
          started_at?: string
          supersedes_import_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_import_runs_account_same_household_fkey"
            columns: ["household_id", "financial_account_id"]
            isOneToOne: false
            referencedRelation: "finance_current_accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_import_runs_account_same_household_fkey"
            columns: ["household_id", "financial_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_import_runs_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_import_runs_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_import_runs_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_current_sources"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_import_runs_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_source_health"
            referencedColumns: ["household_id", "source_id"]
          },
          {
            foreignKeyName: "finance_import_runs_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_sources"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_import_runs_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_import_run_id"]
            isOneToOne: false
            referencedRelation: "finance_current_import_runs"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_import_runs_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_import_run_id"]
            isOneToOne: false
            referencedRelation: "finance_import_runs"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_review_items: {
        Row: {
          ambiguity_reason: string
          amount_cents: number | null
          answer_options: Json
          assigned_to: string | null
          context_snapshot: Json
          created_at: string
          created_by: string
          document_id: string | null
          due_at: string | null
          evidence_object_id: string | null
          household_id: string
          id: string
          logical_review_item_id: string
          priority: string
          priority_score: number
          proposed_interpretation: string | null
          question: string
          record_status: string
          review_type: string
          revision_number: number
          supersedes_review_item_id: string | null
          tax_impact_cents: number | null
          title: string
          transaction_id: string | null
          workflow_status: string
        }
        Insert: {
          ambiguity_reason: string
          amount_cents?: number | null
          answer_options?: Json
          assigned_to?: string | null
          context_snapshot?: Json
          created_at?: string
          created_by: string
          document_id?: string | null
          due_at?: string | null
          evidence_object_id?: string | null
          household_id: string
          id?: string
          logical_review_item_id?: string
          priority?: string
          priority_score?: number
          proposed_interpretation?: string | null
          question: string
          record_status?: string
          review_type: string
          revision_number?: number
          supersedes_review_item_id?: string | null
          tax_impact_cents?: number | null
          title: string
          transaction_id?: string | null
          workflow_status?: string
        }
        Update: {
          ambiguity_reason?: string
          amount_cents?: number | null
          answer_options?: Json
          assigned_to?: string | null
          context_snapshot?: Json
          created_at?: string
          created_by?: string
          document_id?: string | null
          due_at?: string | null
          evidence_object_id?: string | null
          household_id?: string
          id?: string
          logical_review_item_id?: string
          priority?: string
          priority_score?: number
          proposed_interpretation?: string | null
          question?: string
          record_status?: string
          review_type?: string
          revision_number?: number
          supersedes_review_item_id?: string | null
          tax_impact_cents?: number | null
          title?: string
          transaction_id?: string | null
          workflow_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_review_items_document_same_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_current_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_document_same_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_document_same_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_review_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_review_items_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_review_item_id"]
            isOneToOne: false
            referencedRelation: "finance_anomaly_inbox"
            referencedColumns: ["household_id", "review_item_id"]
          },
          {
            foreignKeyName: "finance_review_items_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_review_item_id"]
            isOneToOne: false
            referencedRelation: "finance_current_review_items"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_review_item_id"]
            isOneToOne: false
            referencedRelation: "finance_review_items"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_transaction_same_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_current_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_transaction_same_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_transaction_same_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transaction_balances"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_transaction_same_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_review_question_numbers: {
        Row: {
          assigned_at: string
          assigned_from_review_item_id: string
          household_id: string
          id: string
          logical_review_item_id: string
          question_number: number
        }
        Insert: {
          assigned_at?: string
          assigned_from_review_item_id: string
          household_id: string
          id?: string
          logical_review_item_id: string
          question_number?: number
        }
        Update: {
          assigned_at?: string
          assigned_from_review_item_id?: string
          household_id?: string
          id?: string
          logical_review_item_id?: string
          question_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "finance_review_question_numbers_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_review_question_numbers_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_review_question_numbers_review_same_household_fkey"
            columns: ["household_id", "assigned_from_review_item_id"]
            isOneToOne: false
            referencedRelation: "finance_anomaly_inbox"
            referencedColumns: ["household_id", "review_item_id"]
          },
          {
            foreignKeyName: "finance_review_question_numbers_review_same_household_fkey"
            columns: ["household_id", "assigned_from_review_item_id"]
            isOneToOne: false
            referencedRelation: "finance_current_review_items"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_question_numbers_review_same_household_fkey"
            columns: ["household_id", "assigned_from_review_item_id"]
            isOneToOne: false
            referencedRelation: "finance_review_items"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_sources: {
        Row: {
          connection_mode: string
          connection_status: string
          coverage_end_on: string | null
          coverage_start_on: string | null
          created_at: string
          created_by: string
          credential_reference: string | null
          display_name: string
          expected_frequency: string | null
          health_summary: Json
          household_id: string
          id: string
          last_checked_at: string | null
          last_success_at: string | null
          logical_source_id: string
          owner_scope: string
          record_status: string
          revision_number: number
          source_type: string
          supersedes_source_id: string | null
        }
        Insert: {
          connection_mode?: string
          connection_status?: string
          coverage_end_on?: string | null
          coverage_start_on?: string | null
          created_at?: string
          created_by: string
          credential_reference?: string | null
          display_name: string
          expected_frequency?: string | null
          health_summary?: Json
          household_id: string
          id?: string
          last_checked_at?: string | null
          last_success_at?: string | null
          logical_source_id?: string
          owner_scope?: string
          record_status?: string
          revision_number?: number
          source_type: string
          supersedes_source_id?: string | null
        }
        Update: {
          connection_mode?: string
          connection_status?: string
          coverage_end_on?: string | null
          coverage_start_on?: string | null
          created_at?: string
          created_by?: string
          credential_reference?: string | null
          display_name?: string
          expected_frequency?: string | null
          health_summary?: Json
          household_id?: string
          id?: string
          last_checked_at?: string | null
          last_success_at?: string | null
          logical_source_id?: string
          owner_scope?: string
          record_status?: string
          revision_number?: number
          source_type?: string
          supersedes_source_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_sources_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_sources_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_sources_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_source_id"]
            isOneToOne: false
            referencedRelation: "finance_current_sources"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_sources_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_source_id"]
            isOneToOne: false
            referencedRelation: "finance_source_health"
            referencedColumns: ["household_id", "source_id"]
          },
          {
            foreignKeyName: "finance_sources_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_source_id"]
            isOneToOne: false
            referencedRelation: "finance_sources"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_submission_pack_items: {
        Row: {
          created_at: string
          created_by: string
          display_order: number
          evidence_object_id: string
          household_id: string
          id: string
          item_label: string
          item_type: string
          submission_pack_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          display_order?: number
          evidence_object_id: string
          household_id: string
          id?: string
          item_label: string
          item_type: string
          submission_pack_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          display_order?: number
          evidence_object_id?: string
          household_id?: string
          id?: string
          item_label?: string
          item_type?: string
          submission_pack_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_submission_pack_items_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_pack_items_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_pack_items_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_pack_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_submission_pack_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_submission_pack_items_pack_same_household_fkey"
            columns: ["household_id", "submission_pack_id"]
            isOneToOne: false
            referencedRelation: "finance_current_submission_packs"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_pack_items_pack_same_household_fkey"
            columns: ["household_id", "submission_pack_id"]
            isOneToOne: false
            referencedRelation: "finance_submission_packs"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_submission_packs: {
        Row: {
          accountant_workbook_evidence_id: string | null
          approved_at: string | null
          approved_by: string | null
          cover_email_evidence_id: string | null
          created_at: string
          created_by: string
          evidence_zip_evidence_id: string | null
          generated_at: string | null
          household_id: string
          id: string
          logical_submission_pack_id: string
          manifest_evidence_id: string | null
          manifest_sha256: string | null
          pack_name: string
          pack_status: string
          record_status: string
          revision_number: number
          sent_at: string | null
          supersedes_submission_pack_id: string | null
          tax_scenario_id: string
        }
        Insert: {
          accountant_workbook_evidence_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          cover_email_evidence_id?: string | null
          created_at?: string
          created_by: string
          evidence_zip_evidence_id?: string | null
          generated_at?: string | null
          household_id: string
          id?: string
          logical_submission_pack_id?: string
          manifest_evidence_id?: string | null
          manifest_sha256?: string | null
          pack_name: string
          pack_status?: string
          record_status?: string
          revision_number?: number
          sent_at?: string | null
          supersedes_submission_pack_id?: string | null
          tax_scenario_id: string
        }
        Update: {
          accountant_workbook_evidence_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          cover_email_evidence_id?: string | null
          created_at?: string
          created_by?: string
          evidence_zip_evidence_id?: string | null
          generated_at?: string | null
          household_id?: string
          id?: string
          logical_submission_pack_id?: string
          manifest_evidence_id?: string | null
          manifest_sha256?: string | null
          pack_name?: string
          pack_status?: string
          record_status?: string
          revision_number?: number
          sent_at?: string | null
          supersedes_submission_pack_id?: string | null
          tax_scenario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_submission_packs_email_same_household_fkey"
            columns: ["household_id", "cover_email_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_email_same_household_fkey"
            columns: ["household_id", "cover_email_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_email_same_household_fkey"
            columns: ["household_id", "cover_email_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_submission_packs_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_submission_packs_manifest_same_household_fkey"
            columns: ["household_id", "manifest_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_manifest_same_household_fkey"
            columns: ["household_id", "manifest_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_manifest_same_household_fkey"
            columns: ["household_id", "manifest_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_scenario_same_household_fkey"
            columns: ["household_id", "tax_scenario_id"]
            isOneToOne: false
            referencedRelation: "finance_current_tax_scenarios"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_scenario_same_household_fkey"
            columns: ["household_id", "tax_scenario_id"]
            isOneToOne: false
            referencedRelation: "finance_tax_scenarios"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_submission_pack_id"]
            isOneToOne: false
            referencedRelation: "finance_current_submission_packs"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_submission_pack_id"]
            isOneToOne: false
            referencedRelation: "finance_submission_packs"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_workbook_same_household_fkey"
            columns: ["household_id", "accountant_workbook_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_workbook_same_household_fkey"
            columns: ["household_id", "accountant_workbook_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_workbook_same_household_fkey"
            columns: ["household_id", "accountant_workbook_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_zip_same_household_fkey"
            columns: ["household_id", "evidence_zip_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_zip_same_household_fkey"
            columns: ["household_id", "evidence_zip_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_zip_same_household_fkey"
            columns: ["household_id", "evidence_zip_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_tax_scenario_line_allocations: {
        Row: {
          allocation_id: string
          created_at: string
          created_by: string
          household_id: string
          id: string
          included_amount_cents: number
          tax_scenario_line_id: string
        }
        Insert: {
          allocation_id: string
          created_at?: string
          created_by: string
          household_id: string
          id?: string
          included_amount_cents: number
          tax_scenario_line_id: string
        }
        Update: {
          allocation_id?: string
          created_at?: string
          created_by?: string
          household_id?: string
          id?: string
          included_amount_cents?: number
          tax_scenario_line_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_tax_line_allocations_allocation_household_fkey"
            columns: ["household_id", "allocation_id"]
            isOneToOne: false
            referencedRelation: "finance_allocations"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tax_line_allocations_allocation_household_fkey"
            columns: ["household_id", "allocation_id"]
            isOneToOne: false
            referencedRelation: "finance_current_allocations"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tax_line_allocations_allocation_household_fkey"
            columns: ["household_id", "allocation_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_allocations"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tax_scenario_line_allocations_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_tax_scenario_line_allocations_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_tax_scenario_line_allocations_line_same_household_fkey"
            columns: ["household_id", "tax_scenario_line_id"]
            isOneToOne: false
            referencedRelation: "finance_current_tax_scenario_lines"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tax_scenario_line_allocations_line_same_household_fkey"
            columns: ["household_id", "tax_scenario_line_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_tax_scenario_lines"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tax_scenario_line_allocations_line_same_household_fkey"
            columns: ["household_id", "tax_scenario_line_id"]
            isOneToOne: false
            referencedRelation: "finance_tax_scenario_lines"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_tax_scenario_lines: {
        Row: {
          amount_cents: number
          category_code: string
          created_at: string
          created_by: string
          household_id: string
          id: string
          label: string
          line_metadata: Json
          line_type: string
          logical_tax_scenario_line_id: string
          person_key: string
          record_status: string
          revision_number: number
          supersedes_tax_scenario_line_id: string | null
          tax_scenario_id: string
          tax_treatment: string
        }
        Insert: {
          amount_cents: number
          category_code: string
          created_at?: string
          created_by: string
          household_id: string
          id?: string
          label: string
          line_metadata?: Json
          line_type: string
          logical_tax_scenario_line_id?: string
          person_key: string
          record_status?: string
          revision_number?: number
          supersedes_tax_scenario_line_id?: string | null
          tax_scenario_id: string
          tax_treatment: string
        }
        Update: {
          amount_cents?: number
          category_code?: string
          created_at?: string
          created_by?: string
          household_id?: string
          id?: string
          label?: string
          line_metadata?: Json
          line_type?: string
          logical_tax_scenario_line_id?: string
          person_key?: string
          record_status?: string
          revision_number?: number
          supersedes_tax_scenario_line_id?: string | null
          tax_scenario_id?: string
          tax_treatment?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_tax_scenario_lines_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_tax_scenario_lines_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_tax_scenario_lines_scenario_same_household_fkey"
            columns: ["household_id", "tax_scenario_id"]
            isOneToOne: false
            referencedRelation: "finance_current_tax_scenarios"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tax_scenario_lines_scenario_same_household_fkey"
            columns: ["household_id", "tax_scenario_id"]
            isOneToOne: false
            referencedRelation: "finance_tax_scenarios"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tax_scenario_lines_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_tax_scenario_line_id"]
            isOneToOne: false
            referencedRelation: "finance_current_tax_scenario_lines"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tax_scenario_lines_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_tax_scenario_line_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_tax_scenario_lines"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tax_scenario_lines_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_tax_scenario_line_id"]
            isOneToOne: false
            referencedRelation: "finance_tax_scenario_lines"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_tax_scenarios: {
        Row: {
          accrued_management_fee_cents: number | null
          calculated_at: string | null
          calculated_management_fee_cents: number | null
          calculation_basis: Json
          combined_household_tax_cents: number | null
          created_at: string
          created_by: string
          household_id: string
          id: string
          jane_taxable_income_cents: number | null
          logical_tax_scenario_id: string
          paid_management_fee_cents: number | null
          period_end_on: string
          period_start_on: string
          provisional_period: string
          record_status: string
          revision_number: number
          scenario_name: string
          scenario_status: string
          scenario_type: string
          supersedes_tax_scenario_id: string | null
          tax_year: number
          tristan_taxable_income_cents: number | null
          warnings: Json
        }
        Insert: {
          accrued_management_fee_cents?: number | null
          calculated_at?: string | null
          calculated_management_fee_cents?: number | null
          calculation_basis?: Json
          combined_household_tax_cents?: number | null
          created_at?: string
          created_by: string
          household_id: string
          id?: string
          jane_taxable_income_cents?: number | null
          logical_tax_scenario_id?: string
          paid_management_fee_cents?: number | null
          period_end_on: string
          period_start_on: string
          provisional_period: string
          record_status?: string
          revision_number?: number
          scenario_name: string
          scenario_status?: string
          scenario_type: string
          supersedes_tax_scenario_id?: string | null
          tax_year: number
          tristan_taxable_income_cents?: number | null
          warnings?: Json
        }
        Update: {
          accrued_management_fee_cents?: number | null
          calculated_at?: string | null
          calculated_management_fee_cents?: number | null
          calculation_basis?: Json
          combined_household_tax_cents?: number | null
          created_at?: string
          created_by?: string
          household_id?: string
          id?: string
          jane_taxable_income_cents?: number | null
          logical_tax_scenario_id?: string
          paid_management_fee_cents?: number | null
          period_end_on?: string
          period_start_on?: string
          provisional_period?: string
          record_status?: string
          revision_number?: number
          scenario_name?: string
          scenario_status?: string
          scenario_type?: string
          supersedes_tax_scenario_id?: string | null
          tax_year?: number
          tristan_taxable_income_cents?: number | null
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "finance_tax_scenarios_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_tax_scenarios_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_tax_scenarios_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_tax_scenario_id"]
            isOneToOne: false
            referencedRelation: "finance_current_tax_scenarios"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tax_scenarios_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_tax_scenario_id"]
            isOneToOne: false
            referencedRelation: "finance_tax_scenarios"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_transaction_document_matches: {
        Row: {
          confidence: number | null
          created_at: string
          created_by: string
          document_id: string
          household_id: string
          human_decision_id: string | null
          id: string
          logical_match_id: string
          match_status: string
          match_type: string
          matched_amount_cents: number | null
          rationale: string | null
          record_status: string
          revision_number: number
          supersedes_match_id: string | null
          transaction_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          created_by: string
          document_id: string
          household_id: string
          human_decision_id?: string | null
          id?: string
          logical_match_id?: string
          match_status?: string
          match_type: string
          matched_amount_cents?: number | null
          rationale?: string | null
          record_status?: string
          revision_number?: number
          supersedes_match_id?: string | null
          transaction_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          created_by?: string
          document_id?: string
          household_id?: string
          human_decision_id?: string | null
          id?: string
          logical_match_id?: string
          match_status?: string
          match_type?: string
          matched_amount_cents?: number | null
          rationale?: string | null
          record_status?: string
          revision_number?: number
          supersedes_match_id?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_transaction_document_matches_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_transaction_document_matches_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_tx_doc_matches_decision_household_fkey"
            columns: ["household_id", "human_decision_id"]
            isOneToOne: false
            referencedRelation: "finance_current_human_decisions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tx_doc_matches_decision_household_fkey"
            columns: ["household_id", "human_decision_id"]
            isOneToOne: false
            referencedRelation: "finance_human_decisions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tx_doc_matches_document_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_current_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tx_doc_matches_document_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tx_doc_matches_document_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tx_doc_matches_supersedes_household_fkey"
            columns: ["household_id", "supersedes_match_id"]
            isOneToOne: false
            referencedRelation: "finance_current_transaction_document_matches"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tx_doc_matches_supersedes_household_fkey"
            columns: ["household_id", "supersedes_match_id"]
            isOneToOne: false
            referencedRelation: "finance_transaction_document_matches"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tx_doc_matches_transaction_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_current_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tx_doc_matches_transaction_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tx_doc_matches_transaction_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transaction_balances"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tx_doc_matches_transaction_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_transaction_relationships: {
        Row: {
          confidence: number | null
          created_at: string
          created_by: string
          from_transaction_id: string
          household_id: string
          id: string
          logical_relationship_id: string
          rationale: string | null
          record_status: string
          related_amount_cents: number | null
          relationship_type: string
          revision_number: number
          supersedes_relationship_id: string | null
          to_transaction_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          created_by: string
          from_transaction_id: string
          household_id: string
          id?: string
          logical_relationship_id?: string
          rationale?: string | null
          record_status?: string
          related_amount_cents?: number | null
          relationship_type: string
          revision_number?: number
          supersedes_relationship_id?: string | null
          to_transaction_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          created_by?: string
          from_transaction_id?: string
          household_id?: string
          id?: string
          logical_relationship_id?: string
          rationale?: string | null
          record_status?: string
          related_amount_cents?: number | null
          relationship_type?: string
          revision_number?: number
          supersedes_relationship_id?: string | null
          to_transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_transaction_relationships_from_same_household_fkey"
            columns: ["household_id", "from_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_current_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transaction_relationships_from_same_household_fkey"
            columns: ["household_id", "from_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transaction_relationships_from_same_household_fkey"
            columns: ["household_id", "from_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transaction_balances"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transaction_relationships_from_same_household_fkey"
            columns: ["household_id", "from_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transaction_relationships_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_transaction_relationships_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transaction_relationships_to_same_household_fkey"
            columns: ["household_id", "to_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_current_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transaction_relationships_to_same_household_fkey"
            columns: ["household_id", "to_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transaction_relationships_to_same_household_fkey"
            columns: ["household_id", "to_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transaction_balances"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transaction_relationships_to_same_household_fkey"
            columns: ["household_id", "to_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tx_relationships_supersedes_household_fkey"
            columns: ["household_id", "supersedes_relationship_id"]
            isOneToOne: false
            referencedRelation: "finance_transaction_relationships"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_transactions: {
        Row: {
          amount_cents: number
          booked_on: string | null
          counterparty_name: string | null
          created_at: string
          created_by: string
          currency: string
          financial_account_id: string
          household_id: string
          id: string
          import_record_id: string | null
          logical_transaction_id: string
          raw_description: string
          raw_payload: Json
          record_status: string
          reference: string | null
          revision_number: number
          running_balance_cents: number | null
          source_event_key: string
          supersedes_transaction_id: string | null
          transaction_at: string
          transaction_kind: string
          value_on: string | null
        }
        Insert: {
          amount_cents: number
          booked_on?: string | null
          counterparty_name?: string | null
          created_at?: string
          created_by: string
          currency?: string
          financial_account_id: string
          household_id: string
          id?: string
          import_record_id?: string | null
          logical_transaction_id?: string
          raw_description?: string
          raw_payload?: Json
          record_status?: string
          reference?: string | null
          revision_number?: number
          running_balance_cents?: number | null
          source_event_key: string
          supersedes_transaction_id?: string | null
          transaction_at: string
          transaction_kind?: string
          value_on?: string | null
        }
        Update: {
          amount_cents?: number
          booked_on?: string | null
          counterparty_name?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          financial_account_id?: string
          household_id?: string
          id?: string
          import_record_id?: string | null
          logical_transaction_id?: string
          raw_description?: string
          raw_payload?: Json
          record_status?: string
          reference?: string | null
          revision_number?: number
          running_balance_cents?: number | null
          source_event_key?: string
          supersedes_transaction_id?: string | null
          transaction_at?: string
          transaction_kind?: string
          value_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_transactions_account_same_household_fkey"
            columns: ["household_id", "financial_account_id"]
            isOneToOne: false
            referencedRelation: "finance_current_accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transactions_account_same_household_fkey"
            columns: ["household_id", "financial_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transactions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_transactions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transactions_import_record_same_household_fkey"
            columns: ["household_id", "import_record_id"]
            isOneToOne: false
            referencedRelation: "finance_import_records"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transactions_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_current_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transactions_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transactions_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transaction_balances"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transactions_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      financial_accounts: {
        Row: {
          account_type: string
          closed_on: string | null
          created_at: string
          created_by: string
          currency: string
          display_name: string
          household_id: string
          id: string
          institution_name: string | null
          logical_account_id: string
          masked_identifier: string | null
          opened_on: string | null
          owner_scope: string
          record_status: string
          revision_number: number
          source_id: string | null
          supersedes_account_id: string | null
        }
        Insert: {
          account_type: string
          closed_on?: string | null
          created_at?: string
          created_by: string
          currency?: string
          display_name: string
          household_id: string
          id?: string
          institution_name?: string | null
          logical_account_id?: string
          masked_identifier?: string | null
          opened_on?: string | null
          owner_scope?: string
          record_status?: string
          revision_number?: number
          source_id?: string | null
          supersedes_account_id?: string | null
        }
        Update: {
          account_type?: string
          closed_on?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          display_name?: string
          household_id?: string
          id?: string
          institution_name?: string | null
          logical_account_id?: string
          masked_identifier?: string | null
          opened_on?: string | null
          owner_scope?: string
          record_status?: string
          revision_number?: number
          source_id?: string | null
          supersedes_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financial_accounts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "financial_accounts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_accounts_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_current_sources"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "financial_accounts_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_source_health"
            referencedColumns: ["household_id", "source_id"]
          },
          {
            foreignKeyName: "financial_accounts_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_sources"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "financial_accounts_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_account_id"]
            isOneToOne: false
            referencedRelation: "finance_current_accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "financial_accounts_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      household_members: {
        Row: {
          created_at: string
          household_id: string
          invited_by: string | null
          joined_at: string | null
          membership_status: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          household_id: string
          invited_by?: string | null
          joined_at?: string | null
          membership_status?: string
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          household_id?: string
          invited_by?: string | null
          joined_at?: string | null
          membership_status?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "household_members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      site_admins: {
        Row: {
          added_at: string
          email: string | null
          user_id: string
        }
        Insert: {
          added_at?: string
          email?: string | null
          user_id: string
        }
        Update: {
          added_at?: string
          email?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      finance_anomaly_inbox: {
        Row: {
          ambiguity_reason: string | null
          amount_cents: number | null
          answer_options: Json | null
          assigned_to: string | null
          context_snapshot: Json | null
          counterparty_name: string | null
          created_at: string | null
          created_by: string | null
          document_id: string | null
          due_at: string | null
          evidence_object_id: string | null
          financial_account_id: string | null
          household_id: string | null
          logical_review_item_id: string | null
          priority: string | null
          priority_score: number | null
          proposed_interpretation: string | null
          question: string | null
          review_item_id: string | null
          review_type: string | null
          revision_number: number | null
          tax_impact_cents: number | null
          title: string | null
          transaction_amount_cents: number | null
          transaction_at: string | null
          transaction_currency: string | null
          transaction_description: string | null
          transaction_id: string | null
          transaction_reference: string | null
          workflow_status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_review_items_document_same_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_current_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_document_same_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_document_same_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_review_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_review_items_transaction_same_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_current_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_transaction_same_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_transaction_same_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transaction_balances"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_transaction_same_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_current_accounts: {
        Row: {
          account_type: string | null
          closed_on: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          display_name: string | null
          household_id: string | null
          id: string | null
          institution_name: string | null
          logical_account_id: string | null
          masked_identifier: string | null
          opened_on: string | null
          owner_scope: string | null
          record_status: string | null
          revision_number: number | null
          source_id: string | null
          supersedes_account_id: string | null
        }
        Insert: {
          account_type?: string | null
          closed_on?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          display_name?: string | null
          household_id?: string | null
          id?: string | null
          institution_name?: string | null
          logical_account_id?: string | null
          masked_identifier?: string | null
          opened_on?: string | null
          owner_scope?: string | null
          record_status?: string | null
          revision_number?: number | null
          source_id?: string | null
          supersedes_account_id?: string | null
        }
        Update: {
          account_type?: string | null
          closed_on?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          display_name?: string | null
          household_id?: string | null
          id?: string | null
          institution_name?: string | null
          logical_account_id?: string | null
          masked_identifier?: string | null
          opened_on?: string | null
          owner_scope?: string | null
          record_status?: string | null
          revision_number?: number | null
          source_id?: string | null
          supersedes_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financial_accounts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "financial_accounts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_accounts_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_current_sources"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "financial_accounts_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_source_health"
            referencedColumns: ["household_id", "source_id"]
          },
          {
            foreignKeyName: "financial_accounts_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_sources"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "financial_accounts_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_account_id"]
            isOneToOne: false
            referencedRelation: "finance_current_accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "financial_accounts_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_current_allocations: {
        Row: {
          allocation_type: string | null
          amount_cents: number | null
          category_code: string | null
          classification_rule_id: string | null
          created_at: string | null
          created_by: string | null
          evidence_object_id: string | null
          household_id: string | null
          human_decision_id: string | null
          id: string | null
          income_stream: string | null
          logical_allocation_id: string | null
          memo: string | null
          person_key: string | null
          property_unit: string | null
          record_status: string | null
          revision_number: number | null
          supersedes_allocation_id: string | null
          tax_treatment: string | null
          tax_year: number | null
          transaction_id: string | null
        }
        Insert: {
          allocation_type?: string | null
          amount_cents?: number | null
          category_code?: string | null
          classification_rule_id?: string | null
          created_at?: string | null
          created_by?: string | null
          evidence_object_id?: string | null
          household_id?: string | null
          human_decision_id?: string | null
          id?: string | null
          income_stream?: string | null
          logical_allocation_id?: string | null
          memo?: string | null
          person_key?: string | null
          property_unit?: string | null
          record_status?: string | null
          revision_number?: number | null
          supersedes_allocation_id?: string | null
          tax_treatment?: string | null
          tax_year?: number | null
          transaction_id?: string | null
        }
        Update: {
          allocation_type?: string | null
          amount_cents?: number | null
          category_code?: string | null
          classification_rule_id?: string | null
          created_at?: string | null
          created_by?: string | null
          evidence_object_id?: string | null
          household_id?: string | null
          human_decision_id?: string | null
          id?: string | null
          income_stream?: string | null
          logical_allocation_id?: string | null
          memo?: string | null
          person_key?: string | null
          property_unit?: string | null
          record_status?: string | null
          revision_number?: number | null
          supersedes_allocation_id?: string | null
          tax_treatment?: string | null
          tax_year?: number | null
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_allocations_decision_same_household_fkey"
            columns: ["household_id", "human_decision_id"]
            isOneToOne: false
            referencedRelation: "finance_current_human_decisions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_decision_same_household_fkey"
            columns: ["household_id", "human_decision_id"]
            isOneToOne: false
            referencedRelation: "finance_human_decisions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_allocations_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_allocations_rule_same_household_fkey"
            columns: ["household_id", "classification_rule_id"]
            isOneToOne: false
            referencedRelation: "finance_classification_rules"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_rule_same_household_fkey"
            columns: ["household_id", "classification_rule_id"]
            isOneToOne: false
            referencedRelation: "finance_current_classification_rules"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_allocation_id"]
            isOneToOne: false
            referencedRelation: "finance_allocations"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_allocation_id"]
            isOneToOne: false
            referencedRelation: "finance_current_allocations"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_allocation_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_allocations"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_transaction_same_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_current_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_transaction_same_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_transaction_same_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transaction_balances"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_transaction_same_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_current_classification_rules: {
        Row: {
          created_at: string | null
          created_by: string | null
          created_from_decision_id: string | null
          financial_account_id: string | null
          household_id: string | null
          id: string | null
          logical_rule_id: string | null
          match_conditions: Json | null
          name: string | null
          priority: number | null
          record_status: string | null
          revision_number: number | null
          rule_actions: Json | null
          rule_status: string | null
          source_id: string | null
          supersedes_rule_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          created_from_decision_id?: string | null
          financial_account_id?: string | null
          household_id?: string | null
          id?: string | null
          logical_rule_id?: string | null
          match_conditions?: Json | null
          name?: string | null
          priority?: number | null
          record_status?: string | null
          revision_number?: number | null
          rule_actions?: Json | null
          rule_status?: string | null
          source_id?: string | null
          supersedes_rule_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          created_from_decision_id?: string | null
          financial_account_id?: string | null
          household_id?: string | null
          id?: string | null
          logical_rule_id?: string | null
          match_conditions?: Json | null
          name?: string | null
          priority?: number | null
          record_status?: string | null
          revision_number?: number | null
          rule_actions?: Json | null
          rule_status?: string | null
          source_id?: string | null
          supersedes_rule_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_classification_rules_account_same_household_fkey"
            columns: ["household_id", "financial_account_id"]
            isOneToOne: false
            referencedRelation: "finance_current_accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_classification_rules_account_same_household_fkey"
            columns: ["household_id", "financial_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_classification_rules_decision_same_household_fkey"
            columns: ["household_id", "created_from_decision_id"]
            isOneToOne: false
            referencedRelation: "finance_current_human_decisions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_classification_rules_decision_same_household_fkey"
            columns: ["household_id", "created_from_decision_id"]
            isOneToOne: false
            referencedRelation: "finance_human_decisions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_classification_rules_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_classification_rules_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_classification_rules_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_current_sources"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_classification_rules_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_source_health"
            referencedColumns: ["household_id", "source_id"]
          },
          {
            foreignKeyName: "finance_classification_rules_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_sources"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_classification_rules_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_rule_id"]
            isOneToOne: false
            referencedRelation: "finance_classification_rules"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_classification_rules_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_rule_id"]
            isOneToOne: false
            referencedRelation: "finance_current_classification_rules"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_current_document_line_items: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          document_id: string | null
          document_page_id: string | null
          extraction_metadata: Json | null
          gross_cents: number | null
          household_id: string | null
          id: string | null
          line_number: number | null
          logical_line_item_id: string | null
          merchant_sku: string | null
          net_cents: number | null
          proposed_category: string | null
          proposed_use: string | null
          quantity: number | null
          record_status: string | null
          revision_number: number | null
          supersedes_line_item_id: string | null
          unit_price_cents: number | null
          vat_cents: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          document_id?: string | null
          document_page_id?: string | null
          extraction_metadata?: Json | null
          gross_cents?: number | null
          household_id?: string | null
          id?: string | null
          line_number?: number | null
          logical_line_item_id?: string | null
          merchant_sku?: string | null
          net_cents?: number | null
          proposed_category?: string | null
          proposed_use?: string | null
          quantity?: number | null
          record_status?: string | null
          revision_number?: number | null
          supersedes_line_item_id?: string | null
          unit_price_cents?: number | null
          vat_cents?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          document_id?: string | null
          document_page_id?: string | null
          extraction_metadata?: Json | null
          gross_cents?: number | null
          household_id?: string | null
          id?: string | null
          line_number?: number | null
          logical_line_item_id?: string | null
          merchant_sku?: string | null
          net_cents?: number | null
          proposed_category?: string | null
          proposed_use?: string | null
          quantity?: number | null
          record_status?: string | null
          revision_number?: number | null
          supersedes_line_item_id?: string | null
          unit_price_cents?: number | null
          vat_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_document_line_items_document_same_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_current_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_line_items_document_same_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_line_items_document_same_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_line_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_document_line_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_document_line_items_page_same_household_fkey"
            columns: ["household_id", "document_page_id"]
            isOneToOne: false
            referencedRelation: "finance_current_document_pages"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_line_items_page_same_household_fkey"
            columns: ["household_id", "document_page_id"]
            isOneToOne: false
            referencedRelation: "finance_document_pages"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_line_items_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_line_item_id"]
            isOneToOne: false
            referencedRelation: "finance_current_document_line_items"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_line_items_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_line_item_id"]
            isOneToOne: false
            referencedRelation: "finance_document_line_items"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_current_document_pages: {
        Row: {
          created_at: string | null
          created_by: string | null
          document_id: string | null
          evidence_object_id: string | null
          extracted_text: string | null
          extraction_metadata: Json | null
          household_id: string | null
          id: string | null
          image_sha256: string | null
          logical_page_id: string | null
          ocr_method: string | null
          page_number: number | null
          record_status: string | null
          revision_number: number | null
          supersedes_page_id: string | null
          text_sha256: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          document_id?: string | null
          evidence_object_id?: string | null
          extracted_text?: string | null
          extraction_metadata?: Json | null
          household_id?: string | null
          id?: string | null
          image_sha256?: string | null
          logical_page_id?: string | null
          ocr_method?: string | null
          page_number?: number | null
          record_status?: string | null
          revision_number?: number | null
          supersedes_page_id?: string | null
          text_sha256?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          document_id?: string | null
          evidence_object_id?: string | null
          extracted_text?: string | null
          extraction_metadata?: Json | null
          household_id?: string | null
          id?: string | null
          image_sha256?: string | null
          logical_page_id?: string | null
          ocr_method?: string | null
          page_number?: number | null
          record_status?: string | null
          revision_number?: number | null
          supersedes_page_id?: string | null
          text_sha256?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_document_pages_document_same_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_current_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_pages_document_same_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_pages_document_same_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_pages_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_pages_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_pages_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_pages_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_document_pages_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_document_pages_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_page_id"]
            isOneToOne: false
            referencedRelation: "finance_current_document_pages"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_document_pages_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_page_id"]
            isOneToOne: false
            referencedRelation: "finance_document_pages"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_current_documents: {
        Row: {
          created_at: string | null
          created_by: string | null
          currency: string | null
          document_number: string | null
          document_type: string | null
          due_on: string | null
          evidence_object_id: string | null
          extracted_metadata: Json | null
          extraction_confidence: number | null
          extraction_method: string | null
          household_id: string | null
          id: string | null
          issued_on: string | null
          issuer_name: string | null
          logical_document_id: string | null
          normalized_text_sha256: string | null
          payment_status: string | null
          recipient_name: string | null
          record_status: string | null
          revision_number: number | null
          service_end_on: string | null
          service_start_on: string | null
          subtotal_cents: number | null
          supersedes_document_id: string | null
          total_cents: number | null
          vat_cents: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          document_number?: string | null
          document_type?: string | null
          due_on?: string | null
          evidence_object_id?: string | null
          extracted_metadata?: Json | null
          extraction_confidence?: number | null
          extraction_method?: string | null
          household_id?: string | null
          id?: string | null
          issued_on?: string | null
          issuer_name?: string | null
          logical_document_id?: string | null
          normalized_text_sha256?: string | null
          payment_status?: string | null
          recipient_name?: string | null
          record_status?: string | null
          revision_number?: number | null
          service_end_on?: string | null
          service_start_on?: string | null
          subtotal_cents?: number | null
          supersedes_document_id?: string | null
          total_cents?: number | null
          vat_cents?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          document_number?: string | null
          document_type?: string | null
          due_on?: string | null
          evidence_object_id?: string | null
          extracted_metadata?: Json | null
          extraction_confidence?: number | null
          extraction_method?: string | null
          household_id?: string | null
          id?: string | null
          issued_on?: string | null
          issuer_name?: string | null
          logical_document_id?: string | null
          normalized_text_sha256?: string | null
          payment_status?: string | null
          recipient_name?: string | null
          record_status?: string | null
          revision_number?: number | null
          service_end_on?: string | null
          service_start_on?: string | null
          subtotal_cents?: number | null
          supersedes_document_id?: string | null
          total_cents?: number | null
          vat_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_documents_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_documents_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_documents_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_documents_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_documents_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_documents_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_document_id"]
            isOneToOne: false
            referencedRelation: "finance_current_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_documents_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_document_id"]
            isOneToOne: false
            referencedRelation: "finance_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_documents_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_document_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_documents"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_current_evidence_objects: {
        Row: {
          acquired_at: string | null
          byte_size: number | null
          created_at: string | null
          created_by: string | null
          duplicate_of_evidence_id: string | null
          evidence_kind: string | null
          exact_sha256: string | null
          has_local_copy: boolean | null
          has_storage_copy: boolean | null
          household_id: string | null
          id: string | null
          import_record_id: string | null
          import_run_id: string | null
          last_verified_at: string | null
          logical_evidence_id: string | null
          media_type: string | null
          metadata: Json | null
          normalized_sha256: string | null
          original_filename: string | null
          page_text_sha256: string | null
          record_status: string | null
          retention_status: string | null
          revision_number: number | null
          source_created_at: string | null
          source_id: string | null
          source_object_key: string | null
          supersedes_evidence_id: string | null
        }
        Insert: {
          acquired_at?: string | null
          byte_size?: number | null
          created_at?: string | null
          created_by?: string | null
          duplicate_of_evidence_id?: string | null
          evidence_kind?: string | null
          exact_sha256?: string | null
          has_local_copy?: boolean | null
          has_storage_copy?: boolean | null
          household_id?: string | null
          id?: string | null
          import_record_id?: string | null
          import_run_id?: string | null
          last_verified_at?: string | null
          logical_evidence_id?: string | null
          media_type?: string | null
          metadata?: Json | null
          normalized_sha256?: string | null
          original_filename?: string | null
          page_text_sha256?: string | null
          record_status?: string | null
          retention_status?: string | null
          revision_number?: number | null
          source_created_at?: string | null
          source_id?: string | null
          source_object_key?: string | null
          supersedes_evidence_id?: string | null
        }
        Update: {
          acquired_at?: string | null
          byte_size?: number | null
          created_at?: string | null
          created_by?: string | null
          duplicate_of_evidence_id?: string | null
          evidence_kind?: string | null
          exact_sha256?: string | null
          has_local_copy?: boolean | null
          has_storage_copy?: boolean | null
          household_id?: string | null
          id?: string | null
          import_record_id?: string | null
          import_run_id?: string | null
          last_verified_at?: string | null
          logical_evidence_id?: string | null
          media_type?: string | null
          metadata?: Json | null
          normalized_sha256?: string | null
          original_filename?: string | null
          page_text_sha256?: string | null
          record_status?: string | null
          retention_status?: string | null
          revision_number?: number | null
          source_created_at?: string | null
          source_id?: string | null
          source_object_key?: string | null
          supersedes_evidence_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_evidence_objects_duplicate_same_household_fkey"
            columns: ["household_id", "duplicate_of_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_duplicate_same_household_fkey"
            columns: ["household_id", "duplicate_of_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_duplicate_same_household_fkey"
            columns: ["household_id", "duplicate_of_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_import_record_same_household_fkey"
            columns: ["household_id", "import_record_id"]
            isOneToOne: false
            referencedRelation: "finance_import_records"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_run_same_household_fkey"
            columns: ["household_id", "import_run_id"]
            isOneToOne: false
            referencedRelation: "finance_current_import_runs"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_run_same_household_fkey"
            columns: ["household_id", "import_run_id"]
            isOneToOne: false
            referencedRelation: "finance_import_runs"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_current_sources"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_source_health"
            referencedColumns: ["household_id", "source_id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_sources"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_current_human_decisions: {
        Row: {
          answer_text: string | null
          answered_at: string | null
          answered_by: string | null
          application_scope: string | null
          created_at: string | null
          decision_context: Json | null
          household_id: string | null
          id: string | null
          logical_decision_id: string | null
          question_snapshot: string | null
          record_status: string | null
          review_item_id: string | null
          revision_number: number | null
          selected_option: string | null
          supersedes_decision_id: string | null
        }
        Insert: {
          answer_text?: string | null
          answered_at?: string | null
          answered_by?: string | null
          application_scope?: string | null
          created_at?: string | null
          decision_context?: Json | null
          household_id?: string | null
          id?: string | null
          logical_decision_id?: string | null
          question_snapshot?: string | null
          record_status?: string | null
          review_item_id?: string | null
          revision_number?: number | null
          selected_option?: string | null
          supersedes_decision_id?: string | null
        }
        Update: {
          answer_text?: string | null
          answered_at?: string | null
          answered_by?: string | null
          application_scope?: string | null
          created_at?: string | null
          decision_context?: Json | null
          household_id?: string | null
          id?: string | null
          logical_decision_id?: string | null
          question_snapshot?: string | null
          record_status?: string | null
          review_item_id?: string | null
          revision_number?: number | null
          selected_option?: string | null
          supersedes_decision_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_human_decisions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_human_decisions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_human_decisions_review_same_household_fkey"
            columns: ["household_id", "review_item_id"]
            isOneToOne: false
            referencedRelation: "finance_anomaly_inbox"
            referencedColumns: ["household_id", "review_item_id"]
          },
          {
            foreignKeyName: "finance_human_decisions_review_same_household_fkey"
            columns: ["household_id", "review_item_id"]
            isOneToOne: false
            referencedRelation: "finance_current_review_items"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_human_decisions_review_same_household_fkey"
            columns: ["household_id", "review_item_id"]
            isOneToOne: false
            referencedRelation: "finance_review_items"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_human_decisions_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_decision_id"]
            isOneToOne: false
            referencedRelation: "finance_current_human_decisions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_human_decisions_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_decision_id"]
            isOneToOne: false
            referencedRelation: "finance_human_decisions"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_current_import_runs: {
        Row: {
          adapter_name: string | null
          adapter_version: string | null
          completed_at: string | null
          coverage_end_on: string | null
          coverage_start_on: string | null
          created_at: string | null
          created_by: string | null
          discovered_record_count: number | null
          duplicate_record_count: number | null
          error_summary: Json | null
          financial_account_id: string | null
          household_id: string | null
          id: string | null
          import_mode: string | null
          inserted_record_count: number | null
          logical_import_id: string | null
          record_status: string | null
          review_record_count: number | null
          revision_number: number | null
          run_key: string | null
          run_status: string | null
          source_fingerprint: string | null
          source_id: string | null
          started_at: string | null
          supersedes_import_run_id: string | null
        }
        Insert: {
          adapter_name?: string | null
          adapter_version?: string | null
          completed_at?: string | null
          coverage_end_on?: string | null
          coverage_start_on?: string | null
          created_at?: string | null
          created_by?: string | null
          discovered_record_count?: number | null
          duplicate_record_count?: number | null
          error_summary?: Json | null
          financial_account_id?: string | null
          household_id?: string | null
          id?: string | null
          import_mode?: string | null
          inserted_record_count?: number | null
          logical_import_id?: string | null
          record_status?: string | null
          review_record_count?: number | null
          revision_number?: number | null
          run_key?: string | null
          run_status?: string | null
          source_fingerprint?: string | null
          source_id?: string | null
          started_at?: string | null
          supersedes_import_run_id?: string | null
        }
        Update: {
          adapter_name?: string | null
          adapter_version?: string | null
          completed_at?: string | null
          coverage_end_on?: string | null
          coverage_start_on?: string | null
          created_at?: string | null
          created_by?: string | null
          discovered_record_count?: number | null
          duplicate_record_count?: number | null
          error_summary?: Json | null
          financial_account_id?: string | null
          household_id?: string | null
          id?: string | null
          import_mode?: string | null
          inserted_record_count?: number | null
          logical_import_id?: string | null
          record_status?: string | null
          review_record_count?: number | null
          revision_number?: number | null
          run_key?: string | null
          run_status?: string | null
          source_fingerprint?: string | null
          source_id?: string | null
          started_at?: string | null
          supersedes_import_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_import_runs_account_same_household_fkey"
            columns: ["household_id", "financial_account_id"]
            isOneToOne: false
            referencedRelation: "finance_current_accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_import_runs_account_same_household_fkey"
            columns: ["household_id", "financial_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_import_runs_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_import_runs_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_import_runs_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_current_sources"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_import_runs_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_source_health"
            referencedColumns: ["household_id", "source_id"]
          },
          {
            foreignKeyName: "finance_import_runs_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_sources"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_import_runs_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_import_run_id"]
            isOneToOne: false
            referencedRelation: "finance_current_import_runs"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_import_runs_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_import_run_id"]
            isOneToOne: false
            referencedRelation: "finance_import_runs"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_current_review_items: {
        Row: {
          ambiguity_reason: string | null
          amount_cents: number | null
          answer_options: Json | null
          assigned_to: string | null
          context_snapshot: Json | null
          created_at: string | null
          created_by: string | null
          document_id: string | null
          due_at: string | null
          evidence_object_id: string | null
          household_id: string | null
          id: string | null
          logical_review_item_id: string | null
          priority: string | null
          priority_score: number | null
          proposed_interpretation: string | null
          question: string | null
          record_status: string | null
          review_type: string | null
          revision_number: number | null
          supersedes_review_item_id: string | null
          tax_impact_cents: number | null
          title: string | null
          transaction_id: string | null
          workflow_status: string | null
        }
        Insert: {
          ambiguity_reason?: string | null
          amount_cents?: number | null
          answer_options?: Json | null
          assigned_to?: string | null
          context_snapshot?: Json | null
          created_at?: string | null
          created_by?: string | null
          document_id?: string | null
          due_at?: string | null
          evidence_object_id?: string | null
          household_id?: string | null
          id?: string | null
          logical_review_item_id?: string | null
          priority?: string | null
          priority_score?: number | null
          proposed_interpretation?: string | null
          question?: string | null
          record_status?: string | null
          review_type?: string | null
          revision_number?: number | null
          supersedes_review_item_id?: string | null
          tax_impact_cents?: number | null
          title?: string | null
          transaction_id?: string | null
          workflow_status?: string | null
        }
        Update: {
          ambiguity_reason?: string | null
          amount_cents?: number | null
          answer_options?: Json | null
          assigned_to?: string | null
          context_snapshot?: Json | null
          created_at?: string | null
          created_by?: string | null
          document_id?: string | null
          due_at?: string | null
          evidence_object_id?: string | null
          household_id?: string | null
          id?: string | null
          logical_review_item_id?: string | null
          priority?: string | null
          priority_score?: number | null
          proposed_interpretation?: string | null
          question?: string | null
          record_status?: string | null
          review_type?: string | null
          revision_number?: number | null
          supersedes_review_item_id?: string | null
          tax_impact_cents?: number | null
          title?: string | null
          transaction_id?: string | null
          workflow_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_review_items_document_same_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_current_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_document_same_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_document_same_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_review_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_review_items_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_review_item_id"]
            isOneToOne: false
            referencedRelation: "finance_anomaly_inbox"
            referencedColumns: ["household_id", "review_item_id"]
          },
          {
            foreignKeyName: "finance_review_items_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_review_item_id"]
            isOneToOne: false
            referencedRelation: "finance_current_review_items"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_review_item_id"]
            isOneToOne: false
            referencedRelation: "finance_review_items"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_transaction_same_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_current_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_transaction_same_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_transaction_same_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transaction_balances"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_review_items_transaction_same_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_current_sources: {
        Row: {
          connection_mode: string | null
          connection_status: string | null
          coverage_end_on: string | null
          coverage_start_on: string | null
          created_at: string | null
          created_by: string | null
          credential_reference: string | null
          display_name: string | null
          expected_frequency: string | null
          health_summary: Json | null
          household_id: string | null
          id: string | null
          last_checked_at: string | null
          last_success_at: string | null
          logical_source_id: string | null
          owner_scope: string | null
          record_status: string | null
          revision_number: number | null
          source_type: string | null
          supersedes_source_id: string | null
        }
        Insert: {
          connection_mode?: string | null
          connection_status?: string | null
          coverage_end_on?: string | null
          coverage_start_on?: string | null
          created_at?: string | null
          created_by?: string | null
          credential_reference?: string | null
          display_name?: string | null
          expected_frequency?: string | null
          health_summary?: Json | null
          household_id?: string | null
          id?: string | null
          last_checked_at?: string | null
          last_success_at?: string | null
          logical_source_id?: string | null
          owner_scope?: string | null
          record_status?: string | null
          revision_number?: number | null
          source_type?: string | null
          supersedes_source_id?: string | null
        }
        Update: {
          connection_mode?: string | null
          connection_status?: string | null
          coverage_end_on?: string | null
          coverage_start_on?: string | null
          created_at?: string | null
          created_by?: string | null
          credential_reference?: string | null
          display_name?: string | null
          expected_frequency?: string | null
          health_summary?: Json | null
          household_id?: string | null
          id?: string | null
          last_checked_at?: string | null
          last_success_at?: string | null
          logical_source_id?: string | null
          owner_scope?: string | null
          record_status?: string | null
          revision_number?: number | null
          source_type?: string | null
          supersedes_source_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_sources_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_sources_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_sources_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_source_id"]
            isOneToOne: false
            referencedRelation: "finance_current_sources"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_sources_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_source_id"]
            isOneToOne: false
            referencedRelation: "finance_source_health"
            referencedColumns: ["household_id", "source_id"]
          },
          {
            foreignKeyName: "finance_sources_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_source_id"]
            isOneToOne: false
            referencedRelation: "finance_sources"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_current_submission_packs: {
        Row: {
          accountant_workbook_evidence_id: string | null
          approved_at: string | null
          approved_by: string | null
          cover_email_evidence_id: string | null
          created_at: string | null
          created_by: string | null
          evidence_zip_evidence_id: string | null
          generated_at: string | null
          household_id: string | null
          id: string | null
          logical_submission_pack_id: string | null
          manifest_evidence_id: string | null
          manifest_sha256: string | null
          pack_name: string | null
          pack_status: string | null
          record_status: string | null
          revision_number: number | null
          sent_at: string | null
          supersedes_submission_pack_id: string | null
          tax_scenario_id: string | null
        }
        Insert: {
          accountant_workbook_evidence_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          cover_email_evidence_id?: string | null
          created_at?: string | null
          created_by?: string | null
          evidence_zip_evidence_id?: string | null
          generated_at?: string | null
          household_id?: string | null
          id?: string | null
          logical_submission_pack_id?: string | null
          manifest_evidence_id?: string | null
          manifest_sha256?: string | null
          pack_name?: string | null
          pack_status?: string | null
          record_status?: string | null
          revision_number?: number | null
          sent_at?: string | null
          supersedes_submission_pack_id?: string | null
          tax_scenario_id?: string | null
        }
        Update: {
          accountant_workbook_evidence_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          cover_email_evidence_id?: string | null
          created_at?: string | null
          created_by?: string | null
          evidence_zip_evidence_id?: string | null
          generated_at?: string | null
          household_id?: string | null
          id?: string | null
          logical_submission_pack_id?: string | null
          manifest_evidence_id?: string | null
          manifest_sha256?: string | null
          pack_name?: string | null
          pack_status?: string | null
          record_status?: string | null
          revision_number?: number | null
          sent_at?: string | null
          supersedes_submission_pack_id?: string | null
          tax_scenario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_submission_packs_email_same_household_fkey"
            columns: ["household_id", "cover_email_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_email_same_household_fkey"
            columns: ["household_id", "cover_email_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_email_same_household_fkey"
            columns: ["household_id", "cover_email_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_submission_packs_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_submission_packs_manifest_same_household_fkey"
            columns: ["household_id", "manifest_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_manifest_same_household_fkey"
            columns: ["household_id", "manifest_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_manifest_same_household_fkey"
            columns: ["household_id", "manifest_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_scenario_same_household_fkey"
            columns: ["household_id", "tax_scenario_id"]
            isOneToOne: false
            referencedRelation: "finance_current_tax_scenarios"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_scenario_same_household_fkey"
            columns: ["household_id", "tax_scenario_id"]
            isOneToOne: false
            referencedRelation: "finance_tax_scenarios"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_submission_pack_id"]
            isOneToOne: false
            referencedRelation: "finance_current_submission_packs"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_submission_pack_id"]
            isOneToOne: false
            referencedRelation: "finance_submission_packs"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_workbook_same_household_fkey"
            columns: ["household_id", "accountant_workbook_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_workbook_same_household_fkey"
            columns: ["household_id", "accountant_workbook_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_workbook_same_household_fkey"
            columns: ["household_id", "accountant_workbook_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_zip_same_household_fkey"
            columns: ["household_id", "evidence_zip_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_zip_same_household_fkey"
            columns: ["household_id", "evidence_zip_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_submission_packs_zip_same_household_fkey"
            columns: ["household_id", "evidence_zip_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_current_tax_scenario_lines: {
        Row: {
          amount_cents: number | null
          category_code: string | null
          created_at: string | null
          created_by: string | null
          household_id: string | null
          id: string | null
          label: string | null
          line_metadata: Json | null
          line_type: string | null
          logical_tax_scenario_line_id: string | null
          person_key: string | null
          record_status: string | null
          revision_number: number | null
          supersedes_tax_scenario_line_id: string | null
          tax_scenario_id: string | null
          tax_treatment: string | null
        }
        Insert: {
          amount_cents?: number | null
          category_code?: string | null
          created_at?: string | null
          created_by?: string | null
          household_id?: string | null
          id?: string | null
          label?: string | null
          line_metadata?: Json | null
          line_type?: string | null
          logical_tax_scenario_line_id?: string | null
          person_key?: string | null
          record_status?: string | null
          revision_number?: number | null
          supersedes_tax_scenario_line_id?: string | null
          tax_scenario_id?: string | null
          tax_treatment?: string | null
        }
        Update: {
          amount_cents?: number | null
          category_code?: string | null
          created_at?: string | null
          created_by?: string | null
          household_id?: string | null
          id?: string | null
          label?: string | null
          line_metadata?: Json | null
          line_type?: string | null
          logical_tax_scenario_line_id?: string | null
          person_key?: string | null
          record_status?: string | null
          revision_number?: number | null
          supersedes_tax_scenario_line_id?: string | null
          tax_scenario_id?: string | null
          tax_treatment?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_tax_scenario_lines_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_tax_scenario_lines_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_tax_scenario_lines_scenario_same_household_fkey"
            columns: ["household_id", "tax_scenario_id"]
            isOneToOne: false
            referencedRelation: "finance_current_tax_scenarios"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tax_scenario_lines_scenario_same_household_fkey"
            columns: ["household_id", "tax_scenario_id"]
            isOneToOne: false
            referencedRelation: "finance_tax_scenarios"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tax_scenario_lines_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_tax_scenario_line_id"]
            isOneToOne: false
            referencedRelation: "finance_current_tax_scenario_lines"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tax_scenario_lines_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_tax_scenario_line_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_tax_scenario_lines"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tax_scenario_lines_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_tax_scenario_line_id"]
            isOneToOne: false
            referencedRelation: "finance_tax_scenario_lines"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_current_tax_scenarios: {
        Row: {
          accrued_management_fee_cents: number | null
          calculated_at: string | null
          calculated_management_fee_cents: number | null
          calculation_basis: Json | null
          combined_household_tax_cents: number | null
          created_at: string | null
          created_by: string | null
          household_id: string | null
          id: string | null
          jane_taxable_income_cents: number | null
          logical_tax_scenario_id: string | null
          paid_management_fee_cents: number | null
          period_end_on: string | null
          period_start_on: string | null
          provisional_period: string | null
          record_status: string | null
          revision_number: number | null
          scenario_name: string | null
          scenario_status: string | null
          scenario_type: string | null
          supersedes_tax_scenario_id: string | null
          tax_year: number | null
          tristan_taxable_income_cents: number | null
          warnings: Json | null
        }
        Insert: {
          accrued_management_fee_cents?: number | null
          calculated_at?: string | null
          calculated_management_fee_cents?: number | null
          calculation_basis?: Json | null
          combined_household_tax_cents?: number | null
          created_at?: string | null
          created_by?: string | null
          household_id?: string | null
          id?: string | null
          jane_taxable_income_cents?: number | null
          logical_tax_scenario_id?: string | null
          paid_management_fee_cents?: number | null
          period_end_on?: string | null
          period_start_on?: string | null
          provisional_period?: string | null
          record_status?: string | null
          revision_number?: number | null
          scenario_name?: string | null
          scenario_status?: string | null
          scenario_type?: string | null
          supersedes_tax_scenario_id?: string | null
          tax_year?: number | null
          tristan_taxable_income_cents?: number | null
          warnings?: Json | null
        }
        Update: {
          accrued_management_fee_cents?: number | null
          calculated_at?: string | null
          calculated_management_fee_cents?: number | null
          calculation_basis?: Json | null
          combined_household_tax_cents?: number | null
          created_at?: string | null
          created_by?: string | null
          household_id?: string | null
          id?: string | null
          jane_taxable_income_cents?: number | null
          logical_tax_scenario_id?: string | null
          paid_management_fee_cents?: number | null
          period_end_on?: string | null
          period_start_on?: string | null
          provisional_period?: string | null
          record_status?: string | null
          revision_number?: number | null
          scenario_name?: string | null
          scenario_status?: string | null
          scenario_type?: string | null
          supersedes_tax_scenario_id?: string | null
          tax_year?: number | null
          tristan_taxable_income_cents?: number | null
          warnings?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_tax_scenarios_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_tax_scenarios_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_tax_scenarios_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_tax_scenario_id"]
            isOneToOne: false
            referencedRelation: "finance_current_tax_scenarios"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tax_scenarios_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_tax_scenario_id"]
            isOneToOne: false
            referencedRelation: "finance_tax_scenarios"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_current_transaction_document_matches: {
        Row: {
          confidence: number | null
          created_at: string | null
          created_by: string | null
          document_id: string | null
          household_id: string | null
          human_decision_id: string | null
          id: string | null
          logical_match_id: string | null
          match_status: string | null
          match_type: string | null
          matched_amount_cents: number | null
          rationale: string | null
          record_status: string | null
          revision_number: number | null
          supersedes_match_id: string | null
          transaction_id: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          created_by?: string | null
          document_id?: string | null
          household_id?: string | null
          human_decision_id?: string | null
          id?: string | null
          logical_match_id?: string | null
          match_status?: string | null
          match_type?: string | null
          matched_amount_cents?: number | null
          rationale?: string | null
          record_status?: string | null
          revision_number?: number | null
          supersedes_match_id?: string | null
          transaction_id?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          created_by?: string | null
          document_id?: string | null
          household_id?: string | null
          human_decision_id?: string | null
          id?: string | null
          logical_match_id?: string | null
          match_status?: string | null
          match_type?: string | null
          matched_amount_cents?: number | null
          rationale?: string | null
          record_status?: string | null
          revision_number?: number | null
          supersedes_match_id?: string | null
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_transaction_document_matches_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_transaction_document_matches_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_tx_doc_matches_decision_household_fkey"
            columns: ["household_id", "human_decision_id"]
            isOneToOne: false
            referencedRelation: "finance_current_human_decisions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tx_doc_matches_decision_household_fkey"
            columns: ["household_id", "human_decision_id"]
            isOneToOne: false
            referencedRelation: "finance_human_decisions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tx_doc_matches_document_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_current_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tx_doc_matches_document_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tx_doc_matches_document_household_fkey"
            columns: ["household_id", "document_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tx_doc_matches_supersedes_household_fkey"
            columns: ["household_id", "supersedes_match_id"]
            isOneToOne: false
            referencedRelation: "finance_current_transaction_document_matches"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tx_doc_matches_supersedes_household_fkey"
            columns: ["household_id", "supersedes_match_id"]
            isOneToOne: false
            referencedRelation: "finance_transaction_document_matches"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tx_doc_matches_transaction_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_current_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tx_doc_matches_transaction_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tx_doc_matches_transaction_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transaction_balances"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tx_doc_matches_transaction_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_current_transactions: {
        Row: {
          amount_cents: number | null
          booked_on: string | null
          counterparty_name: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          financial_account_id: string | null
          household_id: string | null
          id: string | null
          import_record_id: string | null
          logical_transaction_id: string | null
          raw_description: string | null
          raw_payload: Json | null
          record_status: string | null
          reference: string | null
          revision_number: number | null
          running_balance_cents: number | null
          source_event_key: string | null
          supersedes_transaction_id: string | null
          transaction_at: string | null
          transaction_kind: string | null
          value_on: string | null
        }
        Insert: {
          amount_cents?: number | null
          booked_on?: string | null
          counterparty_name?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          financial_account_id?: string | null
          household_id?: string | null
          id?: string | null
          import_record_id?: string | null
          logical_transaction_id?: string | null
          raw_description?: string | null
          raw_payload?: Json | null
          record_status?: string | null
          reference?: string | null
          revision_number?: number | null
          running_balance_cents?: number | null
          source_event_key?: string | null
          supersedes_transaction_id?: string | null
          transaction_at?: string | null
          transaction_kind?: string | null
          value_on?: string | null
        }
        Update: {
          amount_cents?: number | null
          booked_on?: string | null
          counterparty_name?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          financial_account_id?: string | null
          household_id?: string | null
          id?: string | null
          import_record_id?: string | null
          logical_transaction_id?: string | null
          raw_description?: string | null
          raw_payload?: Json | null
          record_status?: string | null
          reference?: string | null
          revision_number?: number | null
          running_balance_cents?: number | null
          source_event_key?: string | null
          supersedes_transaction_id?: string | null
          transaction_at?: string | null
          transaction_kind?: string | null
          value_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_transactions_account_same_household_fkey"
            columns: ["household_id", "financial_account_id"]
            isOneToOne: false
            referencedRelation: "finance_current_accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transactions_account_same_household_fkey"
            columns: ["household_id", "financial_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transactions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_transactions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transactions_import_record_same_household_fkey"
            columns: ["household_id", "import_record_id"]
            isOneToOne: false
            referencedRelation: "finance_import_records"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transactions_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_current_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transactions_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transactions_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transaction_balances"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transactions_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_dashboard_summary: {
        Row: {
          household_id: string | null
          latest_import_completed_at: string | null
          open_review_count: number | null
          open_tax_impact_absolute_cents: number | null
          transaction_count: number | null
          unallocated_absolute_cents: number | null
          unallocated_transaction_count: number | null
        }
        Relationships: []
      }
      finance_effective_allocations: {
        Row: {
          allocation_type: string | null
          amount_cents: number | null
          category_code: string | null
          classification_rule_id: string | null
          created_at: string | null
          created_by: string | null
          evidence_object_id: string | null
          household_id: string | null
          human_decision_id: string | null
          id: string | null
          income_stream: string | null
          logical_allocation_id: string | null
          memo: string | null
          person_key: string | null
          property_unit: string | null
          record_status: string | null
          revision_number: number | null
          supersedes_allocation_id: string | null
          tax_treatment: string | null
          tax_year: number | null
          transaction_id: string | null
        }
        Insert: {
          allocation_type?: string | null
          amount_cents?: number | null
          category_code?: string | null
          classification_rule_id?: string | null
          created_at?: string | null
          created_by?: string | null
          evidence_object_id?: string | null
          household_id?: string | null
          human_decision_id?: string | null
          id?: string | null
          income_stream?: string | null
          logical_allocation_id?: string | null
          memo?: string | null
          person_key?: string | null
          property_unit?: string | null
          record_status?: string | null
          revision_number?: number | null
          supersedes_allocation_id?: string | null
          tax_treatment?: string | null
          tax_year?: number | null
          transaction_id?: string | null
        }
        Update: {
          allocation_type?: string | null
          amount_cents?: number | null
          category_code?: string | null
          classification_rule_id?: string | null
          created_at?: string | null
          created_by?: string | null
          evidence_object_id?: string | null
          household_id?: string | null
          human_decision_id?: string | null
          id?: string | null
          income_stream?: string | null
          logical_allocation_id?: string | null
          memo?: string | null
          person_key?: string | null
          property_unit?: string | null
          record_status?: string | null
          revision_number?: number | null
          supersedes_allocation_id?: string | null
          tax_treatment?: string | null
          tax_year?: number | null
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_allocations_decision_same_household_fkey"
            columns: ["household_id", "human_decision_id"]
            isOneToOne: false
            referencedRelation: "finance_current_human_decisions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_decision_same_household_fkey"
            columns: ["household_id", "human_decision_id"]
            isOneToOne: false
            referencedRelation: "finance_human_decisions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_allocations_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_allocations_rule_same_household_fkey"
            columns: ["household_id", "classification_rule_id"]
            isOneToOne: false
            referencedRelation: "finance_classification_rules"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_rule_same_household_fkey"
            columns: ["household_id", "classification_rule_id"]
            isOneToOne: false
            referencedRelation: "finance_current_classification_rules"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_allocation_id"]
            isOneToOne: false
            referencedRelation: "finance_allocations"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_allocation_id"]
            isOneToOne: false
            referencedRelation: "finance_current_allocations"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_allocation_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_allocations"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_transaction_same_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_current_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_transaction_same_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_transaction_same_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transaction_balances"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_allocations_transaction_same_household_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_effective_documents: {
        Row: {
          created_at: string | null
          created_by: string | null
          currency: string | null
          document_number: string | null
          document_type: string | null
          due_on: string | null
          evidence_object_id: string | null
          extracted_metadata: Json | null
          extraction_confidence: number | null
          extraction_method: string | null
          household_id: string | null
          id: string | null
          issued_on: string | null
          issuer_name: string | null
          logical_document_id: string | null
          normalized_text_sha256: string | null
          payment_status: string | null
          recipient_name: string | null
          record_status: string | null
          revision_number: number | null
          service_end_on: string | null
          service_start_on: string | null
          subtotal_cents: number | null
          supersedes_document_id: string | null
          total_cents: number | null
          vat_cents: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          document_number?: string | null
          document_type?: string | null
          due_on?: string | null
          evidence_object_id?: string | null
          extracted_metadata?: Json | null
          extraction_confidence?: number | null
          extraction_method?: string | null
          household_id?: string | null
          id?: string | null
          issued_on?: string | null
          issuer_name?: string | null
          logical_document_id?: string | null
          normalized_text_sha256?: string | null
          payment_status?: string | null
          recipient_name?: string | null
          record_status?: string | null
          revision_number?: number | null
          service_end_on?: string | null
          service_start_on?: string | null
          subtotal_cents?: number | null
          supersedes_document_id?: string | null
          total_cents?: number | null
          vat_cents?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          document_number?: string | null
          document_type?: string | null
          due_on?: string | null
          evidence_object_id?: string | null
          extracted_metadata?: Json | null
          extraction_confidence?: number | null
          extraction_method?: string | null
          household_id?: string | null
          id?: string | null
          issued_on?: string | null
          issuer_name?: string | null
          logical_document_id?: string | null
          normalized_text_sha256?: string | null
          payment_status?: string | null
          recipient_name?: string | null
          record_status?: string | null
          revision_number?: number | null
          service_end_on?: string | null
          service_start_on?: string | null
          subtotal_cents?: number | null
          supersedes_document_id?: string | null
          total_cents?: number | null
          vat_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_documents_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_documents_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_documents_evidence_same_household_fkey"
            columns: ["household_id", "evidence_object_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_documents_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_documents_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_documents_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_document_id"]
            isOneToOne: false
            referencedRelation: "finance_current_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_documents_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_document_id"]
            isOneToOne: false
            referencedRelation: "finance_documents"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_documents_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_document_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_documents"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_effective_evidence_objects: {
        Row: {
          acquired_at: string | null
          byte_size: number | null
          created_at: string | null
          created_by: string | null
          duplicate_of_evidence_id: string | null
          evidence_kind: string | null
          exact_sha256: string | null
          has_local_copy: boolean | null
          has_storage_copy: boolean | null
          household_id: string | null
          id: string | null
          import_record_id: string | null
          import_run_id: string | null
          last_verified_at: string | null
          logical_evidence_id: string | null
          media_type: string | null
          metadata: Json | null
          normalized_sha256: string | null
          original_filename: string | null
          page_text_sha256: string | null
          record_status: string | null
          retention_status: string | null
          revision_number: number | null
          source_created_at: string | null
          source_id: string | null
          source_object_key: string | null
          supersedes_evidence_id: string | null
        }
        Insert: {
          acquired_at?: string | null
          byte_size?: number | null
          created_at?: string | null
          created_by?: string | null
          duplicate_of_evidence_id?: string | null
          evidence_kind?: string | null
          exact_sha256?: string | null
          has_local_copy?: boolean | null
          has_storage_copy?: boolean | null
          household_id?: string | null
          id?: string | null
          import_record_id?: string | null
          import_run_id?: string | null
          last_verified_at?: string | null
          logical_evidence_id?: string | null
          media_type?: string | null
          metadata?: Json | null
          normalized_sha256?: string | null
          original_filename?: string | null
          page_text_sha256?: string | null
          record_status?: string | null
          retention_status?: string | null
          revision_number?: number | null
          source_created_at?: string | null
          source_id?: string | null
          source_object_key?: string | null
          supersedes_evidence_id?: string | null
        }
        Update: {
          acquired_at?: string | null
          byte_size?: number | null
          created_at?: string | null
          created_by?: string | null
          duplicate_of_evidence_id?: string | null
          evidence_kind?: string | null
          exact_sha256?: string | null
          has_local_copy?: boolean | null
          has_storage_copy?: boolean | null
          household_id?: string | null
          id?: string | null
          import_record_id?: string | null
          import_run_id?: string | null
          last_verified_at?: string | null
          logical_evidence_id?: string | null
          media_type?: string | null
          metadata?: Json | null
          normalized_sha256?: string | null
          original_filename?: string | null
          page_text_sha256?: string | null
          record_status?: string | null
          retention_status?: string | null
          revision_number?: number | null
          source_created_at?: string | null
          source_id?: string | null
          source_object_key?: string | null
          supersedes_evidence_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_evidence_objects_duplicate_same_household_fkey"
            columns: ["household_id", "duplicate_of_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_duplicate_same_household_fkey"
            columns: ["household_id", "duplicate_of_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_duplicate_same_household_fkey"
            columns: ["household_id", "duplicate_of_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_import_record_same_household_fkey"
            columns: ["household_id", "import_record_id"]
            isOneToOne: false
            referencedRelation: "finance_import_records"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_run_same_household_fkey"
            columns: ["household_id", "import_run_id"]
            isOneToOne: false
            referencedRelation: "finance_current_import_runs"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_run_same_household_fkey"
            columns: ["household_id", "import_run_id"]
            isOneToOne: false
            referencedRelation: "finance_import_runs"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_current_sources"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_source_health"
            referencedColumns: ["household_id", "source_id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_source_same_household_fkey"
            columns: ["household_id", "source_id"]
            isOneToOne: false
            referencedRelation: "finance_sources"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_current_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_evidence_objects_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_evidence_id"]
            isOneToOne: false
            referencedRelation: "finance_evidence_objects"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_effective_tax_scenario_lines: {
        Row: {
          amount_cents: number | null
          category_code: string | null
          created_at: string | null
          created_by: string | null
          household_id: string | null
          id: string | null
          label: string | null
          line_metadata: Json | null
          line_type: string | null
          logical_tax_scenario_line_id: string | null
          person_key: string | null
          record_status: string | null
          revision_number: number | null
          supersedes_tax_scenario_line_id: string | null
          tax_scenario_id: string | null
          tax_treatment: string | null
        }
        Insert: {
          amount_cents?: number | null
          category_code?: string | null
          created_at?: string | null
          created_by?: string | null
          household_id?: string | null
          id?: string | null
          label?: string | null
          line_metadata?: Json | null
          line_type?: string | null
          logical_tax_scenario_line_id?: string | null
          person_key?: string | null
          record_status?: string | null
          revision_number?: number | null
          supersedes_tax_scenario_line_id?: string | null
          tax_scenario_id?: string | null
          tax_treatment?: string | null
        }
        Update: {
          amount_cents?: number | null
          category_code?: string | null
          created_at?: string | null
          created_by?: string | null
          household_id?: string | null
          id?: string | null
          label?: string | null
          line_metadata?: Json | null
          line_type?: string | null
          logical_tax_scenario_line_id?: string | null
          person_key?: string | null
          record_status?: string | null
          revision_number?: number | null
          supersedes_tax_scenario_line_id?: string | null
          tax_scenario_id?: string | null
          tax_treatment?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_tax_scenario_lines_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_tax_scenario_lines_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_tax_scenario_lines_scenario_same_household_fkey"
            columns: ["household_id", "tax_scenario_id"]
            isOneToOne: false
            referencedRelation: "finance_current_tax_scenarios"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tax_scenario_lines_scenario_same_household_fkey"
            columns: ["household_id", "tax_scenario_id"]
            isOneToOne: false
            referencedRelation: "finance_tax_scenarios"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tax_scenario_lines_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_tax_scenario_line_id"]
            isOneToOne: false
            referencedRelation: "finance_current_tax_scenario_lines"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tax_scenario_lines_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_tax_scenario_line_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_tax_scenario_lines"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_tax_scenario_lines_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_tax_scenario_line_id"]
            isOneToOne: false
            referencedRelation: "finance_tax_scenario_lines"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_effective_transactions: {
        Row: {
          amount_cents: number | null
          booked_on: string | null
          counterparty_name: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          financial_account_id: string | null
          household_id: string | null
          id: string | null
          import_record_id: string | null
          logical_transaction_id: string | null
          raw_description: string | null
          raw_payload: Json | null
          record_status: string | null
          reference: string | null
          revision_number: number | null
          running_balance_cents: number | null
          source_event_key: string | null
          supersedes_transaction_id: string | null
          transaction_at: string | null
          transaction_kind: string | null
          value_on: string | null
        }
        Insert: {
          amount_cents?: number | null
          booked_on?: string | null
          counterparty_name?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          financial_account_id?: string | null
          household_id?: string | null
          id?: string | null
          import_record_id?: string | null
          logical_transaction_id?: string | null
          raw_description?: string | null
          raw_payload?: Json | null
          record_status?: string | null
          reference?: string | null
          revision_number?: number | null
          running_balance_cents?: number | null
          source_event_key?: string | null
          supersedes_transaction_id?: string | null
          transaction_at?: string | null
          transaction_kind?: string | null
          value_on?: string | null
        }
        Update: {
          amount_cents?: number | null
          booked_on?: string | null
          counterparty_name?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          financial_account_id?: string | null
          household_id?: string | null
          id?: string | null
          import_record_id?: string | null
          logical_transaction_id?: string | null
          raw_description?: string | null
          raw_payload?: Json | null
          record_status?: string | null
          reference?: string | null
          revision_number?: number | null
          running_balance_cents?: number | null
          source_event_key?: string | null
          supersedes_transaction_id?: string | null
          transaction_at?: string | null
          transaction_kind?: string | null
          value_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_transactions_account_same_household_fkey"
            columns: ["household_id", "financial_account_id"]
            isOneToOne: false
            referencedRelation: "finance_current_accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transactions_account_same_household_fkey"
            columns: ["household_id", "financial_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transactions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_transactions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transactions_import_record_same_household_fkey"
            columns: ["household_id", "import_record_id"]
            isOneToOne: false
            referencedRelation: "finance_import_records"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transactions_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_current_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transactions_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transactions_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transaction_balances"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transactions_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      finance_source_health: {
        Row: {
          connection_mode: string | null
          connection_status: string | null
          coverage_end_on: string | null
          coverage_start_on: string | null
          display_name: string | null
          expected_frequency: string | null
          health_summary: Json | null
          household_id: string | null
          last_checked_at: string | null
          last_success_at: string | null
          latest_discovered_record_count: number | null
          latest_duplicate_record_count: number | null
          latest_import_completed_at: string | null
          latest_import_id: string | null
          latest_import_mode: string | null
          latest_import_started_at: string | null
          latest_import_status: string | null
          latest_import_succeeded: boolean | null
          latest_inserted_record_count: number | null
          latest_review_record_count: number | null
          logical_source_id: string | null
          owner_scope: string | null
          source_id: string | null
          source_type: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_sources_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_sources_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_transaction_balances: {
        Row: {
          allocated_amount_cents: number | null
          allocation_count: number | null
          amount_cents: number | null
          booked_on: string | null
          counterparty_name: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          financial_account_id: string | null
          household_id: string | null
          id: string | null
          import_record_id: string | null
          is_fully_allocated: boolean | null
          logical_transaction_id: string | null
          raw_description: string | null
          raw_payload: Json | null
          record_status: string | null
          reference: string | null
          revision_number: number | null
          running_balance_cents: number | null
          source_event_key: string | null
          supersedes_transaction_id: string | null
          transaction_at: string | null
          transaction_kind: string | null
          unallocated_amount_cents: number | null
          value_on: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_transactions_account_same_household_fkey"
            columns: ["household_id", "financial_account_id"]
            isOneToOne: false
            referencedRelation: "finance_current_accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transactions_account_same_household_fkey"
            columns: ["household_id", "financial_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transactions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_summary"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "finance_transactions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transactions_import_record_same_household_fkey"
            columns: ["household_id", "import_record_id"]
            isOneToOne: false
            referencedRelation: "finance_import_records"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transactions_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_current_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transactions_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_effective_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transactions_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transaction_balances"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "finance_transactions_supersedes_same_household_fkey"
            columns: ["household_id", "supersedes_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
    }
    Functions: {
      claim_initial_site_admin: { Args: never; Returns: boolean }
      is_site_admin: { Args: never; Returns: boolean }
      site_admin_bootstrap_available: { Args: never; Returns: boolean }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
