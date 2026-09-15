import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveOrgId } from "@/hooks/use-active-org";
import { useActiveTeamId } from "@/hooks/use-active-team";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect } from "react";

type Org = { id: string; name: string };

const organizationsListQO = queryOptions({
  queryKey: ["organizations", "list-for-switcher"],
  queryFn: async (): Promise<Org[]> => {
    const { data, error } = await supabase
      .from("organizations")
      .select("id, name")
      .is("frozen_at" as never, null)
      .order("name");
    if (error) throw error;
    return (data ?? []) as Org[];
  },
  staleTime: 5 * 60_000,
});

// Only show the org switcher when the current user actually sees multiple orgs
// (super admin, or member of more than one).
export function OrgSwitcher() {
  const { data: orgs = [] } = useQuery(organizationsListQO);
  const [activeOrgId, setActiveOrgId] = useActiveOrgId();
  const [, setActiveTeamId] = useActiveTeamId();
  const qc = useQueryClient();

  // If the stored org is no longer visible, clear it.
  useEffect(() => {
    if (activeOrgId && orgs.length && !orgs.find((o) => o.id === activeOrgId)) {
      setActiveOrgId(null);
    }
  }, [activeOrgId, orgs, setActiveOrgId]);

  if (orgs.length < 2) return null;

  return (
    <Select
      value={activeOrgId ?? "all"}
      onValueChange={(v) => {
        setActiveOrgId(v === "all" ? null : v);
        // Reset team selection when org scope changes.
        setActiveTeamId(null);
        // Nuke cached data so no other org's rows linger on screen.
        qc.removeQueries();
      }}
    >
      <SelectTrigger className="h-9 w-[170px]"><SelectValue placeholder="Organization" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All organizations</SelectItem>
        {orgs.map((o) => (
          <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
