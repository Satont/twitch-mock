---
name: TwitchMock
description: Graphite interface for operating a local Twitch mock
colors:
  chrome: '#0f0f10'
  page: '#141415'
  surface: '#19191b'
  raised: '#232325'
  hover: '#2b2b2e'
  border: '#ffffff18'
  text: '#ededed'
  secondary: '#b2b2b6'
  muted: '#96969b'
  accent: '#9146ff'
  success: '#9bcbae'
  error: '#dfa7a7'
  button-ink: '#171717'
  button-hover: '#d4d4d5'
  control-border: '#454548'
  secondary-border: '#464649'
  control-focus: '#b1b1b5'
typography:
  headline:
    fontFamily: '"Noto Sans", sans-serif'
    fontSize: '24px'
    fontWeight: 500
    lineHeight: '32px'
  title:
    fontFamily: '"Noto Sans", sans-serif'
    fontSize: '16px'
    fontWeight: 500
    lineHeight: '24px'
  panel-title:
    fontFamily: '"Noto Sans", sans-serif'
    fontSize: '14px'
    fontWeight: 500
    lineHeight: '20px'
  body:
    fontFamily: '"Noto Sans", sans-serif'
    fontSize: '13px'
    fontWeight: 400
    lineHeight: '20px'
  label:
    fontFamily: '"Noto Sans", sans-serif'
    fontSize: '12px'
    fontWeight: 500
    lineHeight: '16px'
  helper:
    fontFamily: '"Noto Sans", sans-serif'
    fontSize: '12px'
    fontWeight: 400
    lineHeight: '20px'
  meta:
    fontFamily: '"Noto Sans", sans-serif'
    fontSize: '11px'
    fontWeight: 400
    lineHeight: '16px'
  code:
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace'
    fontSize: '12px'
    lineHeight: '20px'
rounded:
  control: '4px'
  switch: '12px'
spacing:
  step: '4px'
  small: '8px'
  compact: '12px'
  group: '16px'
  panel: '20px'
  section: '24px'
  page: '32px'
components:
  button-primary:
    backgroundColor: '{colors.text}'
    textColor: '{colors.button-ink}'
    typography: '{typography.label}'
    rounded: '{rounded.control}'
    padding: '8px 12px'
  button-primary-hover:
    backgroundColor: '{colors.button-hover}'
  button-secondary:
    backgroundColor: '{colors.raised}'
    textColor: '{colors.text}'
    rounded: '{rounded.control}'
    padding: '8px 12px'
  button-text:
    textColor: '{colors.secondary}'
    padding: '4px 8px'
  input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    typography: '{typography.body}'
    rounded: '{rounded.control}'
    padding: '8px 12px'
  navigation-active:
    backgroundColor: '{colors.raised}'
    textColor: '{colors.text}'
    rounded: '{rounded.control}'
    padding: '0 8px'
  badge:
    backgroundColor: '{colors.raised}'
    textColor: '{colors.secondary}'
    typography: '{typography.meta}'
    rounded: '{rounded.control}'
    padding: '0 4px'
---

# Design System: TwitchMock

## Overview

TwitchMock is a compact developer interface for configuring channel state, triggering EventSub events, managing rewards, and simulating chat. Preserve the full operating controls and section order. The content and observable simulation results provide the visual interest.

**Key Characteristics:**

- Graphite surfaces with three text roles
- Rare Twitch accent and restrained semantic status colors
- Flat sections, aligned controls, and a 4px spacing rhythm

Source of truth: `src/client/styles.css`, shared primitives in `src/client/shared.tsx`, and the shell in `src/client/main.tsx`. This document records the implementation and confirmed user direction; the sidecar supplies preview snippets and breakpoint metadata.

## Colors

The neutral ramp runs from chrome through page, surface, raised, and hover. Text, secondary, and muted establish hierarchy; the translucent border creates quiet hairlines. Controls use stronger neutral strokes so their boundaries remain visible.

Twitch purple is the primary accent, reserved for the brand mark, checked controls, keyboard focus, and text selection. Primary buttons use light neutral text color as their background with dark ink. Success and error colors communicate state, accompanied by text; reward swatches represent reward data rather than additional chrome accents.

Keep normal text at least 4.5:1 against its actual background, including accent-backed text. Do not lower muted text opacity or reuse a text color on an unverified raised surface. Hairline section dividers are decorative; field strokes and focus indicators must remain distinguishable.

## Typography

