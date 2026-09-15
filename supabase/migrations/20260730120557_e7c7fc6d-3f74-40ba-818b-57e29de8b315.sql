CREATE TABLE public.tool_leads (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL,
  tool text NOT NULL,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tool_leads_created_at ON public.tool_leads (created_at DESC);

GRANT INSERT ON public.tool_leads TO anon;
GRANT INSERT, SELECT ON public.tool_leads TO authenticated;
GRANT ALL ON public.tool_leads TO service_role;

ALTER TABLE public.tool_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit a public tool lead"
  ON public.tool_leads FOR INSERT TO anon, authenticated
  WITH CHECK (char_length(email) BETWEEN 3 AND 255 AND char_length(tool) BETWEEN 1 AND 64);

CREATE POLICY "Platform owners can read tool leads"
  ON public.tool_leads FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_owner'));