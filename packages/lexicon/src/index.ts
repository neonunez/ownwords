export { createLexiconRoutes } from "./routes.js";
export { createCourseLexiconImporter } from "./service.js";
export { exportLexiconOwnerData, type LexiconOwnerExport } from "./export.js";
export {
  DisabledTranslationProvider,
  ProviderDisabledError,
  TranslationSuggestionService,
} from "./translation.js";
export {
  answersMatch,
  normalizeAnswer,
  normalizeSearchText,
} from "./normalize.js";
export { newStoredCard, scheduleReview } from "./scheduler.js";
export type {
  Clock,
  CourseEntriesStoredQuery,
  CourseLexiconImport,
  CourseLexiconImportResult,
  CreateCourseImporterOptions,
  CreateLexiconRoutesOptions,
  EntryKind,
  EquivalentInput,
  FitLabel,
  IdGenerator,
  LexiconBindings,
  LexiconCourseImportService,
  LexiconEnv,
  LexiconRoutes,
  LexiconVariables,
  PracticeDirection,
  PracticeFormat,
  ReviewRating,
  SenseInput,
  TranslationProvider,
  TranslationProviderFactory,
  TranslationStatus,
  TranslationSuggestion,
  TranslationSuggestionRequest,
} from "./types.js";
