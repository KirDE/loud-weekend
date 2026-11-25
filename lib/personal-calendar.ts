import type { Festival } from "./domain/festival.ts";
import { festivalDateInterval } from "./festival-dates.ts";

export function personalCalendar(
  festivals: Festival[],
  attendance: Readonly<Record<string, string>>,
) {
  const dated: { festival: Festival; start: Date; end: Date }[] = [];
  const undated: Festival[] = [];
  for (const festival of festivals) {
    if (attendance[festival.slug] !== "going" && attendance[festival.slug] !== "maybe") continue;
    const interval = festivalDateInterval(festival);
    if (interval) dated.push({ festival, ...interval });
    else undated.push(festival);
  }
  dated.sort(
    (a, b) =>
      a.start.valueOf() - b.start.valueOf() || a.festival.slug.localeCompare(b.festival.slug),
  );
  const conflicts = dated.flatMap((left, index) => {
    const pairs = [];
    for (let next = index + 1; next < dated.length; next++) {
      const right = dated[next];
      if (right.start > left.end) break;
      pairs.push({
        first: left.festival,
        second: right.festival,
        range: {
          startDate: right.start.toISOString().slice(0, 10),
          endDate: (left.end < right.end ? left.end : right.end).toISOString().slice(0, 10),
        },
      });
    }
    return pairs;
  });
  return { dated: dated.map(({ festival }) => festival), undated, conflicts };
}
