import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentOrgId } from "@/hooks/use-current-org";
import { DEFAULT_1RM_FORMULA, isOneRmFormula, type OneRmFormula } from "@/lib/one-rm";

// Module-level cache so non-React helpers (export builders, formatters) can read
// the active org's formula without threading it through every call site.
let cached: OneRmFormula = DEFAULT_1RM_FORMULA;
export function getOrg1RMFormula(): OneRmFormula {
  return cached;
}

export function useOrg1RMFormula(): OneRmFormula {
  const orgId = useCurrentOrgId();
  const { data } = useQuery({
    queryKey: ["org-1rm-formula", orgId],
    enabled: !!orgId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("organizations")
        .select("default_1rm_formula")
        .eq("id", orgId!)
        .maybeSingle();
      const f = (data as { default_1rm_formula?: string } | null)?.default_1rm_formula;
      return isOneRmFormula(f) ? f : DEFAULT_1RM_FORMULA;
    },
  });
  cached = data ?? DEFAULT_1RM_FORMULA;
  return cached;
}
