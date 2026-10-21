import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentOrgId } from "@/hooks/use-current-org";

export type ParentNotificationSettings = {
  injury: boolean;
  missed_session: boolean;
  pr: boolean;
};

type OrgNotifyRow = {
  notify_parent_injury?: boolean | null;
  notify_parent_missed_session?: boolean | null;
  notify_parent_pr?: boolean | null;
};

// Off by default everywhere — nothing emails a parent until a coach
// explicitly flips one of these on in Settings.
export function useParentNotificationSettings() {
  const orgId = useCurrentOrgId();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["parent-notification-settings", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<ParentNotificationSettings> => {
      const { data } = await supabase
        .from("organizations")
        .select("notify_parent_injury, notify_parent_missed_session, notify_parent_pr")
        .eq("id", orgId!)
        .maybeSingle();
      const row = data as OrgNotifyRow | null;
      return {
        injury: row?.notify_parent_injury ?? false,
        missed_session: row?.notify_parent_missed_session ?? false,
        pr: row?.notify_parent_pr ?? false,
      };
    },
  });

  const settings: ParentNotificationSettings = data ?? {
    injury: false,
    missed_session: false,
    pr: false,
  };

  const update = useMutation({
    mutationFn: async (patch: Partial<OrgNotifyRow>) => {
      if (!orgId) throw new Error("No active organization.");
      const { error } = await supabase
        .from("organizations")
        .update(patch as never)
        .eq("id", orgId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parent-notification-settings", orgId] }),
  });

  return { settings, update };
}
