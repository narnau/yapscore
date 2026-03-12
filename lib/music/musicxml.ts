// ─── Barrel export ──────────────────────────────────────────────────────────
// Re-exports everything from the split modules so existing imports
// (`from "@/lib/music/musicxml"`) continue to work unchanged.

export {
  // Core helpers
  findPart,
  findPartInfo,
  measureNum,
  findMeasure,
  getDivisions,
  getBeats,
  getBeatType,
  getFifths,
  stepAlteredByKey,
  notes,
  wholeRest,
  measureDuration,
  emptyMeasure,
  transposePitch,
  gcd,
  lcmInt,
  extractParts,
  reconstructMusicXml,
  extractSelectedMeasures,
  spliceMeasuresBack,
  spliceMeasuresBackPerPart,
  spliceMeasuresBackGlobal,
  renumberMeasures,
  buildTempoDirection,
  clefToSignLine,
  instrumentStaves,
  isPercussionPart,
  KEY_ROOT_TO_FIFTHS,
  fifthsToSemitones,
  nextMidiChannel,
  GRAND_STAFF_INSTRUMENTS,
  ensureTripletDivisions,
  ensureMinDivisions,
  mxlParse,
  mxlSerialize,
  generateId,
  mxlTranspose,
  mxlRemovePart,
  type SoundEntry,
  type HarmonyEntry,
  type ArticulationNotation,
} from "./musicxml-core";

export {
  // Score creation
  createScore,
  toMusicXml,
  parseMusicXml,
  buildContext,
  fifthsToKey,
  setScoreMetadata,
  getScoreMetadata,
  type ScoreInstrument,
  type ScoreMetadataInput,
} from "./musicxml-score";

export {
  // Measure manipulation
  deleteMeasures,
  clearMeasures,
  insertEmptyMeasures,
  insertPickupMeasure,
  duplicateMeasures,
  repeatSection,
  transposeMeasures,
  changeKey,
  scaleNoteDurations,
  setTimeSignature,
  setMeasureNotes,
  writeNotes,
  notesTotalBeats,
  pasteMeasures,
  buildNoteMap,
  changeNotePitch,
  deleteNote,
  changeNoteDuration,
  setSwing,
  getSwing,
  swingRatioToPercent,
  percentToSwingRatio,
  type NoteSpec,
  type NotePosition,
  type SwingInfo,
} from "./musicxml-measures";

export {
  // Notation
  setTempo,
  getTempo,
  addDynamics,
  addArticulations,
  removeArticulations,
  addRepeatBarlines,
  addVoltaBrackets,
  addHairpin,
  addTextAnnotation,
  addSlur,
  removeSlurs,
  addLyrics,
  addFermata,
  addOttava,
  addPedalMarking,
  addNavigationMark,
  addArpeggio,
  addTremolo,
  addGlissando,
  addBreathMark,
  type DynamicMarking,
  type ArticulationMarking,
  type NavigationMarkType,
} from "./musicxml-notation";

export {
  // Harmony
  addChordSymbols,
  extractChordMap,
  type ChordSymbol,
} from "./musicxml-harmony";

export {
  // Instruments
  DRUM_CATALOG,
  fixPercussionDisplayOctave,
  addPart,
  removePart,
  renamePart,
  changeInstrument,
  changeClef,
  movePart,
  reorderParts,
  type DrumSound,
} from "./musicxml-instruments";
