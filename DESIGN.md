---
name: CmdClaw
description: Work-focused agent platform UI for running agents across connected company tools.
colors:
  background: "oklch(1 0 0)"
  foreground: "oklch(0.145 0 0)"
  card: "oklch(1 0 0)"
  card-foreground: "oklch(0.145 0 0)"
  popover: "oklch(1 0 0)"
  popover-foreground: "oklch(0.145 0 0)"
  primary: "oklch(0.205 0 0)"
  primary-foreground: "oklch(0.985 0 0)"
  secondary: "oklch(0.97 0 0)"
  secondary-foreground: "oklch(0.205 0 0)"
  muted: "oklch(0.97 0 0)"
  muted-foreground: "oklch(0.556 0 0)"
  accent: "oklch(0.97 0 0)"
  accent-foreground: "oklch(0.205 0 0)"
  destructive: "oklch(0.577 0.245 27.325)"
  border: "oklch(0.922 0 0)"
  input: "oklch(0.922 0 0)"
  ring: "oklch(0.50 0.14 25)"
  brand: "oklch(0.50 0.14 25)"
  brand-foreground: "oklch(0.985 0 0)"
  brand-light: "oklch(0.94 0.03 25)"
  brand-dark: "oklch(0.40 0.12 25)"
  brand-muted: "oklch(0.88 0.05 25)"
  sidebar: "oklch(0.985 0 0)"
  sidebar-foreground: "oklch(0.145 0 0)"
  sidebar-primary: "oklch(0.50 0.14 25)"
  sidebar-primary-foreground: "oklch(0.985 0 0)"
  sidebar-accent: "oklch(0.97 0 0)"
  sidebar-accent-foreground: "oklch(0.205 0 0)"
  sidebar-border: "oklch(0.922 0 0)"
typography:
  display:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.35
  title:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.333
  mono:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "calc(0.625rem - 4px)"
  md: "calc(0.625rem - 2px)"
  lg: "0.625rem"
  xl: "calc(0.625rem + 4px)"
  pill: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.25rem"
  "2xl": "1.5rem"
  "3xl": "2rem"
components:
  button-default:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    height: "2.25rem"
    padding: "0.5rem 1rem"
    typography: "{typography.body}"
  button-brand:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.brand-foreground}"
    rounded: "{rounded.md}"
    height: "2.25rem"
    padding: "0.5rem 1rem"
    typography: "{typography.body}"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "2.25rem"
    padding: "0.5rem 1rem"
    typography: "{typography.body}"
  input-default:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "2.25rem"
    padding: "0.25rem 0.75rem"
    typography: "{typography.body}"
  card-default:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.xl}"
    padding: "1.25rem"
---

# Design System: CmdClaw

## 1. Overview

**Creative North Star: "The Operations Console"**

CmdClaw is a product UI for people asking agents to act across real company systems. The interface should feel like a precise operations console: quiet, durable, and legible under repeated use. It is not a showpiece; it is a working surface for chat, coworker runs, approvals, connected identities, and runtime status.

The current system is restrained by default: near-neutral surfaces, compact controls, thin borders, sparse shadows, and one warm rust brand accent for trust and action. The physical scene is a focused operator moving between conversations, inbox state, and integration settings on a laptop during the workday. Light mode is the primary posture because the app is used alongside documents, email, and admin tools; dark mode exists as an alternate state, not the brand.

The product language in `CONTEXT.md` is exacting, and the UI should match that precision. Avoid vague SaaS gloss, theatrical AI gradients, oversized marketing composition inside the authenticated app, and any visual treatment that makes agent execution look decorative instead of accountable.

**Key Characteristics:**

- Dense but calm: more console than brochure.
- Tokenized neutral layers with one warm operational accent.
- Rounded controls, thin borders, and state-first motion.
- Geist typography, small sizes, high readability, no ornamental type.
- Components expose status, ownership, and action without spectacle.

## 2. Colors

The palette is a restrained neutral system with a warm rust command accent. Values are canonical OKLCH tokens from `apps/web/src/app/globals.css`.

### Primary

- **Ink Command** (`primary`): The default action surface for core buttons and user chat bubbles. It is almost black but remains tokenized, never hard black.
- **Rust Signal** (`brand`): The CmdClaw accent for branded actions, focus rings, selected sidebar state, and identity moments. Use it deliberately; the system gets weaker when every surface competes for attention.
- **Deep Rust** (`brand-dark`): Hover and pressed treatment for brand actions in light mode.

