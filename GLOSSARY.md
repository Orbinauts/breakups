# Breakups

The detection of satellite breakups from the public catalogue's element sets, scored against a ground truth of reported breakups.

## Language

**Authority**:
A source whose statement alone puts a breakup on the headline line: NASA's history of fragmentations and its quarterly news, the U.S. Space Force's notices and ESA's annual report.
_Avoid_: agency (the Space Force and NASA are agencies, but so is ESA's report's office; the word says nothing about the headline), official source

**Fresh piece**:
A body catalogued under a breakup's launch after the event, numbered above the catalogue's mark at the event and classed as debris or not yet classed.

**Target**:
A reported breakup that counts in the Confirmed line's recall: the parent's orbit was known before it, and at least one fresh piece published within 180 days lies in the parent's plane by the scorecard's own bound, never the detector's.
_Avoid_: scoreable event (the truth's wider set), denominator event

**Unreported**:
A confirmation by the detector that the scorecard lands on no reported event, and neither counts apart nor exempts (as it does one inside a report naming no object). It is pending, neither true nor false, while it was raised under 90 days before the truth's date, and a false confirmation after that. The published list shows it as confirmed while it is pending, and with the state `unreported` from the instant the 90 days ran out; it is confirmed again if a report lands later.
_Avoid_: unconfirmed, orphan confirmation, false positive (for one still pending)
