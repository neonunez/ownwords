/**
 * Demo data for the Ownwords front end.
 *
 * Nothing here comes from a server. It is the sample collection the design
 * package's UI kit used, written into the typed shapes of `api/types.ts` so
 * every screen is exercised against the contract the backend will answer.
 * Replace the demo client with the HTTP one and these fixtures fall away.
 */

import type {
  AlphabetLetter,
  Course,
  Entry,
  Language,
  Lesson,
  Preferences,
  ReferenceTopic,
  UpcomingItem,
} from '../types';

export const demoLanguages: Language[] = [
  { code: 'en', name: 'English', role: 'native', level: 'native' },
  { code: 'es', name: 'Español', role: 'maintained', level: 'intermediate' },
  { code: 'ru', name: 'Русский', role: 'learning', level: 'learning · A0' },
];

export const demoEntries: Entry[] = [
  {
    id: 'e1',
    headword: 'to make do with',
    note: 'when it isn’t ideal but works',
    kind: 'expression',
    language: 'en',
    version: 1,
    createdAt: '2026-08-02T09:12:00.000Z',
    senses: [
      {
        id: 'e1s1',
        gloss: 'manage with what is available',
        equivalents: [
          { id: 'e1s1es', language: 'es', text: 'arreglárselas con', fit: 'exact', state: 'confirmed' },
          { id: 'e1s1ru', language: 'ru', text: 'обходи́ться', fit: 'broader', state: 'suggested' },
        ],
      },
    ],
    mastery: { es: { recognise: 0.9, produce: 0.6 }, ru: { recognise: 0.2, produce: null } },
  },
  {
    id: 'e2',
    headword: 'ni de coña',
    note: 'flat refusal, among friends',
    kind: 'expression',
    language: 'es',
    version: 1,
    createdAt: '2026-08-04T18:40:00.000Z',
    senses: [
      {
        id: 'e2s1',
        gloss: 'no way',
        equivalents: [
          { id: 'e2s1en', language: 'en', text: 'no way', fit: 'exact', state: 'confirmed' },
          { id: 'e2s1ru', language: 'ru', text: 'ни за что́', fit: 'narrower', state: 'confirmed' },
        ],
      },
    ],
    mastery: { en: { recognise: 1, produce: 0.8 }, ru: { recognise: 0.4, produce: 0.1 } },
  },
  {
    id: 'e3',
    headword: 'actually',
    note: 'correcting gently',
    kind: 'word',
    language: 'en',
    version: 2,
    createdAt: '2026-08-06T07:05:00.000Z',
    senses: [
      {
        id: 'e3s1',
        gloss: 'in fact',
        equivalents: [
          { id: 'e3s1es', language: 'es', text: 'actualmente', fit: 'false-friend', state: 'confirmed' },
          { id: 'e3s1ru', language: 'ru', text: 'на са́мом де́ле', fit: 'exact', state: 'confirmed' },
        ],
      },
      {
        id: 'e3s2',
        gloss: 'to soften a correction',
        equivalents: [
          { id: 'e3s2es', language: 'es', text: 'en realidad', fit: 'exact', state: 'confirmed' },
          { id: 'e3s2ru', language: 'ru', text: '', fit: null, state: 'waiting' },
        ],
      },
    ],
    mastery: { es: { recognise: 0.7, produce: 0.5 }, ru: { recognise: 0.1, produce: null } },
  },
  {
    id: 'e4',
    headword: 'sobremesa',
    note: 'the talk after the meal',
    kind: 'word',
    language: 'es',
    version: 1,
    createdAt: '2026-08-11T20:15:00.000Z',
    senses: [
      {
        id: 'e4s1',
        gloss: 'lingering at the table',
        equivalents: [
          {
            id: 'e4s1en',
            language: 'en',
            text: 'after-dinner conversation',
            fit: 'context-only',
            state: 'manual',
          },
          { id: 'e4s1ru', language: 'ru', text: '', fit: null, state: 'failed' },
        ],
      },
    ],
    mastery: { en: { recognise: 1, produce: 0.9 }, ru: { recognise: null, produce: null } },
  },
  {
    id: 'e5',
    headword: 'to take for granted',
    note: '',
    kind: 'expression',
    language: 'en',
    version: 1,
    createdAt: '2026-08-19T11:30:00.000Z',
    senses: [
      {
        id: 'e5s1',
        gloss: 'assume without appreciating',
        equivalents: [
          { id: 'e5s1es', language: 'es', text: 'dar por sentado', fit: 'exact', state: 'confirmed' },
          {
            id: 'e5s1ru',
            language: 'ru',
            text: 'принима́ть как до́лжное',
            fit: 'exact',
            state: 'suggested',
          },
        ],
      },
    ],
    mastery: { es: { recognise: 0.5, produce: 0.2 }, ru: { recognise: null, produce: null } },
  },
  {
    id: 'e6',
    headword: 'молоко́',
    note: 'from Unit 2',
    kind: 'word',
    language: 'ru',
    version: 1,
    createdAt: '2026-09-01T08:00:00.000Z',
    senses: [
      {
        id: 'e6s1',
        gloss: 'milk',
        equivalents: [
          {
            id: 'e6s1en',
            language: 'en',
            text: 'milk',
            fit: 'exact',
            state: 'confirmed',
            courseItemId: 'ru-a1-milk',
          },
          {
            id: 'e6s1es',
            language: 'es',
            text: 'leche',
            fit: 'exact',
            state: 'confirmed',
            courseItemId: 'ru-a1-milk',
          },
        ],
      },
    ],
    mastery: { en: { recognise: 0.6, produce: 0.3 }, es: { recognise: 0.6, produce: 0.3 } },
  },
];

