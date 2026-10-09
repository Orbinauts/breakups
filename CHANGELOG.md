# Changelog

Every notable change to `@orbinauts/breakups`, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package follows [semantic versioning](https://semver.org/spec/v2.0.0.html): until 1.0.0, a minor version may change the public interface, and the entry says how.

## [Unreleased]

### Added

- The ground truth: every on-orbit breakup and anomalous event an authority reported, 1961 to today, as `data/breakups.json`, built by `npm run truth` from NASA's History of On-Orbit Satellite Fragmentations (16th edition, read from its text), GCAT's Space Debris Clouds table, and hand-entered statements from NASA's Orbital Debris Quarterly News, a U.S. Space Forces-Space notice, ESA's Space Environment Report, named analysts, news reports and the public catalogue; each row keeps every source's statement verbatim beside the values resolved from them and lists where the sources disagree. The report `docs/truth.md` says what was built from what.
- `readBreakups`, `readStatements` and the types of the truth, exported for whoever reads the file.
- The Archive's tooling under `scripts/archive/`: the layout and columns of a year, the strip of a yearly bundle into them, the pull of the current year from the catalogue's history class (throttled, cached, ledgered), the satellite-catalogue and space-weather snapshots, and the upload and download of the years as release assets with a manifest of hashes.
