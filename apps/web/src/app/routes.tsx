import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from './shell/AppShell';
import { ProgressScreen } from './screens/maintain/ProgressScreen';
import { LexiconScreen } from './screens/maintain/LexiconScreen';
import { EntryScreen } from './screens/maintain/EntryScreen';
import { AddEntryScreen } from './screens/maintain/AddEntryScreen';
import { PracticeScreen } from './screens/PracticeScreen';
import { CourseScreen } from './screens/learn/CourseScreen';
import { LessonScreen } from './screens/learn/LessonScreen';
import { AlphabetScreen } from './screens/learn/AlphabetScreen';
import { ReferenceScreen } from './screens/learn/ReferenceScreen';

/**
 * Every screen sits under the shell, so a pushed screen keeps the tab bar and
 * no screen is ever a dead end. Tabs never cross modes: the two branches share
 * nothing but the shell.
 */
export const routeTree = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/maintain/progress" replace /> },

      { path: 'maintain', element: <Navigate to="/maintain/progress" replace /> },
      { path: 'maintain/progress', element: <ProgressScreen /> },
      { path: 'maintain/lexicon', element: <LexiconScreen /> },
      { path: 'maintain/lexicon/:entryId', element: <EntryScreen /> },
      { path: 'maintain/add', element: <AddEntryScreen /> },
      {
        path: 'maintain/practice',
        element: (
          <PracticeScreen format="cloze" title="Practice" mode="maintain" modeLabel="Maintain" />
        ),
      },
      {
        path: 'maintain/flashcards',
        element: (
          <PracticeScreen
            format="flashcard"
            allowFormatChange={false}
            title="Flashcards"
            mode="maintain"
            modeLabel="Maintain"
          />
        ),
      },

      { path: 'learn', element: <Navigate to="/learn/course" replace /> },
      { path: 'learn/course', element: <CourseScreen /> },
      { path: 'learn/course/:lessonId', element: <LessonScreen /> },
      {
        path: 'learn/practice',
        element: (
          <PracticeScreen format="cloze" title="Practice" mode="learn" modeLabel="Learn · Русский" />
        ),
      },
      { path: 'learn/alphabet', element: <AlphabetScreen /> },
      { path: 'learn/reference', element: <ReferenceScreen /> },

      { path: '*', element: <Navigate to="/maintain/progress" replace /> },
    ],
  },
];

export const router = createBrowserRouter(routeTree);
