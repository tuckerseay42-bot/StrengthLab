import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getActiveOrgId } from "@/hooks/use-active-org";

// The org a write should land in. Reads are filtered by the *active* org
// (org switcher), so writes must use the same id — otherwise a super-admin
// browsing another org creates rows in their home org and they instantly
// "disappear" from the list they were just added to.
async function resolveOrgId(): Promise<string | null> {
  const active = getActiveOrgId();
  if (active) return active;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: mem } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (mem?.organization_id) return mem.organization_id as string;
  // Super-admin fallback: first visible org (RLS lets super admin see all)
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (org?.id as string) ?? null;
}

export function useCurrentOrgId() {
  const activeOrgId = getActiveOrgId();
  const { data } = useQuery({
    queryKey: ["current-org-id", activeOrgId],
    queryFn: resolveOrgId,
    staleTime: 5 * 60_000,
  });
  return data ?? activeOrgId ?? null;
}

export async function getCurrentOrgId(): Promise<string | null> {
  return resolveOrgId();
}
