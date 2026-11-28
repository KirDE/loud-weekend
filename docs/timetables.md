# Verified stage timetables

Timetables are published only from a reviewed official-festival source. The
catalog intentionally stays empty until a schedule exists for the tracked
edition; the UI states that no verified timetable is published instead of
guessing times from posters or third-party listings.

Prepare an input document outside the repository:

```json
{
  "festivalSlug": "wacken-open-air",
  "editionYear": 2027,
  "entries": [
    {
      "date": "2027-07-28",
      "stage": "Faster",
      "start": "18:30",
      "artist": "Artist name",
      "timeZone": "Europe/Berlin",
      "status": "scheduled",
      "sourceUrl": "https://www.wacken.com/...official-schedule...",
      "observedAt": "2027-07-01T10:00:00.000Z"
    }
  ]
}
```

Validate without changing tracked data, then import atomically:

```bash
npm run timetables:import -- --input=/path/to/reviewed.json --check
npm run timetables:import -- --input=/path/to/reviewed.json --apply
npm run test:data
npm run build
```

The importer rejects invalid calendar dates and IANA timezones, non-official
source hosts, entries outside announced festival dates, duplicate rows, and
two scheduled artists assigned to the same stage slot. A cancellation is kept
as an explicit row so the public timetable does not silently erase a change.
All entries for one festival must use the same timezone.

Use the optional window only when the official schedule gives the end time
(or start and duration) for that same performance and edition. Supply both
startsAt and endsAt as ISO 8601 instants with an explicit offset or UTC Z;
the start instant must match the row's local date, clock time and IANA
timezone. For overnight sets include the actual next date in the end instant.
Leave the window absent for cancelled sets, schedules with only a start time,
or ambiguous local times whose UTC offset cannot be verified. Do not infer an
end from the next performance, slot spacing or artist billing.

After import, visually compare every date, stage, local time, artist and
cancellation with the official source. Production verification is complete
only after the merged deployment displays a populated representative festival
and its source link returns successfully.

An optional organizer performance ID (sourcePerformanceId) must be a stable,
public ID for that specific performance in that edition. Artist names, stage
and start-time combinations, and row positions are not stable source IDs. If
the organizer does not publish a stable ID, omit it and do not try to match
later versions automatically. For an already identified performance, retain
the same ID on verified moves or explicit cancellations. Reusing the ID for a
different artist, switching the organizer hostname, omitting that row, or
replacing it from an older observation
fails the import without modifying the existing timetable.

## Official lineup by day

A day allocation is independent of a stage timetable. Publish an allocation
only after confirming that the festival's official announcement names the
canonical artist and the date for the **selected edition**. An undated lineup,
poster order, or another year's announcement cannot provide an allocation.
Use calendar dates at the festival, not timestamps converted to the editor's
timezone. An artist can appear on several published dates.

Prepare an input document outside the repository. This example is synthetic:

```json
{
  "festivalSlug": "sample-festival",
  "editionYear": 2027,
  "startDate": "2027-07-31",
  "endDate": "2027-08-02",
  "sourceUrl": "https://festival.example/2027/lineup-by-day",
  "observedAt": "2027-07-01T10:00:00Z",
  "entries": [{ "artistSlug": "sample-act", "dates": ["2027-08-01"], "status": "announced" }]
}
```

Use `npm run lineup-days:import -- --input=/path/to/reviewed.json` to preview.
An authorized catalogue operator can add `--apply` after review. The importer
does not fetch or interpret the source. The range must match the edition,
and the document affects only its explicit artists. An empty `dates` array
withdraws a known assignment without inventing a replacement; record an
official artist cancellation with `status: "cancelled"`. An announced allocation
requires an announced artist on the edition roster. An existing cancellation can
still be corrected after the artist is removed from the roster. Each changed record
requires a newer source observation and writes a before/after audit in the
same transaction. Replaying the same document is a no-op.

Apply the additive migration before running the new application code. No
allocations are backfilled. If edition dates are corrected, allocations for
the old range are hidden until reviewed for the new dates. Rolling back the
application leaves the independent allocations and audit history intact.
