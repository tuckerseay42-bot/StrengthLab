
CREATE TABLE IF NOT EXISTS public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role public.app_role NOT NULL,
  permission text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role, permission)
);

GRANT SELECT ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can view role permissions"
  ON public.role_permissions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Owners and admins can insert role permissions"
  ON public.role_permissions FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'administrator') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Owners and admins can update role permissions"
  ON public.role_permissions FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'administrator') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'administrator') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Owners and admins can delete role permissions"
  ON public.role_permissions FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'administrator') OR public.has_role(auth.uid(), 'admin'));

-- has_permission helper
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role = ur.role
    WHERE ur.user_id = _user_id
      AND rp.permission = _permission
  ) OR EXISTS (
    -- owner and administrator always have every permission
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('owner', 'administrator', 'admin')
  )
$$;

-- Seed default permissions
INSERT INTO public.role_permissions (role, permission) VALUES
  -- Coach
  ('coach', 'athletes.view'), ('coach', 'athletes.create'), ('coach', 'athletes.edit'), ('coach', 'athletes.delete'),
  ('coach', 'tests.view'), ('coach', 'tests.edit'),
  ('coach', 'lifts.view'), ('coach', 'lifts.edit'),
  ('coach', 'attendance.view'), ('coach', 'attendance.edit'),
  ('coach', 'workouts.view'), ('coach', 'workouts.edit'),
  ('coach', 'metrics.view'), ('coach', 'metrics.create'),
  ('coach', 'reports.view'), ('coach', 'reports.create'),
  ('coach', 'dashboards.view'), ('coach', 'dashboards.build'),
  -- Assistant coach
  ('assistant_coach', 'athletes.view'),
  ('assistant_coach', 'tests.view'), ('assistant_coach', 'tests.edit'),
  ('assistant_coach', 'lifts.view'), ('assistant_coach', 'lifts.edit'),
  ('assistant_coach', 'attendance.view'), ('assistant_coach', 'attendance.edit'),
  ('assistant_coach', 'workouts.view'),
  ('assistant_coach', 'metrics.view'),
  ('assistant_coach', 'reports.view'),
  ('assistant_coach', 'dashboards.view'),
  -- Sport coach (read-only sport-side)
  ('sport_coach', 'athletes.view'),
  ('sport_coach', 'tests.view'),
  ('sport_coach', 'attendance.view'),
  ('sport_coach', 'reports.view'),
  ('sport_coach', 'dashboards.view'),
  -- Athlete (self view)
  ('athlete', 'athletes.view'),
  ('athlete', 'tests.view'),
  ('athlete', 'lifts.view'),
  ('athlete', 'workouts.view'),
  ('athlete', 'attendance.view'),
  -- Parent (view only)
  ('parent', 'athletes.view'),
  ('parent', 'tests.view'),
  ('parent', 'attendance.view'),
  ('parent', 'reports.view')
ON CONFLICT (role, permission) DO NOTHING;
