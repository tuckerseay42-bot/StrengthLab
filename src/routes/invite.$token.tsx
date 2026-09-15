import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";

export const Route = createFileRoute("/invite/$token")({
  component: InviteAcceptPage,
  head: () => ({ meta: [{ title: "Accept Invite" }] }),
});

function InviteAcceptPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<{
    email: string;
    organization_name: string;
    member_role: string;
    expires_at: string;
    accepted_at: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: user } = await supabase.auth.getUser();
      setAuthed(!!user.user);
      const { data, error } = await supabase.rpc("get_invite", { _token: token });
      if (error || !data || (Array.isArray(data) && data.length === 0)) {
        setInvite(null);
      } else {
        const row = Array.isArray(data) ? data[0] : data;
        setInvite(row as typeof invite extends null ? never : NonNullable<typeof invite>);
      }
      setLoading(false);
    })();
  }, [token]);

  const accept = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("accept_invite", { _token: token });
    setBusy(false);
    if (error) {
      toast.error(toUserMessage(error));
      return;
    }
    toast.success(`Joined ${invite?.organization_name}`);
    navigate({ to: "/" });
  };

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!invite) return (
    <div className="mx-auto max-w-md rounded-lg border border-border p-6 text-center">
      <h1 className="text-xl font-semibold">Invalid invite</h1>
      <p className="mt-2 text-sm text-muted-foreground">This link is not valid or has been removed.</p>
    </div>
  );

  const expired = new Date(invite.expires_at) < new Date();
  const used = !!invite.accepted_at;

  return (
    <div className="mx-auto max-w-md space-y-4 rounded-lg border border-border p-6">
      <h1 className="text-xl font-semibold">You're invited</h1>
      <div className="text-sm">
        <p><span className="text-muted-foreground">Organization:</span> <span className="font-medium">{invite.organization_name}</span></p>
        <p><span className="text-muted-foreground">Role:</span> <span className="capitalize">{invite.member_role}</span></p>
        <p><span className="text-muted-foreground">Email:</span> {invite.email}</p>
      </div>

      {used ? (
        <p className="text-sm text-muted-foreground">This invite has already been accepted.</p>
      ) : expired ? (
        <p className="text-sm text-destructive">This invite has expired. Ask the org owner to send a new one.</p>
      ) : !authed ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Sign in with <strong>{invite.email}</strong> to accept.</p>
          <Button className="w-full" onClick={() => navigate({ to: "/auth", search: { redirect: `/invite/${token}` } as never })}>
            Sign in / Sign up
          </Button>
        </div>
      ) : (
        <Button className="w-full" onClick={accept} disabled={busy}>
          {busy ? "Joining…" : `Accept & join ${invite.organization_name}`}
        </Button>
      )}
    </div>
  );
}
