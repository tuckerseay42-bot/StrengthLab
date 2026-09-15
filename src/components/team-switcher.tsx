import { useQuery } from "@tanstack/react-query";
import { teamsQO } from "@/lib/queries";
import { useActiveTeamId } from "@/hooks/use-active-team";
import { useActiveOrgId } from "@/hooks/use-active-org";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useMemo } from "react";

export function TeamSwitcher() {
  const { data: teams = [] } = useQuery(teamsQO);
  const [activeId, setActive] = useActiveTeamId();
  const [activeOrgId] = useActiveOrgId();

  // Scope visible teams to the active organization when the super-admin has one selected.
  const visible = useMemo(() => {
    if (!activeOrgId) return teams;
    return teams.filter((t) => (t as unknown as { organization_id?: string }).organization_id === activeOrgId);
  }, [teams, activeOrgId]);

  // Clear the active team when it falls outside the current org scope.
  useEffect(() => {
    if (activeId && !visible.find((t) => t.id === activeId)) setActive(null);
  }, [activeId, visible, setActive]);

  if (!visible.length) return null;
  return (
    <Select value={activeId ?? "all"} onValueChange={(v) => setActive(v === "all" ? null : v)}>
      <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="Team" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All teams</SelectItem>
        {visible.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.name}{t.season ? ` · ${t.season}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