### Secondary

- **Quiet Control** (`secondary`): A low-contrast control fill for secondary buttons and supporting UI.
- **Soft Accent** (`accent`): Hover and active state background for ghost controls, menus, and navigational affordances.

### Tertiary

- **Status Palette** (`chart-1` through `chart-5`, plus contextual green, amber, and red utilities): Used for charts, health, and status only. Do not let data colors become brand colors.
- **Destructive Red** (`destructive`): Error and destructive action color. Pair it with tinted backgrounds and explicit labels.

### Neutral

- **Paper Surface** (`background`, `card`, `popover`): Main canvas and raised surfaces.
- **Console Ink** (`foreground`, `card-foreground`, `popover-foreground`): Primary text and icons.
- **Subtle Field** (`muted`, `input`, `border`): Low-emphasis fills, input borders, dividers, table edges, and disabled surfaces.
- **Secondary Ink** (`muted-foreground`): Metadata, timestamps, helper text, and inactive navigation.
- **Sidebar Paper** (`sidebar`): App navigation background, intentionally close to the main canvas.

### Named Rules

**The Warm Signal Rule.** Rust appears for brand selection, focus, and intentional action. It must not be sprayed across every metric, badge, and icon.

**The Neutral Does The Work Rule.** Most hierarchy comes from border, spacing, typography, and muted surfaces. Add color only when it clarifies state or action.

## 3. Typography

**Display Font:** Geist (with Arial and sans-serif fallback)  
**Body Font:** Geist (with Arial and sans-serif fallback)  
**Label/Mono Font:** Geist Mono (with ui-monospace fallback)

**Character:** Geist keeps the UI technical without becoming terminal cosplay. The pairing is compact, modern, and readable in dense app layouts.

### Hierarchy

- **Display** (600, `1.5rem`, `1.25`): Page-level headings such as dashboard titles, login headings, and major route titles.
- **Headline** (600, `1.25rem`, `1.35`): Panel titles, modal headings, and prominent section labels.
- **Title** (600, `1rem`, `1.5`): Card titles, form section headers, and compact product surfaces.
- **Body** (400, `0.875rem`, `1.5`): Default UI copy, chat metadata, menu labels, tables, and settings text. Keep long prose to 65-75 characters per line.
- **Label** (500, `0.75rem`, `1.333`): Badges, metadata, field labels, button-adjacent annotations, and small navigation details.
- **Mono** (400, `0.875rem`, `1.5`): Code, JSON, runtime identifiers, file paths, and technical values.

### Named Rules

**The Small Surface Rule.** Authenticated app screens should use compact type by default. Reserve hero-scale typography for the public marketing shell only.

**The Exact Term Rule.** UI copy must preserve the repo language: Connected Account, Connected Identity, Integration Type, Generation, Runtime Progress, and related terms should not be casually renamed.

## 4. Elevation

CmdClaw uses tonal layering first and shadow second. Most surfaces are flat at rest, separated by thin borders and subtle muted fills. Shadows appear on overlays, prompt inputs, login panels, and popovers where they support depth and focus.

### Shadow Vocabulary

- **Soft Card Shadow** (`shadow-sm`): Login panels, attachment chips, and compact raised surfaces. Use only when a border alone cannot separate the surface.
- **Prompt Dock Shadow** (`0 15px 45px -22px rgba(15, 23, 42, 0.9)`): Hero prompt bar depth. It should stay attached to the prompt experience, not become a general card shadow.
- **Popover Lift** (`shadow-lg`): Tooltips, popovers, dropdowns, and chart tooltips.
- **Focus Ring** (`focus-visible:ring-ring/50`, `3px`): Keyboard and validation state. This is functional elevation and must remain visible.

### Named Rules

**The Flat Until Needed Rule.** A surface is flat unless it floats, accepts text, or temporarily interrupts the page.

**The Border Before Shadow Rule.** Try a token border before adding shadow. If the screen looks like stacked cards, remove elevation.

## 5. Components

### Buttons

