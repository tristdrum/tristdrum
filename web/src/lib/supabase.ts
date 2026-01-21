import { createClient } from '@supabase/supabase-js'
import type { Database, Tables, TablesInsert, TablesUpdate } from '../../../supabase/types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)

// Re-export types for convenience
export type { Database, Tables, TablesInsert, TablesUpdate }

// Type aliases for common table types
export type Artwork = Tables<'artworks'>
export type ArtworkInsert = TablesInsert<'artworks'>
export type ArtworkUpdate = TablesUpdate<'artworks'>
