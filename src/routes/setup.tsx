import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";
import { useCurrentOrgId } from "@/hooks/use-current-org";
import { markSetupDismissed } from "@/hooks/use-onboarding";
import { publicOrigin } from "@/lib/share-url";
import {
  Check, ChevronRight, Dumbbell, Users, Mail, UserPlus,
  ArrowRight, Sparkles, Upload, X, Copy,
} from "lucide-react";

export const Route = createFileRoute("/setup")({
  head: () => ({
    meta: [
      { title: "Set up your organization — Strength Lab" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SetupWizard,
});

type Step = 0 | 1 | 2 | 3 | 4;
const STEPS: { key: Step; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 0, label: "Welcome", icon: Sparkles },
  { key: 1, label: "First team", icon: Users },
  { key: 2, label: "Invite a coach", icon: Mail },
  { key: 3, label: "Add athletes", icon: UserPlus },
  { key: 4, label: "You're set", icon: Check },
];

const STORAGE_KEY = "sl.setupStep";

function SetupWizard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const orgId = useCurrentOrgId();
  const [step, setStep] = useState<Step>(() => {
    if (typeof window === "undefined") return 0;
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const n = raw ? Number(raw) : 0;
    return (Number.isFinite(n) && n >= 0 && n <= 4 ? n : 0) as Step;
  });

  useEffect(() => {
    if (typeof window !== "undefined") window.sessionStorage.setItem(STORAGE_KEY, String(step));
  }, [step]);

  const { data: org } = useQuery({
    queryKey: ["setup-org", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from("organizations")
        .select("id, name, slug").eq("id", orgId!).maybeSingle();
      return data;
    },
  });

  const finish = () => {
    markSetupDismissed(orgId);
    if (typeof window !== "undefined") window.sessionStorage.removeItem(STORAGE_KEY);
    qc.invalidateQueries({ queryKey: ["onboarding-counts"] });
  };

  const skipAll = () => {
    finish();
    navigate({ to: "/", replace: true });
  };

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-3xl flex-col px-4 py-6 sm:py-10">
      {/* Progress rail */}
      <div className="mb-6 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Dumbbell className="h-4 w-4" />
          </div>
          Strength Lab setup
        </div>
        <button
          type="button"
          onClick={skipAll}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Skip setup
        </button>
      </div>

      <ol className="mb-6 grid grid-cols-5 gap-1 sm:gap-2">
        {STEPS.map((s) => {
          const done = step > s.key;
          const active = step === s.key;
          return (
            <li key={s.key} className="flex flex-col items-center gap-1">
              <div
                className={
                  "flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold transition " +
                  (done
                    ? "border-primary bg-primary text-primary-foreground"
                    : active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground")
                }
              >
                {done ? <Check className="h-4 w-4" /> : s.key + 1}
              </div>
              <span className={"hidden text-center text-[11px] sm:block " + (active ? "font-medium text-foreground" : "text-muted-foreground")}>
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="flex-1 rounded-xl border border-border bg-card p-5 sm:p-8">
        {step === 0 && (
          <WelcomeStep orgName={org?.name ?? "your organization"} onNext={() => setStep(1)} />
        )}
        {step === 1 && orgId && (
          <TeamStep
            orgId={orgId}
            onNext={() => setStep(2)}
            onBack={() => setStep(0)}
          />
        )}
        {step === 2 && orgId && (
          <InviteStep
            orgId={orgId}
            onNext={() => setStep(3)}
            onBack={() => setStep(1)}
          />
        )}
        {step === 3 && orgId && (
          <AthleteStep
            orgId={orgId}
            onNext={() => setStep(4)}
            onBack={() => setStep(2)}
          />
        )}
        {step === 4 && (
          <FinishStep
            onDone={() => { finish(); navigate({ to: "/rack-console" }); }}
            onProgram={() => { finish(); navigate({ to: "/programming" }); }}
            onLater={skipAll}
          />
        )}
      </div>
    </div>
  );
}

/* --------------------------------- Steps --------------------------------- */

function WelcomeStep({ orgName, onNext }: { orgName: string; onNext: () => void }) {
  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="h-7 w-7" />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Welcome to {orgName}</h1>
        <p className="mx-auto max-w-lg text-sm text-muted-foreground">
          We'll get you running in about two minutes: create your first team,
          invite a coach, and add athletes. You can change or add anything
          later from Settings.
        </p>
      </div>
      <div className="pt-2">
        <Button size="lg" className="h-12 min-w-[220px]" onClick={onNext}>
          Get started <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

type Team = { id: string; name: string; color: string | null };

function TeamStep({ orgId, onNext, onBack }: { orgId: string; onNext: () => void; onBack: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#3B82F6");

  const { data: teams = [] } = useQuery({
    queryKey: ["setup-teams", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("teams")
        .select("id, name, color").eq("organization_id", orgId)
        .is("archived_at", null).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Team[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Team name is required");
      const { error } = await supabase.from("teams").insert({
        name: trimmed, color, organization_id: orgId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setName("");
      qc.invalidateQueries({ queryKey: ["setup-teams", orgId] });
      qc.invalidateQueries({ queryKey: ["teams"] });
      toast.success("Team added");
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const canContinue = teams.length > 0;

  return (
    <div className="space-y-6">
      <StepHeader
        icon={Users}
        title="Add your first team"
        description="Teams are how you group athletes. Start with the squad you'll train first — you can add more anytime."
      />

      <form
        onSubmit={(e) => { e.preventDefault(); add.mutate(); }}
        className="grid gap-3 sm:grid-cols-[1fr_100px_auto]"
      >
        <Input
          autoFocus
          placeholder="e.g. Varsity Football"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-12 text-base"
        />
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-12 w-full cursor-pointer rounded-md border border-input bg-background"
            aria-label="Team color"
          />
        </div>
        <Button type="submit" size="lg" className="h-12" disabled={add.isPending || !name.trim()}>
          Add team
        </Button>
      </form>

      {teams.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Added</div>
          <ul className="flex flex-wrap gap-2">
            {teams.map((t) => (
              <li
                key={t.id}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-sm"
              >
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: t.color ?? "hsl(var(--primary))" }}
                />
                {t.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      <StepFooter
        onBack={onBack}
        onNext={onNext}
        nextDisabled={!canContinue}
        nextLabel={canContinue ? "Continue" : "Add a team to continue"}
      />
    </div>
  );
}

type Invite = { id: string; email: string; role: string; token: string };

function InviteStep({ orgId, onNext, onBack }: { orgId: string; onNext: () => void; onBack: () => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("coach");

  const { data: invites = [] } = useQuery({
    queryKey: ["setup-invites", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("organization_invites")
        .select("id, email, role, token")
        .eq("organization_id", orgId)
        .is("accepted_at", null)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as Invite[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const trimmed = email.trim().toLowerCase();
      if (!trimmed) throw new Error("Email is required");
      const { error } = await supabase.from("organization_invites").insert({
        organization_id: orgId, email: trimmed, role: role as "coach" | "owner",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setEmail("");
      qc.invalidateQueries({ queryKey: ["setup-invites", orgId] });
      toast.success("Invite created — copy the link and send it to them");
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const copyLink = async (token: string) => {
    const url = `${publicOrigin()}/invite/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Invite link copied");
    } catch {
      toast.error(`Copy failed — link: ${url}`);
    }
  };

  return (
    <div className="space-y-6">
      <StepHeader
        icon={Mail}
        title="Invite your first coach"
        description="Send them the invite link. When they accept, they'll get the role you pick here. You can invite more later."
      />

      <form
        onSubmit={(e) => { e.preventDefault(); add.mutate(); }}
        className="grid gap-3 sm:grid-cols-[1fr_160px_auto]"
      >
        <Input
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          placeholder="coach@school.edu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-12 text-base"
        />
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="h-12"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="coach">Coach</SelectItem>
            <SelectItem value="owner">Owner</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" size="lg" className="h-12" disabled={add.isPending || !email.trim()}>
          Create invite
        </Button>
      </form>

      {invites.length > 0 && (
        <ul className="space-y-2">
          {invites.map((inv) => (
            <li
              key={inv.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{inv.email}</div>
                <div className="text-[11px] uppercase text-muted-foreground">{inv.role}</div>
              </div>
              <Button size="sm" variant="outline" className="h-10" onClick={() => copyLink(inv.token)}>
                <Copy className="mr-1 h-4 w-4" /> Copy link
              </Button>
            </li>
          ))}
        </ul>
      )}

      <StepFooter
        onBack={onBack}
        onNext={onNext}
        nextLabel="Continue"
        secondary={{ label: "Skip for now", onClick: onNext }}
      />
    </div>
  );
}

type Draft = { name: string; team_id: string | null };

function AthleteStep({ orgId, onNext, onBack }: { orgId: string; onNext: () => void; onBack: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"manual" | "bulk">("manual");
  const [drafts, setDrafts] = useState<Draft[]>([{ name: "", team_id: null }]);

  const { data: teams = [] } = useQuery({
    queryKey: ["setup-teams", orgId],
    queryFn: async () => {
      const { data } = await supabase.from("teams")
        .select("id, name").eq("organization_id", orgId).is("archived_at", null);
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const { data: athleteCount = 0 } = useQuery({
    queryKey: ["setup-athlete-count", orgId],
    queryFn: async () => {
      const { count } = await supabase.from("athletes")
        .select("id", { count: "exact", head: true }).eq("organization_id", orgId);
      return count ?? 0;
    },
    refetchInterval: tab === "bulk" ? 4000 : false,
  });

  const commit = useMutation({
    mutationFn: async () => {
      const rows = drafts
        .map((d) => ({ ...d, name: d.name.trim() }))
        .filter((d) => d.name.length > 0);
      if (rows.length === 0) throw new Error("Add at least one athlete");
      const payload = rows.map((d) => {
        const [first, ...rest] = d.name.split(/\s+/);
        return {
          organization_id: orgId,
          name: d.name,
          first_name: first || null,
          last_name: rest.join(" ") || null,
          team_id: d.team_id,
          status: "active",
        };
      });
      const { error } = await supabase.from("athletes").insert(payload);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (count) => {
      toast.success(`Added ${count} ${count === 1 ? "athlete" : "athletes"}`);
      setDrafts([{ name: "", team_id: null }]);
      qc.invalidateQueries({ queryKey: ["setup-athlete-count", orgId] });
      qc.invalidateQueries({ queryKey: ["athletes"] });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const canContinue = athleteCount > 0;

  return (
    <div className="space-y-5">
      <StepHeader
        icon={UserPlus}
        title="Add athletes"
        description="Add a few by hand now, or import a full roster. You can always add more later."
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as "manual" | "bulk")}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="manual" className="h-11">Manual</TabsTrigger>
          <TabsTrigger value="bulk" className="h-11">Bulk import</TabsTrigger>
        </TabsList>

        <TabsContent value="manual" className="mt-4 space-y-3">
          <ul className="space-y-2">
            {drafts.map((d, idx) => (
              <li key={idx} className="grid gap-2 sm:grid-cols-[1fr_180px_44px]">
                <Input
                  placeholder="Full name"
                  value={d.name}
                  className="h-11"
                  onChange={(e) => {
                    const next = [...drafts];
                    next[idx] = { ...next[idx], name: e.target.value };
                    setDrafts(next);
                  }}
                />
                <Select
                  value={d.team_id ?? "none"}
                  onValueChange={(v) => {
                    const next = [...drafts];
                    next[idx] = { ...next[idx], team_id: v === "none" ? null : v };
                    setDrafts(next);
                  }}
                >
                  <SelectTrigger className="h-11"><SelectValue placeholder="Team" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No team</SelectItem>
                    {teams.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 w-11 p-0"
                  aria-label="Remove row"
                  disabled={drafts.length === 1}
                  onClick={() => setDrafts(drafts.filter((_, i) => i !== idx))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => setDrafts([...drafts, { name: "", team_id: null }])}
            >
              Add another row
            </Button>
            <Button
              type="button"
              className="h-11"
              onClick={() => commit.mutate()}
              disabled={commit.isPending || drafts.every((d) => !d.name.trim())}
            >
              Save athletes
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="bulk" className="mt-4 space-y-3">
          <div className="rounded-md border border-dashed border-border p-5 text-center">
            <Upload className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm">
              Open the roster importer in a new tab and paste your CSV.
            </p>
            <Link
              to="/import"
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              Open importer
            </Link>
            <p className="mt-2 text-xs text-muted-foreground">
              We'll auto-detect once athletes appear — currently {athleteCount}.
            </p>
          </div>
        </TabsContent>
      </Tabs>

      <StepFooter
        onBack={onBack}
        onNext={onNext}
        nextLabel={canContinue ? "Continue" : "Continue without athletes"}
        secondary={!canContinue ? { label: "Skip for now", onClick: onNext } : undefined}
      />
    </div>
  );
}

function FinishStep({
  onDone, onProgram, onLater,
}: { onDone: () => void; onProgram: () => void; onLater: () => void }) {
  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Check className="h-7 w-7" />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">You're set up.</h1>
        <p className="mx-auto max-w-lg text-sm text-muted-foreground">
          Head to Training View to run today's session, or open the Program
          Builder to schedule the next block.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Button size="lg" className="h-14" onClick={onDone}>
          Open Training View <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
        <Button size="lg" variant="outline" className="h-14" onClick={onProgram}>
          Open Program Builder <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
      <button
        type="button"
        onClick={onLater}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        Go to dashboard instead
      </button>
    </div>
  );
}

/* --------------------------------- Chrome -------------------------------- */

function StepHeader({
  icon: Icon, title, description,
}: { icon: React.ComponentType<{ className?: string }>; title: string; description: string }) {
  return (
    <div className="space-y-2">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
      <p className="max-w-xl text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function StepFooter({
  onBack, onNext, nextLabel, nextDisabled, secondary,
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel: string;
  nextDisabled?: boolean;
  secondary?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
      <Button variant="ghost" className="h-11" onClick={onBack}>Back</Button>
      <div className="flex flex-wrap items-center gap-2">
        {secondary && (
          <button
            type="button"
            onClick={secondary.onClick}
            className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            {secondary.label}
          </button>
        )}
        <Button size="lg" className="h-11" onClick={onNext} disabled={nextDisabled}>
          {nextLabel} <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

