/**
 * Lucide icons, pinned to the version the design system specifies (0.460.0)
 * and imported as a package rather than fetched from a CDN, so the app draws
 * its icons offline and nothing is loaded from a third party at runtime.
 *
 * Only the icons listed here reach the bundle. Add a name to the registry to
 * use it; the union keeps a typo from reaching a screen.
 */

import {
  AlertCircle,
  ArrowRight,
  AudioLines,
  Ban,
  BellRing,
  BookOpen,
  ChartNoAxesColumn,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDashed,
  CornerDownLeft,
  Download,
  GraduationCap,
  Hash,
  Info,
  KeyRound,
  Languages,
  Layers,
  Library,
  Loader,
  Lock,
  LogOut,
  Maximize2,
  Menu,
  MessageCircle,
  Minimize2,
  Moon,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  Search,
  Sparkles,
  Sun,
  Type,
  User,
  Volume2,
  X,
} from "lucide-react";
import type { CSSProperties } from "react";

const registry = {
  "alert-circle": AlertCircle,
  "arrow-right": ArrowRight,
  "audio-lines": AudioLines,
  ban: Ban,
  bell: BellRing,
  "book-open": BookOpen,
  "chart-no-axes-column": ChartNoAxesColumn,
  check: Check,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  circle: Circle,
  "circle-check": CircleCheck,
  "circle-dashed": CircleDashed,
  "corner-down-left": CornerDownLeft,
  download: Download,
  "graduation-cap": GraduationCap,
  hash: Hash,
  info: Info,
  "key-round": KeyRound,
  languages: Languages,
  layers: Layers,
  library: Library,
  loader: Loader,
  lock: Lock,
  "log-out": LogOut,
  "maximize-2": Maximize2,
  menu: Menu,
  "message-circle": MessageCircle,
  "minimize-2": Minimize2,
  moon: Moon,
  "more-horizontal": MoreHorizontal,
  pencil: Pencil,
  play: Play,
  plus: Plus,
  repeat: Repeat,
  "rotate-ccw": RotateCcw,
  search: Search,
  sparkles: Sparkles,
  sun: Sun,
  type: Type,
  user: User,
  "volume-2": Volume2,
  x: X,
} as const;

export type IconName = keyof typeof registry;

export interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  color?: string;
  style?: CSSProperties;
}

/**
 * Icons never carry meaning on their own: every one is hidden from assistive
 * technology, and the control around it supplies the words.
 */
export function Icon({
  name,
  size = 22,
  strokeWidth = 1.75,
  color = "currentColor",
  style,
}: IconProps) {
  const Glyph = registry[name];
  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      color={color}
      aria-hidden="true"
      focusable="false"
      style={{ flex: "none", display: "block", ...style }}
    />
  );
}
