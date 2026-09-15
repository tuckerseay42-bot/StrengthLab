// Resolves scoping IDs (organization_id, user_id) from server/session context
// rather than trusting form input or DB defaults. Use this at every insert
// call site that writes to an org-scoped table.

import { supabase } from "@/integrations/supabase/client";
import { getCurrentOrgId } from "@/hooks/use-current-org";

export type ScopedIds = { organization_id: string; user_id: string };

export async function getScopedIds(): Promise<ScopedIds> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in and try again.");
  const organization_id = await getCurrentOrgId();
  if (!organization_id) {
    throw new Error("No active organization. Ask an admin to add you to an organization, then try again.");
  }
  return { organization_id, user_id: user.id };
}

export async function getScopedOrgId(): Promise<string> {
  const organization_id = await getCurrentOrgId();
  if (!organization_id) {
    throw new Error("No active organization. Ask an admin to add you to an organization, then try again.");
  }
  return organization_id;
}
