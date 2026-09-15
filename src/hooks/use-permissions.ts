import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];

export const ALL_ROLES: AppRole[] = [
  "owner",
  "administrator",
  "coach",
  "assistant_coach",
  "sport_coach",
  "athlete",
  "parent",
  "platform_owner",
];

export const ROLE_LABELS: Record<AppRole, string> = {
  owner: "Owner",
  administrator: "Administrator",
  coach: "Coach",
  assistant_coach: "Assistant Coach",
  sport_coach: "Sport Coach",
  athlete: "Athlete",
  parent: "Parent (view only)",
  platform_owner: "Platform Owner",
  admin: "Admin (legacy)",
  user: "User (legacy)",
};

export const PERMISSION_KEYS = [
  "athletes.view", "athletes.create", "athletes.edit", "athletes.delete",
  "tests.view", "tests.edit",
  "lifts.view", "lifts.edit",
  "attendance.view", "attendance.edit",
  "workouts.view", "workouts.edit",
  "metrics.view", "metrics.create",
  "reports.view", "reports.create",
  "dashboards.view", "dashboards.build",
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/** Loads the current user's roles + effective permissions from role_permissions. */
export function useMyPermissions() {
  return useQuery({
    queryKey: ["my-permissions"],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return { roles: [] as AppRole[], permissions: new Set<string>() };

      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", uid);
      const roleList = (roles ?? []).map((r) => r.role as AppRole);

      // owner / administrator / admin => all perms
      const superuser = roleList.some((r) => r === "owner" || r === "administrator" || r === "admin");
      if (superuser) return { roles: roleList, permissions: new Set<string>(PERMISSION_KEYS) };

      if (roleList.length === 0) return { roles: roleList, permissions: new Set<string>() };

      const { data: perms } = await supabase
        .from("role_permissions").select("permission").in("role", roleList);

      return { roles: roleList, permissions: new Set<string>((perms ?? []).map((p) => p.permission)) };
    },
    staleTime: 60_000,
  });
}

/** Convenience: check a single permission. Returns { allowed, isLoading }. */
export function usePermission(key: PermissionKey) {
  const { data, isLoading } = useMyPermissions();
  return { allowed: data?.permissions.has(key) ?? false, isLoading };
}
