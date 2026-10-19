# The prospective test's score

Scored on 2026-10-19 by https://github.com/Orbinauts/breakups/actions/runs/39201749264, by `npm run prospective:score` over this branch's `alerts.jsonl` and the truth on main.

```text
The prospective test of the detector frozen at 2026-10-11T00:00:00.000Z
Alerts logged: suspected 45, confirmed 1, cloud 1
Truth: data/breakups.json last changed 2026-10-19T05:41:52.736Z.
Warning: the truth is built from the agencies' reports, which come months after an event; the events since about 2026-07-21 may not be reported yet, so this score is not final for them.

Confirmed headline, events after the freeze: 0 of 0 reported events with pieces confirmed; 0 false confirmations of 1 confirmed alerts.

Confirmed alerts not counted (an event before the freeze, an exempt row, or a duplicate):
  19460 1988-078: detection 19460:2026-09-13: a confirmed verdict on a reported event's parent within 180 days of it

Early warning (suspected), events after the freeze: 0 of 0 reported events with pieces flagged before the first sign of their fragments, 0 late; 45 false alarms of 45 suspected alerts.

False early warnings (no reported event's step):
  64230 2025-118: raised 2026-10-12T12:00Z, committed 2026-10-12T14:05:25.000Z
  53669 2022-105: raised 2026-10-11T12:00Z, committed 2026-10-13T03:08:40.000Z
  61760 2024-199: raised 2026-10-12T04:00Z, committed 2026-10-15T03:21:02.000Z
  13301 1982-066: raised 2026-10-15T08:00Z, committed 2026-10-16T03:19:19.000Z
  19484 1988-081: raised 2026-10-16T04:00Z, committed 2026-10-17T03:18:45.000Z
  22930 1993-078: raised 2026-10-16T04:00Z, committed 2026-10-17T03:18:45.000Z
  28704 2005-023: raised 2026-10-16T04:00Z, committed 2026-10-17T03:18:45.000Z
  18570 1987-095: raised 2026-10-16T12:00Z, committed 2026-10-17T03:18:45.000Z
  13643 1982-106: raised 2026-10-16T20:00Z, committed 2026-10-17T03:18:45.000Z
  23200 1994-049: raised 2026-10-16T20:00Z, committed 2026-10-17T03:18:45.000Z
  21925 1992-017: raised 2026-10-16T20:00Z, committed 2026-10-17T03:18:45.000Z
  24665 1996-067: raised 2026-10-16T20:00Z, committed 2026-10-17T03:18:45.000Z
  25785 1999-033: raised 2026-10-16T20:00Z, committed 2026-10-17T03:18:45.000Z
  26108 2000-016: raised 2026-10-16T20:00Z, committed 2026-10-17T03:18:45.000Z
  27948 2003-043: raised 2026-10-17T04:00Z, committed 2026-10-17T03:18:45.000Z
  28491 2004-042: raised 2026-10-17T04:00Z, committed 2026-10-17T03:18:45.000Z
  11558 1979-086: raised 2026-10-17T12:00Z, committed 2026-10-18T03:19Z
  23429 1994-082: raised 2026-10-17T12:00Z, committed 2026-10-18T03:19Z
  23816 1996-015: raised 2026-10-17T12:00Z, committed 2026-10-18T03:19Z
  25913 1999-050: raised 2026-10-17T12:00Z, committed 2026-10-18T03:19Z
  26578 2000-066: raised 2026-10-17T12:00Z, committed 2026-10-18T03:19Z
  26695 2001-005: raised 2026-10-17T12:00Z, committed 2026-10-18T03:19Z
  20203 1989-069: raised 2026-10-17T12:00Z, committed 2026-10-18T03:19Z
  33460 2008-065: raised 2026-10-17T16:00Z, committed 2026-10-18T03:19Z
  5588 1971-095: raised 2026-10-17T16:00Z, committed 2026-10-18T03:19Z
  12850 1981-069: raised 2026-10-17T16:00Z, committed 2026-10-18T03:19Z
  22087 1992-054: raised 2026-10-17T16:00Z, committed 2026-10-18T03:19Z
  22115 1992-059: raised 2026-10-17T16:00Z, committed 2026-10-18T03:19Z
  23765 1996-002: raised 2026-10-17T16:00Z, committed 2026-10-18T03:19Z
  25349 1996-026: raised 2026-10-17T16:00Z, committed 2026-10-18T03:19Z
  27525 2002-043: raised 2026-10-17T16:00Z, committed 2026-10-18T03:19Z
  12851 1981-061: raised 2026-10-18T00:00Z, committed 2026-10-18T03:19Z
  22839 1993-062: raised 2026-10-18T00:00Z, committed 2026-10-18T03:19Z
  36517 2010-016: raised 2026-10-18T08:00Z, committed 2026-10-19T03:22:26.000Z
  4630 1970-093: raised 2026-10-18T08:00Z, committed 2026-10-19T03:22:26.000Z
  19550 1988-091: raised 2026-10-18T08:00Z, committed 2026-10-19T03:22:26.000Z
  19686 1988-108: raised 2026-10-18T08:00Z, committed 2026-10-19T03:22:26.000Z
  20370 1989-098: raised 2026-10-18T08:00Z, committed 2026-10-19T03:22:26.000Z
  22931 1993-078: raised 2026-10-18T08:00Z, committed 2026-10-19T03:22:26.000Z
  25048 1997-070: raised 2026-10-18T08:00Z, committed 2026-10-19T03:22:26.000Z
  23764 1996-002: raised 2026-10-18T12:00Z, committed 2026-10-19T03:22:26.000Z
  25492 1998-056: raised 2026-10-18T16:00Z, committed 2026-10-19T03:22:26.000Z
  26736 2001-014: raised 2026-10-18T16:00Z, committed 2026-10-19T03:22:26.000Z
  15545 1985-010: raised 2026-10-19T04:00Z, committed 2026-10-19T03:22:26.000Z
  22213 1992-074: raised 2026-10-19T04:00Z, committed 2026-10-19T03:22:26.000Z
```