/** The cards the scheduler has picked, in the order it picked them. */
export const demoDue = [
  {
    cardId: 'c1',
    entryId: 'e1',
    language: 'es',
    promptLanguage: 'en',
    direction: 'produce' as const,
    prompt: 'We didn’t have flour, so we ___ oats.',
    answer: 'made do with',
    hint: 'to make do with · arreglárselas con',
  },
  {
    cardId: 'c2',
    entryId: 'e2',
    language: 'en',
    promptLanguage: 'es',
    direction: 'recognise' as const,
    prompt: 'ni de coña',
    answer: 'no way',
    hint: 'A flat refusal, among friends.',
  },
  {
    cardId: 'c3',
    entryId: 'e5',
    language: 'es',
    promptLanguage: 'en',
    direction: 'produce' as const,
    prompt: 'to take for granted',
    answer: 'dar por sentado',
    hint: null,
  },
  {
    cardId: 'c4',
    entryId: 'e3',
    language: 'ru',
    promptLanguage: 'en',
    direction: 'recognise' as const,
    prompt: 'на са́мом де́ле',
    answer: 'actually',
    hint: 'You reach for it when you correct somebody gently.',
  },
];

export const demoComingUp: UpcomingItem[] = [
  { when: 'this evening', headword: 'actually', language: 'ru', direction: 'recognise' },
  { when: 'tomorrow', headword: 'sobremesa', language: 'en', direction: 'produce' },
  { when: 'in three days', headword: 'ni de coña', language: 'ru', direction: 'produce' },
];

export const demoCourse: Course = {
  id: 'ru-a0-a1',
  version: '2026.09.1',
  language: 'ru',
  resume: {
    unitId: 'u3',
    unitNumber: 3,
    title: 'В кафе́',
    step: 'Hear it first',
    progress: 0.4,
    canDo: 'Order a coffee and say thank you',
  },
  units: [
    { id: 'u0', number: 0, title: 'Алфави́т', subtitle: 'The alphabet, and the letters that look Latin but aren’t', state: 'done' },
    { id: 'u1', number: 1, title: 'Здра́вствуйте', subtitle: 'Greet somebody and introduce yourself', state: 'done' },
    { id: 'u2', number: 2, title: 'Молоко́ и хлеб', subtitle: 'Name six everyday things', state: 'done' },
    { id: 'u3', number: 3, title: 'В кафе́', subtitle: 'Order a coffee and say thank you', state: 'current' },
    { id: 'u4', number: 4, title: 'Ско́лько сто́ит?', subtitle: 'Numbers 1–20, and asking a price', state: 'locked' },
    { id: 'u5', number: 5, title: 'Где метро́?', subtitle: 'Ask where something is', state: 'locked' },
  ],
  milestones: [
    { id: 'm1', text: 'Read every Cyrillic letter', reached: true },
    { id: 'm2', text: 'Greet somebody and introduce yourself', reached: true },
    { id: 'm3', text: 'Order a coffee', reached: false },
  ],
};

