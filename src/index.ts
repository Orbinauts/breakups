// The breakup detector: a pure library with no HTTP or storage dependencies,
// written once in TypeScript on @orbinauts/engine so the one package runs
// on a server and in a browser alike, and scored against every reported
// on-orbit fragmentation rather than against hand-picked cases.
//
// This is the package's public surface: the detector's entry point and the
// shapes it speaks in, the states as text, the element sets it reads, its
// parameters and where each came from, the ground truth's readers and the
// published files' types. The modules behind it are the detector's own and
// change as it is written.
export {
  AGENCY_SOURCES,
  BODY_CLASSES,
  BREAKUP_KINDS,
  CAUSES,
  CONFIDENCES,
  CONFLICT_FIELDS,
  PRECISIONS,
  REGIMES,
  SOURCE_IDS,
  STATED_PRECISIONS,
  TruthError,
  firstAgencyStatement,
  firstStatementOf,
  isAgencySource,
  launchOf,
  readBreakups,
  readStatedTime,
  readStatement,
  readStatements,
  yearOf,
  type BodyClass,
  type Breakup,
  type BreakupKind,
  type BreakupsFile,
  type Cause,
  type Confidence,
  type Conflict,
  type ConflictField,
  type FirstStatement,
  type Parent,
  type Precision,
  type Regime,
  type ResolvedFrom,
  type SourceId,
  type SourceRecord,
  type StatedOrbit,
  type StatedOn,
  type StatedParent,
  type StatedPrecision,
  type StatedTime,
  type Statement,
} from "./truth.ts";
export { OPS_STATUSES, fromElements, type ElementSet, type OpsStatus, type SetContext } from "./elements.ts";
export {
  ALERT_STATES,
  DETECTOR_NAME,
  DETECTOR_PARAMETERS,
  VERDICT_KINDS,
  VERDICT_STATES,
  runDetector,
  type DetectorInput,
  type DetectorOutput,
  type DetectorParameters,
  type EventEstimate,
  type LaunchState,
  type LogRow,
  type Notice,
  type ObjectState,
  type SpaceWeatherDay,
  type Step,
  type Verdict,
  type VerdictKind,
  type VerdictState,
} from "./detector.ts";
export { reviveStates, serialiseStates, type DetectorStates } from "./states.ts";
export { OFF, PARAMETER_PROVENANCE, isOn, parametersWith, type LegacyParameters, type ParameterKind, type ParameterOverrides, type ParameterProvenance, type PerRegime, type Provenance } from "./params.ts";
export { SCOPE_TIERS, type ScopeGates, type ScopeParameters, type ScopePolicy, type ScopeTier } from "./scope.ts";
export {
  PUBLISHED_STATES,
  PUBLISHED_VERSION,
  type PublishedBreakup,
  type PublishedBreakupEntry,
  type PublishedBreakupFile,
  type PublishedBreakupsFile,
  type PublishedEvent,
  type PublishedParent,
  type PublishedReport,
  type PublishedRowEvent,
  type PublishedState,
  type PublishedStatusFile,
  type PublishedStep,
  type PublishedVerdict,
} from "./published.ts";
