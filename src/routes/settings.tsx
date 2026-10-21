import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useUnitPrefs } from "@/hooks/use-units";
import type { DistanceUnit, SpeedUnit, WeightUnit } from "@/lib/units";
import { toast } from "sonner";
import { useMyPermissions } from "@/hooks/use-permissions";
import { ChevronRight, Radar, Rocket, Bell } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { resetSetupDismissed } from "@/hooks/use-onboarding";
import { useCurrentOrgId } from "@/hooks/use-current-org";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toUserMessage } from "@/lib/db-errors";
import { useOrg1RMFormula } from "@/hooks/use-1rm-formula";
import { ONE_RM_FORMULAS, ONE_RM_META, type OneRmFormula } from "@/lib/one-rm";
import { ClassPeriodRosterImport } from "@/components/class-period-roster-import";
import { Switch } from "@/components/ui/switch";
import { useParentNotificationSettings } from "@/hooks/use-parent-notifications";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — Strength Lab" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const [prefs, update] = useUnitPrefs();
  const { data: perms } = useMyPermissions();
  const orgId = useCurrentOrgId();
  const navigate = useNavigate();
  const canEditDashboard =
    perms?.roles.some(
      (r) =>
        r === "owner" ||
        r === "administrator" ||
        r === "admin" ||
        r === "coach" ||
        r === "sport_coach",
    ) ?? false;
  const canOnboard =
    perms?.roles.some((r) => r === "owner" || r === "administrator" || r === "admin") ?? false;

  const set = (patch: Parameters<typeof update>[0]) => {
    update(patch);
    toast.success("Preferences saved");
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Preferences"
        title="Settings"
        description="Choose your preferred units. Values are stored canonically and converted for display."
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Measurement units</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label>Weight</Label>
            <Select value={prefs.weight} onValueChange={(v) => set({ weight: v as WeightUnit })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lb">Pounds (lb)</SelectItem>
                <SelectItem value="kg">Kilograms (kg)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Distance / Height</Label>
            <Select
              value={prefs.distance}
              onValueChange={(v) => set({ distance: v as DistanceUnit })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in">Inches (in)</SelectItem>
                <SelectItem value="ft">Feet (ft)</SelectItem>
                <SelectItem value="cm">Centimeters (cm)</SelectItem>
                <SelectItem value="m">Meters (m)</SelectItem>
                <SelectItem value="yd">Yards (yd)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Sprint speed display</Label>
            <Select value={prefs.speed} onValueChange={(v) => set({ speed: v as SpeedUnit })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="s">Seconds (s)</SelectItem>
                <SelectItem value="mph">Miles per hour (mph)</SelectItem>
                <SelectItem value="m/s">Meters per second (m/s)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Data validation</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>The app automatically checks new entries for common errors before saving:</p>
          <ul className="list-disc pl-5">
            <li>Duplicate athletes (same full name)</li>
            <li>Duplicate metric names</li>
            <li>Impossible sprint / bodyweight / height values</li>
            <li>Missing required fields</li>
            <li>Invalid email addresses</li>
          </ul>
        </CardContent>
      </Card>

      {canEditDashboard && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Athlete preview</CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              to="/dashboard-settings"
              className="flex items-center justify-between rounded-md border border-border p-3 text-sm hover:bg-muted"
            >
              <span className="flex items-center gap-2">
                <Radar className="h-4 w-4 text-primary" />
                Configure spider graph, KPI cards, and dashboard sections
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </CardContent>
        </Card>
      )}

      {canEditDashboard && <ClassPeriodRosterImport />}

      {canOnboard && <OneRmFormulaCard orgId={orgId} />}

      {canOnboard && <ParentNotificationsCard />}

      {canOnboard && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Onboarding</CardTitle>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={() => {
                resetSetupDismissed(orgId);
                navigate({ to: "/setup" });
              }}
              className="gap-2"
            >
              <Rocket className="h-4 w-4" /> Restart setup wizard
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Re-run the first-time setup flow to add teams, invite coaches, or import athletes.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function OneRmFormulaCard({ orgId }: { orgId: string | null }) {
  const qc = useQueryClient();
  const formula = useOrg1RMFormula();

  const save = useMutation({
    mutationFn: async (next: OneRmFormula) => {
      if (!orgId) throw new Error("No active organization.");
      const { error } = await supabase
        .from("organizations")
        .update({ default_1rm_formula: next })
        .eq("id", orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-1rm-formula"] });
      toast.success("1RM formula updated");
    },
    onError: (e) => toast.error(toUserMessage(e)),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Estimated 1RM formula</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label>Formula used across programming, reports, and logged sets</Label>
        <Select
          value={formula}
          onValueChange={(v) => save.mutate(v as OneRmFormula)}
          disabled={!orgId || save.isPending}
        >
          <SelectTrigger className="sm:w-80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ONE_RM_FORMULAS.map((f) => (
              <SelectItem key={f} value={f}>
                {ONE_RM_META[f].label} — {ONE_RM_META[f].expression}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{ONE_RM_META[formula].citation}</p>
      </CardContent>
    </Card>
  );
}

function ParentNotificationsCard() {
  const { settings, update } = useParentNotificationSettings();

  const row = (
    key: "notify_parent_injury" | "notify_parent_missed_session" | "notify_parent_pr",
    checked: boolean,
    label: string,
    description: string,
  ) => (
    <div className="flex items-center justify-between gap-3 py-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <Switch
        checked={checked}
        disabled={update.isPending}
        onCheckedChange={(v) => update.mutate({ [key]: v })}
      />
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="h-4 w-4" /> Parent notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-y">
        <p className="pb-2 text-xs text-muted-foreground">
          Off by default. Each one emails a parent at the email on file for that athlete — turn on
          only what you actually want going out.
        </p>
        {row(
          "notify_parent_injury",
          settings.injury,
          "Injury or excused marked",
          "When you mark an athlete injured or excused for the day.",
        )}
        {row(
          "notify_parent_missed_session",
          settings.missed_session,
          "Missed session",
          'When an athlete is marked absent, or you flag them as never-logged from "End of practice."',
        )}
        {row(
          "notify_parent_pr",
          settings.pr,
          "New PR",
          "When an athlete logs a set that beats their previous best.",
        )}
      </CardContent>
    </Card>
  );
}
