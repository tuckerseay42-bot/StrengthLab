import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentOrgId } from "@/hooks/use-current-org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";
import { Copy, Trash2 } from "lucide-react";
import { publicOrigin } from "@/lib/share-url";

export const Route = createFileRoute("/org-members")({
  component: OrgMembersPage,
  head: () => ({ meta: [{ title: "Coaches & Invites — Organization" }] }),
});

function OrgMembersPage() {
  const orgId = useCurrentOrgId();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"coach" | "owner">("coach");

  const { data: members = [] } = useQuery({
    queryKey: ["org-members", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("id, user_id, role, created_at")
        .eq("organization_id", orgId!)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: invites = [] } = useQuery({
    queryKey: ["org-invites", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_invites")
        .select("id, email, role, token, expires_at, accepted_at, created_at")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const createInvite = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No org");
      if (!email.trim()) throw new Error("Email required");
      const { error } = await supabase
        .from("organization_invites")
        .insert({
          organization_id: orgId,
          email: email.trim().toLowerCase(),
          role,
        } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Invite created — copy the link and send it");
      setEmail("");
      qc.invalidateQueries({ queryKey: ["org-invites", orgId] });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const deleteInvite = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("organization_invites").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org-invites", orgId] }),
  });

  const removeMember = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("organization_members").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org-members", orgId] }),
  });

  const copyLink = (token: string) => {
    const url = `${publicOrigin()}/invite/${token}`;
    navigator.clipboard.writeText(url);
    toast.success("Invite link copied");
  };

  if (!orgId) return <div className="text-sm text-muted-foreground">You are not a member of any organization yet.</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Coaches & Invites</h1>
        <p className="text-sm text-muted-foreground">Manage who has access to your organization.</p>
      </div>

      <div className="rounded-lg border border-border p-4 space-y-3">
        <h2 className="font-medium">Invite a coach</h2>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Input placeholder="coach@school.edu" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select
            className="rounded-md border border-input bg-background px-3 text-sm"
            value={role}
            onChange={(e) => setRole(e.target.value as "coach" | "owner")}
          >
            <option value="coach">Coach</option>
            <option value="owner">Owner</option>
          </select>
          <Button onClick={() => createInvite.mutate()} disabled={createInvite.isPending}>Create invite</Button>
        </div>
        <p className="text-xs text-muted-foreground">After creating the invite, copy the link below and send it to the coach.</p>
      </div>

      <div className="rounded-lg border border-border">
        <div className="border-b border-border px-4 py-2 text-sm font-medium">Pending invites</div>
        {invites.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No pending invites.</div>
        ) : (
          <ul className="divide-y divide-border">
            {invites.map((i) => {
              const used = !!i.accepted_at;
              const expired = new Date(i.expires_at) < new Date();
              return (
                <li key={i.id} className="flex items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{i.email}</div>
                    <div className="text-xs text-muted-foreground">
                      {i.role} · {used ? "accepted" : expired ? "expired" : `expires ${new Date(i.expires_at).toLocaleDateString()}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!used && !expired && (
                      <Button size="sm" variant="outline" onClick={() => copyLink(i.token)}>
                        <Copy className="h-3.5 w-3.5 mr-1" /> Link
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => deleteInvite.mutate(i.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-border">
        <div className="border-b border-border px-4 py-2 text-sm font-medium">Members</div>
        {members.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No members.</div>
        ) : (
          <ul className="divide-y divide-border">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs truncate">{m.user_id}</div>
                  <div className="text-xs text-muted-foreground capitalize">{m.role}</div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => removeMember.mutate(m.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
