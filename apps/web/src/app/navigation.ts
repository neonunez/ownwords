import type { TabItem } from "../design-system";

/** The two modes share one collection; only the side panel crosses between them. */
export type Mode = "maintain" | "learn";

/** Four seats each. The fifth is reserved for Speak, after launch. */
export const maintainTabs: readonly TabItem[] = [
  {
    key: "progress",
    label: "Progress",
    icon: "chart-no-axes-column",
    href: "/maintain/progress",
  },
  {
    key: "lexicon",
    label: "Lexicon",
    icon: "book-open",
    href: "/maintain/lexicon",
  },
  {
    key: "practice",
    label: "Practice",
    icon: "repeat",
    href: "/maintain/practice",
  },
  {
    key: "flashcards",
    label: "Flashcards",
    icon: "layers",
    href: "/maintain/flashcards",
  },
];

export const learnTabs: readonly TabItem[] = [
  {
    key: "course",
    label: "Course",
    icon: "graduation-cap",
    href: "/learn/course",
  },
  {
    key: "practice",
    label: "Practice",
    icon: "repeat",
    href: "/learn/practice",
  },
  { key: "alphabet", label: "Alphabet", icon: "type", href: "/learn/alphabet" },
  {
    key: "reference",
    label: "Reference",
    icon: "library",
    href: "/learn/reference",
  },
];

export const homeFor: Record<Mode, string> = {
  maintain: "/maintain/progress",
  learn: "/learn/course",
};

export function modeFromPath(pathname: string): Mode {
  return pathname.startsWith("/learn") ? "learn" : "maintain";
}

export function tabsFor(mode: Mode): readonly TabItem[] {
  return mode === "learn" ? learnTabs : maintainTabs;
}

/** Screens that belong to no tab: reached from the side panel, not a tab. */
const outsideTabs = ["settings", "languages"];

/**
 * Which tab owns the current location. A screen pushed from a tab keeps that
 * tab lit, because no screen is ever a dead end. Settings keeps the tab bar
 * but lights none of it, since no tab leads there.
 */
export function activeTabKey(pathname: string): string {
  const mode = modeFromPath(pathname);
  if (outsideTabs.some((screen) => pathname.startsWith(`/${mode}/${screen}`)))
    return "";
  const tabs = tabsFor(mode);
  const match = tabs.find(
    (tab) => pathname === tab.href || pathname.startsWith(`${tab.href}/`),
  );
  if (match) return match.key;
  if (pathname.startsWith("/maintain/add")) return "lexicon";
  return tabs[0]?.key ?? "";
}
