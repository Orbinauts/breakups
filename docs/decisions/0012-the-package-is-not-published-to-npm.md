---
status: accepted
date: 2026-10-13
---

# The package is not published to npm

[0001](0001-a-standalone-truth-driven-package.md) made this a standalone
package that "the product imports afterwards, as it imports the engine":
the site would install `@orbinauts/breakups` from npm and run the detector
itself. [0010](0010-the-breakups-fit-to-show-are-published-as-static-json.md)
moved the detector off the site. Its state for the whole catalogue is
137 MB gzipped and the daily replay takes minutes, so the site reads the
static JSON this repository publishes on GitHub Pages and never runs the
detector. The reason to be on npm went with it. Nothing had been published
when this was decided: the registry has no `@orbinauts/breakups`, and the
publish workflow was waiting for the first version bump on main.

## The decision

- **The package is private.** `package.json` carries `"private": true`, so
  `npm publish` refuses, and no `publishConfig`. No workflow publishes to
  npm or installs this package from the registry.
- **The repository is the library, the Pages JSON is the product.** The
  site, and anyone who only wants the breakups, read the published files
  (`docs/published.md`), whose types are in `src/published.ts`. A reader
  who wants to run the library installs it from the repository,
  `npm install github:Orbinauts/breakups`, or pins a release with
  `#v<version>`.
- **The build runs on `prepare`, not `prepack`.** npm runs `prepare` when
  it installs a package from git, so an install from the repository gets
  the built `dist/`; it also runs on `npm install` in a clone, a build of
  under two seconds. `files` and `exports` stay as they were: they are
  what an install from git receives.
- **Releases stay.** A version bump on main is still tagged `v<version>`
  and released on GitHub with its CHANGELOG entry, by
  `.github/workflows/release.yml` (formerly `publish.yml`), and its smoke
  job installs the tag from GitHub into an empty directory on Node 22 and
  24 and reads the ground truth, as it read the registry's copy before. The
  CHANGELOG, SECURITY's "latest release" and the semantic versions keep
  their anchor, and so does 0008's frozen tag, which never was an npm
  version.

## Considered options

- Keep publishing to npm: a registry copy no one reads, a trusted-publishing
  setup to keep working, and a second place where the truth is shipped.
- Publish only the types of the published files: the types import the
  detector's and the truth's, so they cannot be cut out without copying
  them, and the site can import them from a git install.
- Drop the releases with npm: the CHANGELOG would lose the versions it is
  written against, and a reader could pin nothing but a commit.
- Keep the releases and install from git (chosen).

## Consequences

- The README's install section says the package is not on npm and installs
  it from GitHub; `docs/published.md` says where the types come from.
- npm 11 warns that a git dependency's `prepare` is not yet in the
  project's `allowScripts`; the README names the command that approves it.
  If a later npm refuses such scripts by default, the smoke job fails and
  says so.
- Nothing the library, the scorecard, the daily job or the Pages JSON does
  changed.
