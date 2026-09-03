/**
 * The Industry token set, ported from the design handoff
 * (`_ds/industry-.../styles.css`) into the app's own theme layer — the README
 * of that handoff asks for exactly this rather than a linked stylesheet.
 *
 * SCOPE OF THE RE-THEME (Carl, 3 Sep 2026): the kiosk takes this token set;
 * the console and the portal keep what they have. The kiosk shares no
 * components with either, so nothing else moves.
 *
 * TWO TOKENS ARE ACCESSIBILITY DECISIONS, not preferences:
 *
 *   `inkMuted` (55% ink) measures 3.64:1 on the ground and FAILS WCAG 2.2 AA.
 *   Secondary text uses `neutral700` (#5d5d60, 6.0:1). `inkMuted` is reserved
 *   for decorative text at 15px and above. Getting this backwards is the easy
 *   mistake, because the design system's own muted default is the failing one.
 *
 *   `minTarget` is 56, not 44. 44 is the WCAG floor; the kiosk spec floor is
 *   56 because the person using it is standing up, often elderly, sometimes
 *   holding a bag. Nothing tappable may be built below `minTarget`.
 */

export const colors = {
  ground: '#f2f2f3',
  surface: '#e9e9ea',
  ink: '#1d1f20',
  /** Decorative only, 15px+. Fails AA for body text — see the note above. */
  inkMuted: 'rgba(29, 31, 32, 0.55)',
  accent: '#5980a6',
  divider: 'rgba(29, 31, 32, 0.16)',
  white: '#ffffff',

  accent100: '#eef6ff',
  accent200: '#d6ebff',
  accent300: '#b5d9fd',
  accent400: '#94bce3',
  accent500: '#749dc4',
  accent600: '#597ea3',
  accent700: '#416180',
  accent800: '#2c455d',
  accent900: '#1d2d3d',

  neutral100: '#f5f5f8',
  neutral200: '#e7e7ea',
  neutral300: '#d4d4d7',
  neutral400: '#b7b7ba',
  neutral500: '#98989b',
  neutral600: '#7a7a7d',
  /** The AA-safe secondary ink. Use this for every small piece of text. */
  neutral700: '#5d5d60',
  neutral800: '#424244',
  neutral900: '#2b2b2d',
} as const;

/**
 * Barlow, with a stack behind it. The faces are bundled as assets
 * (`@expo-google-fonts/*`) and loaded at start-up — nothing is fetched at
 * runtime. If loading fails the screen still renders in the fallback: a
 * missing typeface must never stand between a patient and their appointment
 * (REQ-REC-04).
 */
export const fonts = {
  body: 'Barlow_400Regular',
  bodyMedium: 'Barlow_500Medium',
  bodyBold: 'Barlow_700Bold',
  heading: 'BarlowCondensed_600SemiBold',
} as const;

/** Kiosk type scale from the handoff. Patient-facing text is set large. */
export const type = {
  h1: 64,
  h1Small: 56,
  h2: 40,
  h3: 24,
  bodyLarge: 22,
  body: 19,
  bodySmall: 17,
  label: 15,
  footnote: 14,
  kicker: 12,
} as const;

/** 3.4 / 6.8 / 10.2 / 13.6 / 20.4 / 27.2 — the system's own scale, rounded nowhere. */
export const space = {
  xxs: 3.4,
  xs: 6.8,
  sm: 10.2,
  md: 13.6,
  lg: 20.4,
  xl: 27.2,
  xxl: 36,
} as const;

export const layout = {
  /** Square corners are a system rule, not a style preference. */
  radius: 0,
  borderWidth: 1,
  screenPadding: 36,
  /** WCAG floor is 44; the kiosk floor is 56. Nothing tappable goes below it. */
  minTarget: 56,
  /** Primary actions in the ceremony are taller again. */
  primaryTarget: 72,
} as const;

export const theme = { colors, fonts, type, space, layout } as const;
