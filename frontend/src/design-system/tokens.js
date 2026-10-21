/**
 * LauncherDesk Design System (LDS v1.0)
 * Centralized Design Tokens
 * Single source of truth for colors, typography, spacing, elevations, radii, and transitions.
 */

export const colors = {
  // Brand & Accent
  primary: '#3B82F6',
  primaryHover: '#2563EB',
  primaryActive: '#1D4ED8',
  primarySubtle: '#EFF6FF',
  primaryInk: '#FFFFFF',

  secondary: '#64748B',
  secondaryHover: '#475569',
  secondaryActive: '#334155',
  secondarySubtle: '#F8FAFC',
  secondaryInk: '#0F172A',

  accent: '#4F46E5',
  accentHover: '#4338CA',
  accentSubtle: '#EEF2FF',

  // Surfaces & Backgrounds
  background: '#F8FAFC',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  cardHover: '#FAFCFF',
  sidebar: '#0B132B',
  sidebarHighlight: '#1C2541',
  topbar: '#FFFFFF',

  // Borders & Dividers
  border: '#E2E8F0',
  borderSubtle: '#F1F5F9',
  borderFocus: '#3B82F6',
  divider: '#E2E8F0',

  // Inks & Typography
  textPrimary: '#0F172A',
  textSecondary: '#334155',
  textMuted: '#64748B',
  textSubtle: '#94A3B8',
  textInverted: '#FFFFFF',

  // Feedback & Semantic Statuses
  success: '#16A34A',
  successBg: '#DCFCE7',
  warning: '#D97706',
  warningBg: '#FEF3C7',
  error: '#DC2626',
  errorBg: '#FEE2E2',
  danger: '#DC2626',
  dangerBg: '#FEE2E2',
  info: '#2563EB',
  infoBg: '#EFF6FF',
  pending: '#CA8A04',
  pendingBg: '#FEF9C3',
  draft: '#64748B',
  draftBg: '#F1F5F9',
  cancelled: '#E11D48',
  cancelledBg: '#FFE4E6',
  neutral: '#64748B',
  neutralBg: '#F1F5F9',

  // Interactive States
  hover: '#F1F5F9',
  focus: '#3B82F6',
  selected: '#EFF6FF',
  disabled: '#94A3B8',
  disabledBg: '#F1F5F9',

  // Enterprise KPI Palette
  kpi: {
    revenue: '#D97706',        // Warm Amber
    revenueBg: '#FEF3C7',
    invoices: '#2563EB',       // Slate Blue
    invoicesBg: '#EFF6FF',
    customers: '#7C3AED',      // Muted Purple
    customersBg: '#F5F3FF',
    gst: '#0D9488',            // Deep Teal
    gstBg: '#CCFBF1',
    warning: '#EA580C',        // Soft Orange
    warningBg: '#FFEDD5',
    error: '#DC2626',          // Muted Red
    errorBg: '#FEE2E2',
    pending: '#CA8A04',        // Golden
    pendingBg: '#FEF9C3',
    success: '#16A34A',        // Forest Green
    successBg: '#DCFCE7',
    cancelled: '#E11D48',      // Soft Rose
    cancelledBg: '#FFE4E6',
  },
};

// 8-Point Spacing Scale
export const spacing = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
  24: '96px',
};

// Typography Hierarchy
export const typography = {
  fontFamily: {
    sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  fontSize: {
    display: '32px',
    h1: '28px',
    h2: '22px',
    h3: '18px',
    h4: '16px',
    title: '15px',
    subtitle: '14px',
    bodyLarge: '16px',
    body: '14.5px',
    bodySmall: '13px',
    caption: '12px',
    label: '11.5px',
  },
  fontWeight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeight: {
    display: 1.2,
    h1: 1.25,
    h2: 1.3,
    h3: 1.35,
    h4: 1.4,
    title: 1.4,
    subtitle: 1.45,
    body: 1.55,
    caption: 1.4,
  },
  letterSpacing: {
    display: '-0.025em',
    h1: '-0.02em',
    h2: '-0.015em',
    h3: '-0.01em',
    label: '0.05em',
  },
};

// Elevation Levels
export const elevation = {
  level0: 'none',
  level1: '0 10px 25px -5px rgba(15, 23, 42, 0.04), 0 8px 10px -6px rgba(15, 23, 42, 0.02)', // Cards
  level2: '0 12px 24px -4px rgba(15, 23, 42, 0.08), 0 4px 8px -2px rgba(15, 23, 42, 0.04)',  // Dropdowns
  level3: '0 16px 32px -6px rgba(15, 23, 42, 0.12), 0 6px 12px -3px rgba(15, 23, 42, 0.06)',  // Floating Panels
  level4: '0 20px 40px -8px rgba(15, 23, 42, 0.18), 0 10px 16px -4px rgba(15, 23, 42, 0.08)', // Dialogs / Modals
  level5: '0 25px 50px -12px rgba(15, 23, 42, 0.25), 0 12px 24px -6px rgba(15, 23, 42, 0.12)', // Command Palette
};

// Border Radii
export const radii = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  card: '20px', // Standard 20px card radius
  full: '9999px',
};

// Breakpoints
export const breakpoints = {
  mobile: '480px',
  tablet: '820px',
  laptop: '1024px',
  desktop: '1280px',
  wide: '1536px',
};

// Transitions
export const transitions = {
  fast: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
  smooth: '220ms cubic-bezier(0.4, 0, 0.2, 1)',
  bounce: '300ms cubic-bezier(0.34, 1.56, 0.64, 1)',
};

// Z-Indices
export const zIndex = {
  base: 0,
  dropdown: 40,
  sticky: 50,
  backdrop: 90,
  drawer: 100,
  modal: 150,
  popover: 200,
  toast: 300,
  commandPalette: 400,
};

export default {
  colors,
  spacing,
  typography,
  elevation,
  radii,
  breakpoints,
  transitions,
  zIndex,
};
