# The ground truth

The list of reported breakups the detector is scored against. It ships in the package as `data/breakups.json`, one row per breakup an authority reported since 1961, with every source's statement and the values resolved from them. A script builds it from its sources, and the tests check it. The full generated report, with the counts per year and per source, is [docs/truth.md](truth.md).

## What counts as a breakup

A positive event is a breakup that was reported, so we are sure it happened: by NASA, by ESA, by U.S. Space Forces-Space, by a named analyst, by GCAT's satellite catalogue dating the separation of pieces from their parent, or by the public catalogue itself listing a burst of new debris under the parent's launch (at least five objects within thirty days, more than ninety days after the launch, and at least a fifth of the debris the launch already had). `data/breakups.json` holds every one found, 1961 to today, each with the statements of every source that reported it and the values resolved from them. The scorecard runs over the events from 2005, where the yearly element bundles begin, and scores NASA's two kinds apart: the detection target is for breakups, the destructive kind; anomalous events, where a body sheds a piece or two at low speed and stays intact, barely move the parent and are reported on a second line. Events whose parent has no public element sets at all are listed apart and left out of the denominator, and the headline is over events reported to the day or better.

## The counts

<!-- truth:counts:begin -->

| Events from 2005 | Count |
| --- | --- |
| All | 634 |
| Scoreable (breakups and anomalous events of a catalogued object) | 365 |
| Breakups | 260 |
| Anomalous events (low-velocity shedding) | 146 |
| Aerodynamic breakups at reentry (kept out) | 31 |
| Objects released on purpose (kept out) | 183 |
| Reports naming no object (kept out) | 14 |
| Confidence A (an authority states the minute) | 74 |
| Confidence B (an authority states the day, or a window of three days at most) | 34 |
| Confidence C (GCAT alone, an authority's month, or an analyst's dating) | 224 |
| Confidence D (pieces in the catalogue, or news with no time) | 33 |

<!-- truth:counts:end -->

## The sources

- **NASA, History of On-Orbit Satellite Fragmentations, 16th edition** (NASA/TP-20220019160, December 2022): every breakup and anomalous event to 1 May 2022, each with its date, time, altitude, assessed cause and the parent's pre-event element set. Read from the text of the PDF.
- **NASA, Orbital Debris Quarterly News**: each breakup since the cut-off, in prose. Typed by hand with issue and page. Every issue since 26(3) is listed in `data/truth/odqn-coverage.json` as cited or as read with no breakup items, and a test fails on a hole in that list, so a quiet stretch is a checked one: none of the issues published since 29(1), February 2025, reports a breakup of 2025 (the next to report one is 30(3), September 2026, on an event of June 2026).
- **GCAT, Space Debris Clouds** (Jonathan McDowell, planet4589.org, CC-BY-4.0): <!-- truth:gcat-clouds:begin -->402<!-- truth:gcat-clouds:end --> debris clouds with the parent, the event date and the orbit. Read from its table. GCAT has not updated the table since 22 June 2025 (its own line and the page's Last-Modified header, checked on 2026-10-12 at the same address; GCAT's index of catalogues has no other table of clouds), so it states nothing after mid-2025; the satellite catalogue below, updated daily, is where GCAT's later separations reach the truth.
- **GCAT, the satellite catalogue** (Jonathan McDowell, planet4589.org, CC-BY-4.0): every catalogued fragment and component with its parent, its separation date and its type (fragmentation debris by cause, anomalous debris, aerodynamic breakup, or a component released on purpose). Read uniformly for every object and every year: the pieces of one parent separated within three days of each other are one separation, its kind the pieces' type (a release at launch is the launch's own staging and is left out); a separation no other source reports is an event of confidence C (D where GCAT dates it to a year only), one another source reports joins its event. Kept as a snapshot reduced to the rows and columns read, with the whole file's hash.
- **ESA, Space Environment Report**, Table 3.7 of each edition from 2017 to 2026: the fragmentations of 2016 to 2025, each a day, a mass, an orbit class and a cause, the object unnamed. Typed as printed into `data/truth/esa-ser.json`, each edition's address and hash beside its rows. A row is placed by a fixed rule: it joins the one event the other sources date within a day of it in an orbit and of an object type it allows; with none it is an unnamed event, kept out of scoring; with more than one it is placed nowhere, and [docs/truth.md](truth.md) lists it with the events it could be. A row whose object a cited report names is a statement of that object.
- **U.S. Space Forces-Space notices**, named analysts, LeoLabs' and s2a systems' observations and news reports for 2024 to 2026, and the public catalogue where fragments were published with no report.

Every statement also records when it can first have been public (a quarterly news issue by its month, from NASA's history's reference documents or the hand file; a notice by the day it was seen; ESA's report by its date; an analyst's or a company's post by its day), and every event its first statement, from which the scorecard reads the Confirmed line's lead over the agencies; [docs/truth.md](truth.md) counts them by source.

## When sources disagree

Where sources disagree, the time comes from the source that states it most finely, an authority first; the orbit from NASA's spread, then the quarterly news, then GCAT; the cause from NASA, then ESA, then GCAT; the piece count from the latest statement. GCAT's satellite catalogue decides a field only where no other source states the event. Every disagreement is kept on the row. A reviewer who disagrees with a row edits the hand file or the overrides, never the built file; `npm run truth` rebuilds it and the tests fail until the committed file matches. [docs/truth.md](truth.md), generated by `npm run truth`, lists what was built from what.
