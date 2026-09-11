# Hive UI contract

Canonical source for the frontend's typography decisions. Historical UI notes
are context; this document owns the current rules. Last reviewed: 2026-09-10.

## Product and ownership

Hive brings a team into one shared coding task. The dashboard leads into a
conversation, discussion threads, and a workspace for files, diffs, runs, and
recovery points. These workflows share the same typography on every route,
including the public UI previews.

`src/app/globals.css` owns font tokens and base styles; `src/app/layout.tsx`
loads the fonts. `src/components/ui` owns shared controls. Components in
`src/components/hive` compose the product and adapt Streamdown and Monaco.

## Typography

| Role | Font and size | Tailwind utility |
| --- | --- | --- |
| Message bodies, thread replies, editable text | Geist, 14px | `text-sm`, body copy uses `leading-6` |
| Names, compact controls, labels, timestamps, statuses, paths, IDs | Geist, 12px | `text-xs` |
| Headings | Geist, 16–24px | `text-base` through `text-2xl` |
| Code, diffs, commands, terminal output | Geist Mono, 12px | `font-mono text-xs` |

Use regular weight for reading, medium for names and controls, and semibold for
headings. Distinguish metadata with color and weight rather than an additional
font size. Avatars and number badges use 12px text with enough room for their
contents. Ordinary interface text has a 12px floor.

Two exceptions have specific purposes:

- Editable inputs use 16px below the `sm` breakpoint, then 14px on desktop, to
  avoid focus zoom in mobile Safari.
- The decorative TS/JS file icons retain 10px lettering inside a 16px icon.
  They are hidden from assistive technology; the adjacent filename is the label.

Use existing Tailwind size utilities instead of adding per-component pixel
sizes. Keep monospace on code and command content, including inline code;
filenames, paths, timestamps, durations, counters, and checkpoint IDs use Geist.

## Layout and verification

Keep text wrapping, truncation, keyboard focus, and readable controls intact on
desktop and narrow screens. Increasing text size must not clip avatars, badges,
menus, thread controls, or workspace navigation. Long source lines may scroll
inside their own code container, without overflowing the page.

Verify typography changes in the dashboard preview and task conversation at
desktop and mobile widths, including a thread and the coding-agent control. Run the existing UI
regressions, lint, typecheck, and production build; review arbitrary text-size
utilities in Hive components and demo routes for new exceptions.

## Decisions

2026-09-10: Consolidated the scattered 7–14px interface sizes into 12px metadata
and 14px body roles, retaining the two existing font families. This replaces
component-specific sizing and monospace use for ordinary interface labels.
