
CREATE TABLE public.spider_graph_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  assignment jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalization_method text NOT NULL DEFAULT 'percentile_team',
  comparison_group text NOT NULL DEFAULT 'team',
  date_rule text NOT NULL DEFAULT 'latest',
  kpi_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.spider_graph_templates TO authenticated;
GRANT ALL ON public.spider_graph_templates TO service_role;

ALTER TABLE public.spider_graph_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read templates" ON public.spider_graph_templates
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "config editors manage templates" ON public.spider_graph_templates
  FOR ALL TO authenticated
  USING (
    public.is_org_member(organization_id) AND (
      public.has_role(auth.uid(), 'owner') OR
      public.has_role(auth.uid(), 'administrator') OR
      public.has_role(auth.uid(), 'admin') OR
      public.has_role(auth.uid(), 'coach') OR
      public.has_role(auth.uid(), 'sport_coach') OR
      public.has_permission(auth.uid(), 'dashboard.edit')
    )
  )
  WITH CHECK (
    public.is_org_member(organization_id) AND (
      public.has_role(auth.uid(), 'owner') OR
      public.has_role(auth.uid(), 'administrator') OR
      public.has_role(auth.uid(), 'admin') OR
      public.has_role(auth.uid(), 'coach') OR
      public.has_role(auth.uid(), 'sport_coach') OR
      public.has_permission(auth.uid(), 'dashboard.edit')
    )
  );

CREATE TRIGGER trg_spider_templates_touch
  BEFORE UPDATE ON public.spider_graph_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_spider_templates_org ON public.spider_graph_templates(organization_id);

CREATE TABLE public.spider_graph_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.spider_graph_templates(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  metric_key text NOT NULL,
  display_label text,
  hide_if_missing boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.spider_graph_metrics TO authenticated;
GRANT ALL ON public.spider_graph_metrics TO service_role;

ALTER TABLE public.spider_graph_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read spider metrics" ON public.spider_graph_metrics
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.spider_graph_templates t
    WHERE t.id = template_id AND public.is_org_member(t.organization_id)
  ));

CREATE POLICY "config editors manage spider metrics" ON public.spider_graph_metrics
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.spider_graph_templates t
    WHERE t.id = template_id
      AND public.is_org_member(t.organization_id)
      AND (
        public.has_role(auth.uid(), 'owner') OR
        public.has_role(auth.uid(), 'administrator') OR
        public.has_role(auth.uid(), 'admin') OR
        public.has_role(auth.uid(), 'coach') OR
        public.has_role(auth.uid(), 'sport_coach') OR
        public.has_permission(auth.uid(), 'dashboard.edit')
      )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.spider_graph_templates t
    WHERE t.id = template_id
      AND public.is_org_member(t.organization_id)
      AND (
        public.has_role(auth.uid(), 'owner') OR
        public.has_role(auth.uid(), 'administrator') OR
        public.has_role(auth.uid(), 'admin') OR
        public.has_role(auth.uid(), 'coach') OR
        public.has_role(auth.uid(), 'sport_coach') OR
        public.has_permission(auth.uid(), 'dashboard.edit')
      )
  ));

CREATE TRIGGER trg_spider_metrics_touch
  BEFORE UPDATE ON public.spider_graph_metrics
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_spider_metrics_template ON public.spider_graph_metrics(template_id, position);
