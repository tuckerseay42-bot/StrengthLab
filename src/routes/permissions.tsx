import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";
import { ALL_ROLES, PERMISSION_KEYS, PERMISSION_LABELS, ROLE_LABELS, useMyPermissions, type AppRole, type PermissionKey } from "@/hooks/use-permissions";

export const Route = createFileRoute("/permissions")({
  head: () => ({ meta: [{ title: "Roles & Permissions — Strength Lab" }] }),
  component: PermissionsPage,
});

function PermissionsPage() {
  const qc = useQueryClient();
  const me = useMyPermissions();
  const isAdmin = (me.data?.roles ?? []).some((r) => r === "owner" || r === "administrator" || r === "admin");

  const rowsQ = useQuery({
    queryKey: ["role_permissions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("role_permissions").select("role,permission");
      if (error) throw error;
      return data ?? [];
    },
  });

  const matrix = new Set((rowsQ.data ?? []).map((r) => `${r.role}::${r.permission}`));

  const toggle = useMutation({
    mutationFn: async ({ role, perm, on }: { role: AppRole; perm: PermissionKey; on: boolean }) => {
      if (on) {
        const { error } = await supabase.from("role_permissions").insert({ role, permission: perm });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("role_permissions").delete().eq("role", role).eq("permission", perm);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["role_permissions"] }); qc.invalidateQueries({ queryKey: ["my-permissions"] }); },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const editableRoles = ALL_ROLES.filter((r) => r !== "owner" && r !== "administrator");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">Roles & Permissions</h1>
        <p className="text-sm text-muted-foreground">
          Owner and Administrator always have every permission. Toggle checkboxes to change what each other role can do.
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {(me.data?.roles ?? []).map((r) => <Badge key={r} variant="secondary">{ROLE_LABELS[r] ?? r}</Badge>)}
          {(me.data?.roles ?? []).length === 0 && <Badge variant="outline">No roles assigned</Badge>}
        </div>
      </div>

      {!isAdmin && (
        <Card><CardContent className="py-4 text-sm text-muted-foreground">You can view the permissions matrix, but only owners and administrators can change it.</CardContent></Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Permission matrix</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2 font-medium">Permission</th>
                {editableRoles.map((r) => (
                  <th key={r} className="p-2 text-center font-medium whitespace-nowrap">{ROLE_LABELS[r]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_KEYS.map((perm) => (
                <tr key={perm} className="border-b hover:bg-muted/40">
                  <td className="p-2">
                    <div className="font-medium">{PERMISSION_LABELS[perm] ?? perm}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{perm}</div>
                  </td>
                  {editableRoles.map((role) => {
                    const on = matrix.has(`${role}::${perm}`);
                    return (
                      <td key={role} className="p-2 text-center">
                        <Checkbox
                          checked={on}
                          disabled={!isAdmin || toggle.isPending}
                          onCheckedChange={(v) => toggle.mutate({ role, perm, on: v === true })}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
