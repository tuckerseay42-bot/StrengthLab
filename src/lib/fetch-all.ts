/**
 * The Data API caps a single response at 1000 rows, and silently hands back only
 * that many. A list that grows past it (workouts, exercises, workout sets,
 * attendance, ...) quietly loses rows, and WHICH rows it loses depends on the
 * sort order. So: page through until a short page comes back, and always give
 * the query a unique tie-break (`.order("id")`) so pages never skip or repeat a
 * row when the first sort column has ties (e.g. many sets at position 1).
 */
export const PAGE = 1000;

export async function fetchAll<T>(
  build: () => {
    range: (
      from: number,
      to: number,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  },
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}
