import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";
import { publicOrigin } from "@/lib/share-url";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Snowflake,
  Sun,
  Trash2,
  X,
} from "lucide-react";

export const Route = createFileRoute("/organizations")({
  component: OrganizationsPage,
  head: () => ({ meta: [{ title: "Organizations — Super Admin" }] }),
});

type Org = {
  id: string;
  name: string;
  slug: string | null;
  created_at: string;
  frozen_at: string | null;
};

type Invite = {
  id: string;
  email: string;
  role: string;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
};

const ORG_ROLES = ["owner", "coach"] as const;
type OrgRole = (typeof ORG_ROLES)[number];

function OrganizationsPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: isSuperAdmin = false } = useQuery({
    queryKey: ["is-super-admin"],
    queryFn: async () => {
      const { data } = await supabase.rpc("is_super_admin" as never);
      return Boolean(data);
    },
    staleTime: 5 * 60_000,
  });


  const { data: orgs = [], isLoading } = useQuery({
    queryKey: ["orgs-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name, slug, created_at, frozen_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Org[];
    },
  });

  const createOrg = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Name required");
      const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const { data: org, error } = await supabase
        .from("organizations")
        .insert({ name: trimmed, slug } as never)
        .select("id")
        .single();
      if (error) throw error;

      if (ownerEmail.trim()) {
        const { error: invErr } = await supabase
          .from("organization_invites")
          .insert({
            organization_id: (org as { id: string }).id,
            email: ownerEmail.trim().toLowerCase(),
            role: "owner",
          } as never);
        if (invErr) throw invErr;
      }
      return (org as { id: string }).id;
    },
    onSuccess: (newId) => {
      toast.success("Organization created");
      setName("");
      setOwnerEmail("");
      setExpandedId(newId);
      qc.invalidateQueries({ queryKey: ["orgs-all"] });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const toggleFreeze = useMutation({
    mutationFn: async (org: Org) => {
      const { error } = await supabase
        .from("organizations")
        .update({ frozen_at: org.frozen_at ? null : new Date().toISOString() } as never)
        .eq("id", org.id);
      if (error) throw error;
      return !org.frozen_at;
    },
    onSuccess: (nowFrozen) => {
      toast.success(nowFrozen ? "Organization frozen" : "Organization unfrozen");
      qc.invalidateQueries({ queryKey: ["orgs-all"] });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const deleteOrg = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("organizations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Organization deleted");
      qc.invalidateQueries({ queryKey: ["orgs-all"] });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Organizations</h1>
        <p className="text-sm text-muted-foreground">
          {isSuperAdmin
            ? "Super admin. Create a new org for a coach you're onboarding, invite their owner, or manage existing ones."
            : "View your organizations and manage members and invites."}
        </p>

      </div>

      {isSuperAdmin && (
      <div className="rounded-lg border border-border p-4 space-y-3">
        <h2 className="font-medium">Provision a new coach's organization</h2>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input
            placeholder="Organization name (e.g. Lincoln High Athletics)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            placeholder="Owner email (the coach)"

            type="email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
          />
          <Button onClick={() => createOrg.mutate()} disabled={createOrg.isPending}>
            Create
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Providing an owner email generates an invite. Open the org below to copy the link and send it to
          them — accepting the link makes them the owner.
        </p>
      </div>
      )}


      <div className="rounded-lg border border-border">
        <div className="border-b border-border px-4 py-2 text-sm font-medium">All organizations</div>
        {isLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="px-4 py-3">
                <div className="h-5 w-40 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-3 w-24 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : orgs.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No organizations yet.</div>
        ) : (
          <ul className="divide-y divide-border">
            {orgs.map((o) => {
              const expanded = expandedId === o.id;
              return (
                <li key={o.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : o.id)}
                      className="flex items-center gap-2 min-w-0 text-left flex-1 cursor-pointer"
                    >
                      {expanded ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{o.name}</span>
                          {o.frozen_at && (
                            <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                              FROZEN
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{o.slug}</div>
                      </div>
                    </button>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground hidden sm:inline">
                        {new Date(o.created_at).toLocaleDateString()}
                      </span>
                      {isSuperAdmin && (
                      <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleFreeze.mutate(o)}
                        disabled={toggleFreeze.isPending}
                      >
                        {o.frozen_at ? <><Sun /> Unfreeze</> : <><Snowflake /> Freeze</>}
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="destructive"><Trash2 /></Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete "{o.name}"?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This permanently removes the organization and all of its members, teams,
                              athletes, and related data. This cannot be undone. Consider freezing instead
                              if you might restore access later.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteOrg.mutate(o.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete permanently
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      </>
                      )}

                    </div>
                  </div>
                  {expanded && <OrgDetails orgId={o.id} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function OrgDetails({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("owner");

  const { data: invites = [], isLoading } = useQuery({
    queryKey: ["org-invites", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_invites")
        .select("id, email, role, token, expires_at, accepted_at, created_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Invite[];
    },
  });

  const { data: members = [] } = useQuery({
    queryKey: ["org-members", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("user_id, role, created_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const createInvite = useMutation({
    mutationFn: async () => {
      const trimmed = email.trim().toLowerCase();
      if (!trimmed) throw new Error("Email required");
      const { error } = await supabase.from("organization_invites").insert({
        organization_id: orgId,
        email: trimmed,
        role,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Invite created");
      setEmail("");
      qc.invalidateQueries({ queryKey: ["org-invites", orgId] });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const revokeInvite = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("organization_invites").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Invite revoked");
      qc.invalidateQueries({ queryKey: ["org-invites", orgId] });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const copyLink = async (token: string) => {
    const url = `${publicOrigin()}/invite/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Invite link copied");
    } catch {
      toast.error("Copy failed — link: " + url);
    }
  };

  return (
    <div className="mt-3 ml-6 space-y-4 border-l border-border pl-4">
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-2">
          Members ({members.length})
        </div>
        {members.length === 0 ? (
          <div className="text-xs text-muted-foreground">No members have joined yet.</div>
        ) : (
          <ul className="text-sm space-y-1">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground truncate">{m.user_id}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase">{m.role}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="text-xs font-medium text-muted-foreground mb-2">Create invite</div>
        <div className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
          <Input
            placeholder="coach@example.com"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Select value={role} onValueChange={(v) => setRole(v as OrgRole)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ORG_ROLES.map((r) => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => createInvite.mutate()} disabled={createInvite.isPending}>
            Create invite
          </Button>
        </div>
      </div>

      <div>
        <div className="text-xs font-medium text-muted-foreground mb-2">Invites</div>
        {isLoading ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : invites.length === 0 ? (
          <div className="text-xs text-muted-foreground">No invites yet.</div>
        ) : (
          <ul className="space-y-2">
            {invites.map((inv) => {
              const expired = new Date(inv.expires_at) < new Date();
              const status = inv.accepted_at ? "accepted" : expired ? "expired" : "pending";
              return (
                <li
                  key={inv.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate">{inv.email}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase">
                        {inv.role}
                      </span>
                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-[10px] uppercase " +
                          (status === "accepted"
                            ? "bg-[color:var(--status-pr)]/15 text-[color:var(--status-pr)]"
                            : status === "expired"
                              ? "bg-destructive/15 text-destructive"
                              : "bg-[color:var(--status-near)]/15 text-[color:var(--status-near)]")
                        }
                      >
                        {status}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Expires {new Date(inv.expires_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!inv.accepted_at && !expired && (
                      <Button size="sm" variant="outline" onClick={() => copyLink(inv.token)}>
                        <Copy /> Copy link
                      </Button>
                    )}
                    {!inv.accepted_at && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => revokeInvite.mutate(inv.id)}
                        disabled={revokeInvite.isPending}
                        aria-label="Revoke invite"
                      >
                        <X />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
