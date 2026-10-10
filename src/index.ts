// The breakup detector: a pure library with no HTTP or storage dependencies,
// written once in TypeScript on @orbinauts/engine so the one package runs
// on a server and in a browser alike, and scored against every reported
// on-orbit fragmentation rather than against hand-picked cases.
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
export { GEOSYNCHRONOUS_MAX_ECCENTRICITY, OPS_STATUSES, apsidesOf, dayOf, endedByOf, fromElements, isWorkingStatus, operationalAt, opsStatusOf, publishedNoEarlierThan, regimeOf, semiMajorAxisOf, type ElementSet, type OpsStatus, type SetContext } from "./elements.ts";
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
export { PARAMETER_PROVENANCE, parametersWith, type ParameterKind, type PerRegime, type Provenance } from "./params.ts";
export { type Candidate, type Held, type SeriesState } from "./series.ts";
export { type Fit } from "./model.ts";
export { ATTRIBUTION_PATHS, ORIGINS, OUTCOMES, PHASES, REFUSALS, SIGNALS, type SignalName } from "./log.ts";
export { MU_KM3_PER_S2, impulseOf, speedAt, type Impulse, type MeasuredStep, type Orbit } from "./impulse.ts";
export { MANOEUVRE_CLASSES, atypicalReasons, atypicalTests, classify, featuresOf, isDisposalLike, isRaised, pruneHistory, recordStep, type AtypicalTests, type CurrentStep, type HistoryFeatures, type ManoeuvreClass, type StepRecord } from "./manoeuvre.ts";
export { ANALYST_FLOOR, ANALYST_SECOND_FLOOR, CATALOGUE_KEY, cloudBodies, deltaVOfAxisChange, isFragmentClass, judgeCloud, launchCodeOf, launchKeyOf, markAt, nearestCloudDistance, noteBody, noteCloud, planeDistance, poissonTail, type BodyRecord, type CatalogueRecord, type CloudVerdict, type LaunchRecord, type ParentCandidate, type PieceReading, type PlaneDistance, type PlaneOrbit } from "./fragments.ts";
export { cartesianOf, elementsOf, eventFromPieces, eventTimeOf, type EventTime, type Minimum, type PiecesEventTime, type Vector } from "./event-time.ts";
export { estimateStep, fitSegment, type Environment, type SegmentFit, type StepEstimate } from "./step.ts";
export { EXPLANATION_BITS, SIGNATURE_BITS, damageOf, judgeStep, persistent, type AlertOrigin, type ConfirmationReading, type OpenAlert, type PieceCounts, type StepEvidence, type StepJudgement, type TierKey, type TierPoint } from "./fusion.ts";
export { ENVELOPE_MONTHS, heldLevel, isMaintenance, maintenanceToleranceKm, returnMissKm, monthOf, newEnvelope, noteLevel, snapshotEnvelope, type AltitudeEnvelope, type HeldLevel } from "./maintenance.ts";
export { LEDGER_DAYS, LEDGER_MAX, isDeploying, matesOf, newLedger, noteLedgerStep, siblingsOf, similarSteps, towardsMates, type LedgerStep, type Mates, type Siblings, type StepLedger } from "./siblings.ts";
export { OPEN_GATES, SCOPE_TIERS, WHOLE_CATALOGUE, foldedRatio, inScope, passesGates, type GatedStep, type ScopeGates, type ScopeParameters, type ScopePolicy, type ScopeSubject, type ScopeTier } from "./scope.ts";
