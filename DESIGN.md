---
name: Emanua Financeiro
description: Light mint/sage operate shell for Emanua Massoterapia cash control
colors:
  bg: "#ebf5e9"
  bg-elevated: "#f7faf4"
  bg-card: "#ffffff"
  border: "#bed3b2"
  text: "#172416"
  text-muted: "#516335"
  accent: "#559265"
  accent-strong: "#3d5f3b"
  green: "#3d5f3b"
  red: "#c45c52"
  brand: "#85ad61"
  sage: "#d4e3c4"
  pine: "#78a45a"
  focus-ring: "#559265"
  on-accent: "#ebf5e9"
typography:
  display:
    fontFamily: "Instrument Serif, Georgia, serif"
    fontSize: "1.875rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 500
    lineHeight: 1.4
  title:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
  body:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.02em"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.accent-strong}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-income:
    backgroundColor: "transparent"
    textColor: "{colors.green}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-expense:
    backgroundColor: "transparent"
    textColor: "{colors.red}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  card-surface:
    backgroundColor: "{colors.bg-card}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "16px"
  input-field:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  nav-tab-active:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "0"
    padding: "8px 12px"
  kpi-card:
    backgroundColor: "{colors.bg-card}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "16px"
---

# Design System: Emanua Financeiro

## Overview

**Creative North Star: "Light Sage Operate Shell"**

Emanua Financeiro is a light operate dashboard for daily cash control at Emanua Massoterapia. Brand presence comes from mint/sage atmosphere and an Instrument Serif wordmark — not from generic blue fintech chrome. Surfaces sit on mint canvas with white cards; money meaning is carried by forest income, coral expense, and emerald accents for actions and projected cash.

Density is operate-first: sticky brand header + section tabs, then cash KPIs and creates before analysis and imports. Interaction containers use bordered white cards on a mint tonal stack; the shell uses soft sage/seafoam radial washes.

**Key Characteristics:**
- Mint → sage → emerald palette as brand and UI chrome
- Instrument Serif only for the Emanua wordmark / branded loading states
- DM Sans for all operational UI
- Cash path first (saldo → creates → lançamentos); imports demoted
- Light elevation + seafoam borders; soft shadow on login only
- Grass underline marks the active primary tab

## Colors

Palette from the brand green swatch sheet, light end (mint → seafoam → grass → emerald). Forest greens carry income and body emphasis; soft coral is reserved for expenses.

### Primary
- **Moss Accent** (`accent`): Primary actions (filled buttons, projected-saldo emphasis).
- **Forest Strong** (`accent-strong`): Hover on primary fills; chart saldo-real stroke.
- **Forest Income** (`green`): Entradas, receita values, income outline buttons.
- **Grass Brand** (`brand`): Active primary-tab underline — the brand flash on chrome.
- **On Accent** (`on-accent`): Mint text on filled emerald buttons.

### Secondary
- **Sage Soft** (`sage`): Radial washes and soft brand-adjacent highlights.
- **Meadow Pine** (`pine`): Supporting green accent in the token set.

### Tertiary
- **Coral Expense** (`red`): Saídas, overdue/negative cash, destructive links, expense outline buttons.

### Neutral
- **Mint Base** (`bg`): Page canvas (`theme-color` matches).
- **Cream Elevated** (`bg-elevated`): Sticky header, login card, modal shells.
- **White Card** (`bg-card`): KPI tiles, section panels, table hosts.
- **Seafoam Border** (`border`): Hairlines, input strokes, scrollbar thumb, chart grid.
- **Jungle Text** (`text`): Primary copy and values.
- **Moss Muted** (`text-muted`): Labels, notes, inactive tabs, chart ticks.

### Named Rules
**The Green Is The Brand Rule.** Chrome, atmosphere, and success share the mint→emerald family. Do not introduce cool blues or purple fintech accents as system color.

**The Money Meaning Rule.** Income uses `green` (forest); expense/destructive uses `red`; projected cash uses `accent`. Do not reuse `brand` grass for money values.

**The One Brand Flash Rule.** `brand` appears as the active primary-tab underline (and similarly rare brand accents) — not as fill for large surfaces.

## Typography

**Display Font:** Instrument Serif (with Georgia)
**Body Font:** DM Sans (with system-ui)

**Character:** Serif wordmark is quiet and spa-adjacent; sans UI is compact and tabular-friendly for money.

### Hierarchy
- **Display** (400, ~1.875rem / `text-2xl`→`text-3xl`, line-height 1): Emanua brand on header, login, and loading only.
- **Headline** (500, ~1.125rem): Modal titles (`text-lg`) and rare section lead-ins in DM Sans.
- **Title** (500, 0.875rem): Operational `h2` / section headers inside cards (`text-sm font-medium`).
- **Body** (400, 0.875rem): Lists, table cells, form controls (`font: inherit` on inputs/buttons).
- **Label** (400, 0.75rem): KPI labels, field labels, muted subtitles.