Use locally bundled Noto Sans Regular and Medium, with sans-serif fallback. The interface uses weights 400 and 500; the Medium face is declared for 500–600 in CSS, but current headings and controls use 500. Code and JSON use the system monospace stack. Numbers inherit tabular figures.

The frontmatter records the hierarchy: page headline, section title, panel title, body, label, helper, and metadata. Navigation uses body size; mobile navigation captions use 11px with a 12px line height. Hierarchy comes from size and color, with no negative tracking on small text, italic emphasis, or heavy headings. Use sentence case, short factual labels, and no trailing periods on short interface strings.

## Layout

The shell fills the viewport and grows with content. Desktop uses a sticky full-height sidebar (256px), a topbar (60px), and fluid content capped at 1536px including page padding (32px). Navigation rows are 36px high with 4px gaps and aligned icon/label columns. Sections use 24–32px separation; fields use 8px internal gaps and 16px group gaps. Fixed dimensions and spacing follow the 4px grid; 1px strokes and 2px optical control insets are intentional.

- At widths up to 1100px, page edges become 24px; overview and rewards stack, with overview supporting sections in two columns.
- Up to 850px, the sidebar becomes a 76px rail with icons and short captions. EventSub, chat, and settings become one column; chat supporting sections use two columns. Event selection is capped at 320px height.
- Up to 560px, navigation becomes a fixed bottom bar (64px) containing all five destinations, with matching content clearance. Topbar height is 56px; page padding is 24px 16px 40px. Supporting sections and paired fields stack. Buttons and single-line fields have a 44px minimum height; navigation targets are at least 44px wide. Reward actions wrap below their row content.

Support a minimum viewport width of 320px without page overflow. Event names truncate inside equal-height rows (56px); event detail headings wrap long identifiers. Tables scroll within their wrapper. JSON and message text wrap; the chat feed scrolls internally (420px desktop, 360px mobile). Preserve these constraints when adding controls.

## Elevation & Depth

Depth comes from neutral surface steps and hairlines. There are no shadows, glows, backdrop blur, or decorative gradients. Hover and selection change surface or text color without moving layout. There are no entrance or looping animations; reduced-motion CSS suppresses future transitions and animations.

## Shapes

Controls, navigation rows, quiet badges, and reward swatches use small corners from the control radius. Panels are open sections with a top divider, not rounded cards. Circular forms are limited to avatars, status dots, and switch thumbs. Do not wrap every section in another container or turn controls into pills.

## Components

- **Buttons:** light primary, neutral secondary, and quiet text actions. Hover shifts neutral tone. Destructive actions use error text; disabled buttons use half opacity and a disabled cursor. Preserve native button behavior and submission states.
- **Fields:** visible labels above neutral inputs, selects, and vertically resizable textareas. Placeholders use muted text. Focus changes the border and adds a neutral 1px outline; other keyboard targets use an accent 2px outline with 2px offset. Keep hints adjacent to their fields.
- **Navigation:** neutral default/hover/active surfaces, 500 weight only on active links. Keep `aria-current`, accessible names, and all destinations through rail and bottom-bar layouts.
- **Icons:** reuse the shared inline SVG set, normally 16px with 1.5 stroke, round caps/joins, and inherited text color. Navigation reserves a fixed 16px column with 8px label gaps. The 20px Twitch brand mark is the deliberate exception. No emoji or decorative title icons.
- **Status and feedback:** small dots plus readable text, quiet role badges, success notices with `role="status"`, and errors with `role="alert"`. Empty states explain the missing content. Preserve visible loading/error feedback and the controls that recover from it.
- **Event selection:** native radios inside clickable equal-height rows, neutral selected surfaces, and a focus outline on the containing row. Preserve versions as metadata and access to full selected-event details.
- **Chat and rewards:** scrollable live feed, composer, reply context, advanced options, reward data swatches, and row actions remain functional at every width. Keep disclosure controls, wrapping identifiers, and local scrolling rather than hiding controls to fit.

## Do's and Don'ts

- **Do** preserve all simulation controls, their behavior, and section order.
- **Do** use the graphite ramp, three text roles, and the 4px rhythm consistently.
- **Do** verify keyboard focus, text contrast, and long content at desktop and 320px mobile widths.
- **Don't** add hue gradients, colored shadows, glows, decorative imagery, or looping motion.
- **Don't** introduce emoji, unrelated icon sets, heavy headings, uppercase tracked labels, or hype copy.
- **Don't** replace operating controls with static previews or hide actions to make a layout fit.