export const demoLesson: Lesson = {
  id: 'u3',
  unitNumber: 3,
  title: 'В кафе́',
  canDo: 'Order a coffee and say thank you',
  steps: [
    {
      id: 'u3s1',
      kind: 'hear',
      title: 'Hear it first',
      items: [
        { id: 'i1', text: 'ко́фе', meaning: 'coffee', grammar: 'm.', audioUrl: null },
        { id: 'i2', text: 'пожа́луйста', meaning: 'please', grammar: '', audioUrl: null },
        { id: 'i3', text: 'спаси́бо', meaning: 'thank you', grammar: '', audioUrl: null },
      ],
    },
    {
      id: 'u3s2',
      kind: 'rule',
      title: 'A rule of four lines',
      lines: [
        'Stress falls on one syllable, and the course marks it with the acute.',
        'An unstressed о sounds like a short a: молоко́ is said ma-la-KO.',
        'Stress is never written in real Russian text.',
        'You never have to type it. Search and answers ignore it.',
      ],
    },
    {
      id: 'u3s3',
      kind: 'use',
      title: 'Use it',
      prompt: 'Ко́фе, ___.',
      options: ['пожа́луйста', 'спаси́бо', 'молоко́'],
      answer: 'пожа́луйста',
      responses: {
        'пожа́луйста': 'Right. That is “coffee, please”.',
        'спаси́бо': 'That one is “thank you”, and it comes afterwards. Try the other.',
        'молоко́': 'That one is “milk”. A polite word belongs here.',
      },
    },
    {
      id: 'u3s4',
      kind: 'perception',
      title: 'Perception drill',
      prompt: 'Which one did you hear?',
      options: ['ко́фе', 'кафе́'],
      answer: 'ко́фе',
      responses: {
        'ко́фе': 'Yes. The stress is on the first syllable.',
        'кафе́': 'That one is “café”, stressed at the end.',
      },
    },
  ],
};

const trap = (upper: string, lower: string, sound: string, looksLike: string): AlphabetLetter => ({
  upper,
  lower,
  sound,
  trap: `looks like ${looksLike}`,
  sameAsLatin: false,
});
const same = (upper: string, lower: string, sound: string): AlphabetLetter => ({
  upper,
  lower,
  sound,
  trap: null,
  sameAsLatin: true,
});
const plain = (upper: string, lower: string, sound: string): AlphabetLetter => ({
  upper,
  lower,
  sound,
  trap: null,
  sameAsLatin: false,
});

/** All 33 letters, in Russian alphabetical order. */
export const demoAlphabet: AlphabetLetter[] = [
  same('А', 'а', 'a'),
  plain('Б', 'б', 'b'),
  trap('В', 'в', 'v', 'B'),
  plain('Г', 'г', 'g'),
  plain('Д', 'д', 'd'),
  trap('Е', 'е', 'ye', 'E'),
  plain('Ё', 'ё', 'yo'),
  plain('Ж', 'ж', 'zh'),
  trap('З', 'з', 'z', '3'),
  plain('И', 'и', 'i'),
  plain('Й', 'й', 'y'),
  same('К', 'к', 'k'),
  plain('Л', 'л', 'l'),
  same('М', 'м', 'm'),
  trap('Н', 'н', 'n', 'H'),
  same('О', 'о', 'o'),
  plain('П', 'п', 'p'),
  trap('Р', 'р', 'r', 'P'),
  trap('С', 'с', 's', 'C'),
  same('Т', 'т', 't'),
  trap('У', 'у', 'u', 'Y'),
  plain('Ф', 'ф', 'f'),
  trap('Х', 'х', 'kh', 'X'),
  plain('Ц', 'ц', 'ts'),
  plain('Ч', 'ч', 'ch'),
  plain('Ш', 'ш', 'sh'),
  plain('Щ', 'щ', 'shch'),
  plain('Ъ', 'ъ', 'hard sign'),
  plain('Ы', 'ы', 'y'),
  plain('Ь', 'ь', 'soft sign'),
  plain('Э', 'э', 'e'),
  plain('Ю', 'ю', 'yu'),
  plain('Я', 'я', 'ya'),
];

export const demoReferenceTopics: ReferenceTopic[] = [
  {
    id: 'grammar',
    title: 'Grammar and verbs',
    icon: 'book-open',
    summary: 'Gender, aspect pairs and cases, as they arrive',
    introducedIn: 'Unit 3',
    locked: false,
  },
  {
    id: 'phrases',
    title: 'Phrases',
    icon: 'message-circle',
    summary: 'Everything sayable so far, by situation',
    introducedIn: '',
    locked: false,
  },
  {
    id: 'intonation',
    title: 'Intonation',
    icon: 'audio-lines',
    summary: 'Questions asked without a question word',
    introducedIn: 'Unit 2',
    locked: false,
  },
  {
    id: 'numbers',
    title: 'Numbers',
    icon: 'hash',
    summary: '0 to 20, then the tens',
    introducedIn: 'Unit 4',
    locked: true,
  },
  {
    id: 'vocabulary',
    title: 'Course vocabulary',
    icon: 'library',
    summary: 'Every course item, and all of it in your Lexicon',
    introducedIn: '',
    locked: false,
  },
];

export const demoPreferences: Preferences = {
  explanationsIn: 'en',
  audioInCourse: true,
  suggestTranslations: true,
  reminders: 'after-install',
};

/** Canned equivalents the demo translation stand-in returns. */
export const demoSuggestions: Record<string, string> = {
  es: 'dejar pasar',
  ru: 'пропусти́ть',
  en: 'to let it go',
};
