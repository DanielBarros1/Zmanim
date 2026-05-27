# Zmanim — Design Spec

> Last updated: 2026-05-27
> Status: Approved
> Reference mockup: `mockups/option-a-v2.html`

---

## 1. Design Direction

**Clean & Administrative** — a professional, table-first tool that prioritizes clarity and long editing sessions over visual flair. The schedule grid is the hero; everything else serves it. Inspired by tools like Linear and Notion.

Three options were evaluated (see `mockups/`). Option A was selected for its readability and low visual fatigue during extended use.

---

## 2. Color Palette

The app uses CSS custom properties (`var(--token)`) to support both light and dark mode. Dark mode is toggled by the user via a button in the topbar; it sets `data-theme="dark"` on `<html>`.

### Light Mode
| Token | Value | Usage |
|---|---|---|
| `--bg` | `#F8FAFC` | Page background |
| `--surface` | `#FFFFFF` | Sidebar, topbar, cards |
| `--surface-2` | `#F1F5F9` | Table header rows, sticky time column |
| `--border` | `#E2E8F0` | All borders |
| `--text-1` | `#1E293B` | Primary text |
| `--text-2` | `#475569` | Secondary text, nav items |
| `--text-3` | `#94A3B8` | Muted labels, timestamps |
| `--accent` | `#2563EB` | Active nav, active tab, primary button |
| `--accent-bg` | `#EFF6FF` | Active nav item background |
| `--warn-bg` | `#FFFBEB` | Warning card/banner background |
| `--warn-border` | `#FDE68A` | Warning borders |
| `--warn-text` | `#92400E` | Warning text |
| `--ok-bg` | `#F0FDF4` | Success stat background |
| `--ok-text` | `#15803D` | Success text |

### Dark Mode
| Token | Value |
|---|---|
| `--bg` | `#0F172A` |
| `--surface` | `#1E293B` |
| `--surface-2` | `#162032` |
| `--border` | `#334155` |
| `--text-1` | `#F1F5F9` |
| `--text-2` | `#94A3B8` |
| `--text-3` | `#475569` |
| `--accent` | `#3B82F6` |
| `--accent-bg` | `#172554` |
| `--warn-bg` | `#1C1408` |
| `--warn-border` | `#78350F` |
| `--warn-text` | `#FCD34D` |
| `--ok-bg` | `#052E16` |
| `--ok-text` | `#4ADE80` |

---

## 3. Subject Color Palette

Each subject has a fixed accent color used as the left border stripe on lesson cards. Colors must remain readable in both light and dark mode — they are never used as full backgrounds.

| Subject | Color | Hex |
|---|---|---|
| מתמטיקה (Math) | Indigo | `#4F46E5` |
| אנגלית (English) | Emerald | `#059669` |
| ספרות (Literature) | Pink | `#DB2777` |
| היסטוריה (History) | Amber | `#D97706` |
| פיזיקה (Physics) | Blue | `#1D4ED8` |
| כימיה (Chemistry) | Purple | `#7C3AED` |
| ביולוגיה (Biology) | Green | `#15803D` |
| אמנות (Art) | Red | `#DC2626` |
| ספורט (PE/Sport) | Lime | `#65A30D` |
| אזרחות (Civics) | Sky | `#0369A1` |
| גיאוגרפיה (Geography) | Teal | `#0F766E` |
| תנ"ך (Bible Studies) | Orange | `#C2410C` |
| מחשבים (Computers) | Cyan | `#0891B2` |

> New subjects added during Intake must be assigned a color from this palette (or an extension of it). No two subjects should share a color.

---

## 4. Typography

- **Font stack:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif` — no external font dependency.
- **Hebrew content** (subject names, teacher names, room names) uses `direction: rtl; text-align: right` at the element level. The grid itself is LTR.
- **Font size scale:**
  - Page title: `15px / 600`
  - Card subject name: `12.5px / 700`
  - Card teacher name: `11px / 400`
  - Table headers: `11px / 700 / uppercase / letter-spacing 0.05em`
  - Section labels (sidebar): `10px / 700 / uppercase / letter-spacing 0.08em`
  - Tags/badges: `9.5px / 600`

---

## 5. Layout

```
┌──────────────────┬──────────────────────────────────────────┐
│                  │ Topbar (56px)                             │
│                  ├──────────────────────────────────────────┤
│  Sidebar (220px) │ Stats bar                                 │
│                  ├──────────────────────────────────────────┤
│                  │ Day tabs                                  │
│                  ├──────────────────────────────────────────┤
│                  │ Violations banner (conditional)           │
│                  ├──────────────────────────────────────────┤
│                  │ Schedule grid (scrollable)                │
│                  ├──────────────────────────────────────────┤
│                  │ Subject legend (fixed footer)             │
└──────────────────┴──────────────────────────────────────────┘
```

- The sidebar is fixed-width and never collapses in Milestone 1.
- The schedule grid scrolls horizontally (12 class columns) and vertically if needed.
- The time column is sticky (`position: sticky; left: 0`).
- The header row is sticky (`position: sticky; top: 0`).

---

## 6. Component Patterns

### Lesson Card
- White background (or `--card-bg` in dark mode)
- `3px` left border in the subject's color
- Rounded corners: `5px`
- Subtle box shadow: `var(--card-shadow)`
- Content: subject name (Hebrew, RTL, bold) + teacher name (Hebrew, RTL, muted)
- Optional tags at the bottom (shared lesson, math level group, violation warning)
- Hover: slight shadow increase, cursor `grab`
- Warning state: amber left border + `--warn-bg` background

### Empty Cell
- Dashed border (`1.5px dashed`)
- `+` centered in muted color
- Hover: border and icon turn accent blue — signals drop target / click to add

### Violation Tags
- Pill-shaped, `9.5px / 600`
- Amber background on warning cards
- Text describes the specific violation type (e.g. "⚠ Teacher conflict", "⚠ Window — grade 9")

### Stats Bar
- Four stat cards in a horizontal row
- Each shows an icon, a label, and a value
- "Violations" stat uses warning colors; "Constraints OK" uses success colors
- "Lessons Placed" card includes a small inline progress bar

### Violations Banner
- Only shown when violations exist
- Amber background, full-width bar between day tabs and grid
- Right side: "View all violations →" link

### Badges (Draft / Published)
- Pill shape, colored background matching state
- Draft: amber · Published: green

---

## 7. Interaction Principles

- **Drag and drop** is the primary placement mechanic. Cards are draggable (`cursor: grab`). Empty cells are drop targets.
- **Dark mode toggle** lives in the topbar as an icon button (🌙 / ☀️). State is stored in `data-theme` on `<html>`.
- **Review Mode** is a distinct UI state — editing controls are hidden, violations panel is expanded.
- **Violations** are never hard-blocking. They surface as in-card tags and in the violations banner, but the admin can always proceed.
- **Grade group headers** (Grade 7 / Grade 8 / …) span above the A/B columns for visual grouping.

---

## 8. Responsive / Print

- Milestone 1 targets desktop only. No mobile breakpoints required.
- A **Compact View** exists as a separate route — read-only, strongly color-coded, optimized for printing or sharing. Its exact design is deferred to the implementation phase.

---

## 9. Future Design Considerations

- Compact/print view design
- Teacher-facing read-only view (Milestone 2) — likely a simplified single-column weekly grid
- Animation/transitions for drag-and-drop
- Keyboard navigation for power users