- **Shape:** Gently rounded controls (`rounded-md`, derived from `--radius` at `calc(0.625rem - 2px)`).
- **Primary:** Ink Command background with Primary Foreground text, `2.25rem` default height, `0.5rem 1rem` padding, `0.875rem` medium text.
- **Brand:** Rust Signal background with Brand Foreground text. Use for product-signature actions, not every submit button.
- **Hover / Focus:** Hover darkens via opacity or `brand-dark`; focus uses a `3px` half-opacity ring and can shift border color.
- **Secondary / Ghost / Link:** Secondary fills use muted neutrals. Ghost buttons are transparent until hover. Link buttons underline only on hover.
- **Icon Buttons:** Fixed square sizes (`2rem`, `2.25rem`, `2.5rem`) with Lucide icons at `1rem` unless the local component explicitly sizes them.

### Chips

- **Style:** Rounded pills with thin borders, muted fill, `10px` or `11px` text, and tiny status dots when color carries meaning.
- **State:** Selected or active chips increase border contrast and text contrast, not size. Removable chips place the close icon at the trailing edge.

### Cards / Containers

- **Corner Style:** Product cards use `rounded-xl`; simple panels use `rounded-lg`.
- **Background:** Cards sit on `card` or muted translucent fills. Do not nest card surfaces inside other cards.
- **Shadow Strategy:** Flat at rest. Use border and hover background before shadow.
- **Border:** `border-border` is the default; hover may shift to `foreground/30` for selectable cards.
- **Internal Padding:** Compact content uses `1rem`; rich product cards use `1.25rem`; auth panels use `1.5rem` to `2rem`.

### Inputs / Fields

- **Style:** `2.25rem` height, rounded medium corners, transparent or background fill, `border-input`, horizontal padding at `0.75rem`.
- **Focus:** Border shifts to `ring`, with a `3px` translucent ring.
- **Error / Disabled:** Invalid fields use destructive border and ring. Disabled fields reduce opacity and block pointer events.
- **Text Areas:** Chat and prompt surfaces use larger rounded containers, fixed icon controls, and stable height measurement to avoid layout jump.

### Navigation

- **Style:** Sidebar navigation is quiet, icon-led, and compact. Active or primary state uses the brand token; inactive state uses muted foreground.
- **Typography:** Small labels and icon buttons, with metadata and timestamps in `muted-foreground`.
- **Default / Hover / Active:** Hover uses muted or accent fill. Active state should be clear without needing a colored side stripe.
- **Mobile:** Bottom navigation and sheets replace the sidebar, preserving icon-first density.

### Prompt Bar

The prompt bar is the signature control. It is a rounded, bordered, lightly elevated input dock with stable measuring layers, attachment chips, icon-only utilities, and a square send action. The default authenticated version uses `stone-50/80`, while the hero version uses translucent paper with a deeper shadow.

### Message Bubbles

User messages use compact Ink Command bubbles aligned right, capped at `80%` width. Assistant messages render as prose without a bubble container, preserving markdown tables, code, links, and file buttons as working content.

### Coworker Cards

Coworker cards are selectable operational summaries: `rounded-xl`, bordered, `min-height: 180px`, `1.25rem` padding, muted hover, and controls that reveal on hover. Status is carried by compact pills, dots, and recent-run metadata.

## 6. Do's and Don'ts

### Do:

- **Do** use the existing OKLCH tokens from `apps/web/src/app/globals.css`; do not introduce one-off hex colors for app UI.
- **Do** keep authenticated app layouts dense, scannable, and operational.
- **Do** use Rust Signal for brand action, selected state, focus, and identity moments.
- **Do** separate surfaces with `border-border`, muted fills, and spacing before adding shadows.
- **Do** use Lucide icons inside icon buttons and include accessible names where the button has no text.
- **Do** preserve exact domain terms from `CONTEXT.md`, especially Connected Account, Connected Identity, Integration Type, Generation, and Runtime Progress.
- **Do** keep motion short and state-based: `150ms` to `200ms`, opacity and transform only.

### Don't:

- **Don't** use `#000` or `#fff`; use foreground, background, primary, and primary-foreground tokens.
- **Don't** use gradient text, glassmorphism, decorative blur cards, or purple-blue AI surfaces.
- **Don't** use colored side-stripe borders on cards, list items, callouts, or alerts.
- **Don't** turn every screen into a grid of identical icon cards.
- **Don't** place cards inside cards. If a panel needs sections, use borders, separators, or unframed grouping.
- **Don't** rename product terms to generic labels like account, provider account, run, source, client, or logs when the domain term is known.
- **Don't** use modal dialogs as the first answer for ordinary editing or filtering flows.
