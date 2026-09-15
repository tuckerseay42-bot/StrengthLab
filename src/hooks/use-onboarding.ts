import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyPermissions } from "@/hooks/use-permissions";
import { useCurrentOrgId } from "@/hooks/use-current-org";

/**
 * Returns whether the current admin/owner should be sent through the
 * first-time setup wizard: an org exists, but it has zero teams AND zero
 * athletes. Coaches/athletes never see the wizard.
 */
export function useOnboardingState() {
  const orgId = useCurrentOrgId();
  const { data: perms } = useMyPermissions();
  const canOnboard = perms?.roles.some(
    (r) => r === "owner" || r === "administrator" || r === "admin",
  ) ?? false;

  const { data, isLoading } = useQuery({
    queryKey: ["onboarding-counts", orgId],
    enabled: !!orgId && canOnboard,
    queryFn: async () => {
      const [teams, athletes] = await Promise.all([
        supabase.from("teams").select("id", { count: "exact", head: true })
          .eq("organization_id", orgId!).is("archived_at", null),
        supabase.from("athletes").select("id", { count: "exact", head: true })
          .eq("organization_id", orgId!),
      ]);
      return {
        teamCount: teams.count ?? 0,
        athleteCount: athletes.count ?? 0,
      };
    },
    staleTime: 30_000,
  });

  const dismissed = typeof window !== "undefined"
    && window.localStorage.getItem(`sl.setupDismissed.${orgId ?? ""}`) === "1";

  const needsSetup =
    !!orgId
    && canOnboard
    && !isLoading
    && !dismissed
    && (data?.teamCount ?? 0) === 0
    && (data?.athleteCount ?? 0) === 0;

  return { needsSetup, orgId, canOnboard, isLoading, ...(data ?? {}) };
}

export function markSetupDismissed(orgId: string | null) {
  if (typeof window === "undefined" || !orgId) return;
  window.localStorage.setItem(`sl.setupDismissed.${orgId}`, "1");
}

export function resetSetupDismissed(orgId: string | null) {
  if (typeof window === "undefined" || !orgId) return;
  window.localStorage.removeItem(`sl.setupDismissed.${orgId}`);
}
