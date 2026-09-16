import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { spiderTemplatesQO, teamsQO, type SpiderTemplate } from "@/lib/queries";
import { useMyPermissions } from "@/hooks/use-permissions";
import { useCurrentOrgId } from "@/hooks/use-current-org";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Trash2, Star } from "lucide-react";

export const Route = createFileRoute("/dashboard-settings")({
  head: () => ({ meta: [{ title: "Dashboard Settings — Strength Lab" }] }),
  component: DashboardSettingsPage,
});

function DashboardSettingsPage() {
  const { data: perms, isLoading: permsLoading } = useMyPermissions();
  const orgId = useCurrentOrgId();
  const canEdit = perms?.roles.some((r) =>
    r === "owner" || r === "administrator" || r === "admin" || r === "coach" || r === "sport_coach",
  ) ?? false;

  const qc = useQueryClient();
  const { data: templates = [] } = useQuery(spiderTemplatesQO);
  const { data: teams = [] } = useQuery(teamsQO);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const selected = templates.find((t) => t.id === selectedId) ?? templates[0] ?? null;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["spider_graph_templates"] });

  const createTemplate = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No active organization");
      const { data, error } = await supabase
        .from("spider_graph_templates" as never)
        .insert({
          organization_id: orgId,
          name: `New template ${templates.length + 1}`,
          normalization_method: "percentile",
          comparison_group: "team",
          date_rule: "latest",
          is_default: templates.length === 0,
        } as never)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as SpiderTemplate;
    },
    onSuccess: (t) => { invalidate(); setSelectedId(t.id); toast.success("Template created"); },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const updateTemplate = useMutation({
    mutationFn: async (patch: Partial<SpiderTemplate> & { id: string }) => {
      const { id, ...rest } = patch;
      const { error } = await supabase.from("spider_graph_templates" as never).update(rest as never).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success("Saved"); },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("spider_graph_templates" as never).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setSelectedId(null); toast.success("Template deleted"); },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const setDefault = useMutation({
    mutationFn: async (id: string) => {
      if (!orgId) throw new Error("No org");
      await supabase.from("spider_graph_templates" as never).update({ is_default: false } as never).eq("organization_id", orgId);
      const { error } = await supabase.from("spider_graph_templates" as never).update({ is_default: true } as never).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success("Default set"); },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  if (permsLoading) return <div className="py-16 text-center text-muted-foreground">Loading…</div>;

  if (!canEdit) {
    return (
      <div className="max-w-lg py-16 text-center">
        <h1 className="text-2xl font-semibold">Dashboard settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Only owners, administrators, and coaches can configure the athlete preview.
        </p>
        <Link to="/" className="mt-4 inline-block text-primary underline">Back home</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Settings
          </Link>
          <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Athlete preview settings</h1>
          <p className="text-sm text-muted-foreground">
            Match a team, sport, or position to control whether an athlete's badge shelf shows on their dashboard.
          </p>
        </div>
        <Button onClick={() => createTemplate.mutate()} disabled={!orgId || createTemplate.isPending}>
          <Plus className="mr-1 h-4 w-4" /> New template
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Template list */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Templates</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No templates yet. Create one to start.</p>
            ) : templates.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm ${
                  selected?.id === t.id ? "border-primary bg-muted" : "border-border hover:bg-muted/50"
                }`}
              >
                <span className="truncate">{t.name}</span>
                {t.is_default && <Star className="h-3 w-3 fill-primary text-primary" />}
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Template editor */}
        {selected ? (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Template details</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Name</Label>
                    <Input
                      defaultValue={selected.name}
                      key={selected.id + selected.name}
                      onBlur={(e) => e.target.value !== selected.name && updateTemplate.mutate({ id: selected.id, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Assigned team</Label>
                    <Select
                      value={selected.assignment?.team_id ?? "__all"}
                      onValueChange={(v) => updateTemplate.mutate({
                        id: selected.id,
                        assignment: { ...(selected.assignment ?? {}), team_id: v === "__all" ? null : v },
                      })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all">All teams</SelectItem>
                        {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Sport (optional)</Label>
                    <Input
                      defaultValue={selected.assignment?.sport ?? ""}
                      key={selected.id + (selected.assignment?.sport ?? "")}
                      placeholder="e.g. football"
                      onBlur={(e) => updateTemplate.mutate({
                        id: selected.id,
                        assignment: { ...(selected.assignment ?? {}), sport: e.target.value || null },
                      })}
                    />
                  </div>
                  <div>
                    <Label>Position (optional)</Label>
                    <Input
                      defaultValue={selected.assignment?.position ?? ""}
                      key={selected.id + (selected.assignment?.position ?? "")}
                      placeholder="e.g. WR"
                      onBlur={(e) => updateTemplate.mutate({
                        id: selected.id,
                        assignment: { ...(selected.assignment ?? {}), position: e.target.value || null },
                      })}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <SectionToggle
                    label="Show badges on matching athletes"
                    checked={selected.options?.show_badges ?? true}
                    onChange={(v) => updateTemplate.mutate({ id: selected.id, options: { ...(selected.options ?? {}), show_badges: v } })}
                  />
                  <Button size="sm" variant={selected.is_default ? "default" : "outline"} onClick={() => setDefault.mutate(selected.id)}>
                    <Star className="mr-1 h-3 w-3" /> {selected.is_default ? "Default template" : "Set as default"}
                  </Button>
                  <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => setDeleteConfirmOpen(true)}>
                    <Trash2 className="mr-1 h-3 w-3" /> Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card><CardContent className="py-16 text-center text-muted-foreground">
            Create a template to begin.
          </CardContent></Card>
        )}
      </div>

      <ConfirmDeleteDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={`Delete "${selected?.name}"?`}
        description="This permanently removes the template. Athletes matched to it will fall back to another template if one exists, or the default badge-shelf setting otherwise. This can't be undone."
        onConfirm={() => { if (selected) deleteTemplate.mutate(selected.id); setDeleteConfirmOpen(false); }}
        pending={deleteTemplate.isPending}
      />
    </div>
  );
}

function SectionToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} />
      {label}
    </label>
  );
}

