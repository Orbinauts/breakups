# The prospective test's score

Scored on 2026-10-12 by https://github.com/Orbinauts/breakups/actions/runs/38271144384, by `npm run prospective:score` over this branch's `alerts.jsonl` and the truth on main.

```text
The prospective test of the detector frozen at 2026-10-11T00:00:00.000Z
Alerts logged: suspected 1
Truth: data/breakups.json last changed 2026-10-12T16:52:22.855Z.
Warning: the truth is built from the agencies' reports, which come months after an event; the events since about 2026-07-14 may not be reported yet, so this score is not final for them.

Confirmed headline, events after the freeze: 0 of 0 reported events with pieces confirmed; 0 false confirmations of 0 confirmed alerts.

Early warning (suspected), events after the freeze: 0 of 0 reported events with pieces flagged before the first sign of their fragments, 0 late; 1 false alarm of 1 suspected alerts.

False early warnings (no reported event's step):
  64230 2025-118: raised 2026-10-12T12:00Z, committed 2026-10-12T14:05:25.000Z
```
