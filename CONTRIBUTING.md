# Contributing

Issues and pull requests are welcome, and every pull request is reviewed. Keep a change small and focused, and check it the way CI will before you open it: `npm install`, then `npm run typecheck` and `npm test`, which need no network and no account.

A change to the ground truth is a change to its inputs, never to `data/breakups.json` by hand: edit `data/truth/hand.json` (a statement from a source, with its citation) or `data/truth/overrides.json` (a reviewer's decision, by name), run `npm run truth`, and commit the regenerated `data/breakups.json` and `docs/truth.md` with the input that changed. A new edition of a machine-read source arrives through `npm run truth:fetch`, which needs poppler's `pdftotext`, and the same rebuild. The tests rebuild the truth from the committed snapshots and fail when the committed file differs.

A change to what the detector decides needs the scorecard's word for it: run it over the Archive and commit the regenerated KPI file with the change, so the README's table stays the record of what the library does.
