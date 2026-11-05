/**
 * The Data API caps a single response at 1000 rows, and silently hands back only
 * that many. A list that grows past it (workouts, exercises, workout sets,
 * attendance, ...) quietly loses rows, and WHICH rows it loses depends on the
 * sort order. So: page through until a short page comes back, and always give
 * the query a unique tie-break (`.order("id")`) so pages never skip or repeat a
 * row when the first sort column has ties (e.g. many sets at position 1).
 */
export const PAGE = 1000;
// After the first (full) page, ask for this many more pages at once instead of one
// after another. Each round trip to the database is slow on a phone; a table of
// 5,000 rows used to cost five waits in a row.
const PARALLEL = 4;

export async function fetchAll<T>(
  build: () => {
    range: (
      from: number,
      to: number,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  },
): Promise<T[]> {
  const page = async (from: number): Promise<T[]> => {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    return (data ?? []) as T[];
  };

  const out = await page(0);
  if (out.length < PAGE) return out;
  for (let from = PAGE; ; from += PAGE * PARALLEL) {
    const batch = await Promise.all(
      Array.from({ length: PARALLEL }, (_, i) => page(from + i * PAGE)),
    );
    for (const rows of batch) {
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }
}