### Named Rules
**The Brand-Only Serif Rule.** Instrument Serif is reserved for `.brand` / `h1` wordmark contexts. Operational headings stay DM Sans.

**The Tabular Money Rule.** Currency and signed amounts use `tabular-nums` so columns and day totals align.

## Layout

Operate shell: full-bleed mint canvas with soft dual radial sage/seafoam washes (top-center + bottom-right, ~40% opacity). Content locks to `max-w-7xl` with horizontal `16px` padding.

Sticky header stacks brand row then horizontal scroll tabs. Main padding is `16px` vertical. Fluxo uses a deliberate vertical rhythm: `gap-8` between major bands (today → analysis → imports), `gap-3` inside the cash band. KPI grid is 1→2 columns at `sm`. Imports sit last as a demoted utility row.

### Named Rules
**The Cash Path First Rule.** First viewport after brand+tabs is saldo KPIs and daily creates; charts and CSV/import tools come after lançamentos.

## Elevation & Depth

Depth is mostly tonal: `bg` → `bg-elevated` → `bg-card`, separated by `border`. Header and login use translucent elevated fills plus `backdrop-blur`. Soft drop shadow appears only on the login card. Focus uses a 2px `focus-ring` outline with 2px offset globally. Toasts use Sonner `theme="light"`.

### Shadow Vocabulary
- **Login lift** (`box-shadow: 0 12px 40px rgba(23,36,22,0.12)`): Centered auth card only.
- **Otherwise flat:** Cards and tables rely on border + background step, not shadow.

### Named Rules
**The Tonal Stack Rule.** Prefer a mint→white surface step over a new shadow. Shadows are exceptional (auth), not default card chrome.

## Shapes

Gentle operate corners: `8px` (`rounded-lg`) for buttons, inputs, and icon controls; `12px` (`rounded-xl`) for KPI/section cards and most modals; `16px` (`rounded-2xl`) for the login form. Micro chips use `4px`. Primary navigation is underline-based (no pill tabs). Borders are 1px `border` on interactive containers.

## Components

### Buttons
- **Shape:** Soft 8px corners.
- **Primary:** `accent` fill, mint text, ~10×16 padding; hover → `accent-strong`; disabled at 50% opacity.
- **Income / Expense outlines:** Transparent fill with `green`/`red` text and 40% alpha matching border; hover washes `bg-card`.
- **Ghost / utility:** Transparent with `border` stroke; used for imports and secondary creates.
- **Icon chrome:** Square-ish `p-2` bordered controls in the header (eye / logout).

### Chips
- **Style:** Tiny uppercase status markers (`text-[10px]`), tracking-wide, `4px` radius, `accent` text with `accent`/40 border (e.g. “hoje”). Size is chip-local — not a type-ramp step.
- **State:** Informational markers, not filter toggles.

### Cards / Containers
- **Corner Style:** 12px for operate panels; 16px for login.
- **Background:** `bg-card` for KPIs/sections; `bg-elevated` for header/modals/login.
- **Shadow Strategy:** Flat except login lift.
- **Border:** Always `border` hairline when the surface is interactive or tabular.
- **Internal Padding:** 16px default; compact KPIs use 12–16px vertical.

### Inputs / Fields
- **Style:** `bg` fill, `border` stroke, 8px radius, 8×12 padding; labels are muted `xs` above.
- **Focus:** Border shifts toward `accent-strong`; global `:focus-visible` uses `focus-ring`.
- **Error / Disabled:** Errors surface as `red` text; disabled controls at 50% opacity.

### Navigation
- Primary tabs: DM Sans `sm`, icon+label, muted by default; active = jungle text + 2px `brand` bottom border.
- In-panel sub-tabs (e.g. contas): same underline pattern but active border uses `accent` (operational, not brand flash).

### KPI Tile (signature)
Lead cash tiles: muted label, large tabular value (`text-3xl`), optional note. Compact tiles use `text-xl` and tighter padding. Value color follows Money Meaning (`text` / `accent` / `green` / `red`).

## Do's and Don'ts

### Do:
- **Do** keep Instrument Serif on the Emanua wordmark only.
- **Do** lead Fluxo (and similar operate views) with saldo KPIs → creates → lançamentos.
- **Do** express income/expense with `green` / `red` and projected cash with `accent`.
- **Do** mark the active primary tab with the grass `brand` underline.
- **Do** build surfaces from the mint→white tonal stack with seafoam borders.

### Don't:
- **Don't** put Instrument Serif on operational `h2`/section titles.
- **Don't** introduce GitHub/generic blue as accent, link, or chart color.
- **Don't** promote imports/CSV above the daily cash path.
- **Don't** fill large panels with `brand` grass or treat `red` as a decorative accent.
- **Don't** default cards to multi-layer drop shadows; login lift is the exception.
- **Don't** reintroduce the discarded dark peat shell as system chrome.
