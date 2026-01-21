-- Create artworks table
CREATE TABLE IF NOT EXISTS public.artworks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  subtitle text,
  description text,
  artwork_url text,
  audio_url text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

-- Enable Row Level Security
ALTER TABLE public.artworks ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for public access
CREATE POLICY "Allow public SELECT on artworks" 
  ON public.artworks 
  FOR SELECT 
  TO public 
  USING (true);

CREATE POLICY "Allow public INSERT on artworks" 
  ON public.artworks 
  FOR INSERT 
  TO public 
  WITH CHECK (true);

CREATE POLICY "Allow public UPDATE on artworks" 
  ON public.artworks 
  FOR UPDATE 
  TO public 
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public DELETE on artworks" 
  ON public.artworks 
  FOR DELETE 
  TO public 
  USING (true);

-- Create dummy_data table (used to prevent Supabase from pausing the project)
CREATE TABLE IF NOT EXISTS public.dummy_data (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- Enable Row Level Security on dummy_data
ALTER TABLE public.dummy_data ENABLE ROW LEVEL SECURITY;

-- Comment on table
COMMENT ON TABLE public.dummy_data IS 'A table I use to stop Supabase pausing my project';
