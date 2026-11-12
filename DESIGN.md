---
name: Tristan Drummond — Public Folio
description: A direct, evidence-led public portfolio in celadon and forest ink.
colors:
  celadon-ground: "#eef3ed"
  forest-ink: "#173a30"
  muted-forest: "#4b6257"
  burnt-orange: "#a64724"
  celadon-rule: "#bccbbf"
  forest-hover: "#295444"
  white: "#fff"
  celadon-inset: "#dce6de"
  inverse-muted: "#c4d7c9"
  inverse-link-rule: "#8aa795"
  inverse-divider: "#567467"
  warm-peach: "#e8b38d"
typography:
  display:
    fontFamily: "Commissioner, sans-serif"
    fontSize: "clamp(50px, 7.3vw, 96px)"
    fontWeight: 500
    lineHeight: 1.07
    letterSpacing: "-0.04em"
  display-mobile:
    fontFamily: "Commissioner, sans-serif"
    fontSize: "clamp(39px, 7.7vw, 54px)"
    fontWeight: 500
    lineHeight: 1.12
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Commissioner, sans-serif"
    fontSize: "clamp(32px, 3.5vw, 48px)"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Commissioner, sans-serif"
    fontSize: "38px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  section-title:
    fontFamily: "Commissioner, sans-serif"
    fontSize: "26px"
    fontWeight: 500
    lineHeight: 1.55
    letterSpacing: "-0.02em"
  body:
    fontFamily: "'Source Sans 3', sans-serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.55
  body-feature:
    fontFamily: "'Source Sans 3', sans-serif"
    fontSize: "21px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "'Source Sans 3', sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.55
  caption:
    fontFamily: "'Source Sans 3', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  square: "0px"
  focus: "1px"
spacing:
  compact: "8px"
  inline: "12px"
  control: "16px"
  inset: "20px"
  paragraph: "24px"
  group: "28px"
  column: "32px"
  section-mobile: "40px"
  section: "64px"
  section-wide: "80px"
components:
  button-primary:
    backgroundColor: "{colors.forest-ink}"
    textColor: "{colors.celadon-ground}"
    rounded: "{rounded.square}"
    padding: "15px 20px"
  button-primary-hover:
    backgroundColor: "{colors.forest-hover}"
    textColor: "{colors.white}"
  button-primary-mobile:
    backgroundColor: "{colors.forest-ink}"
    textColor: "{colors.celadon-ground}"
    rounded: "{rounded.square}"
    padding: "13px 16px"
  text-link:
    textColor: "{colors.forest-ink}"
  text-link-hover:
    textColor: "{colors.burnt-orange}"
  navigation:
    textColor: "{colors.forest-ink}"
    typography: "{typography.label}"
    padding: "28px 0"
  ruled-heading:
    textColor: "{colors.forest-ink}"
    typography: "{typography.section-title}"
    padding: "22px 0 0"
  image-frame:
    backgroundColor: "{colors.celadon-inset}"
    rounded: "{rounded.square}"
  statement-panel:
    backgroundColor: "{colors.forest-ink}"
    textColor: "{colors.celadon-ground}"
    rounded: "{rounded.square}"
    padding: "56px 42px"
  contact-link:
    textColor: "{colors.celadon-ground}"
    padding: "10px 0"
  contact-link-hover:
    textColor: "{colors.warm-peach}"
---

# Design System: Tristan Drummond — Public Folio

## Overview

**Creative North Star: "The Architect’s Practice Folio"**

The public site presents a working practice with quiet confidence. Broad fields of pale celadon, forest typography and fine horizontal rules give specific work room to speak. Large, tightly spaced headings establish hierarchy; readable text and unembellished images keep the experience human and direct.

The material character is flat and precise. A small burnt-orange accent punctuates the otherwise restrained palette, while solid forest sections provide emphasis without simulated depth. This supports the credible, direct brand commitment in [PRODUCT.md](PRODUCT.md).

This system covers the public portfolio, public artwork viewer and public recovery states. Its implementation source is [PublicSite.css](web/src/pages/PublicSite.css), sampled against [HomePage.tsx](web/src/pages/HomePage.tsx), [PublicArtwork.tsx](web/src/pages/PublicArtwork.tsx) and [NotFoundPage.tsx](web/src/pages/NotFoundPage.tsx). Private application styling is outside this system. Page composition belongs in the [surface brief](.impeccable/surfaces/web-src-pages-homepage-tsx.md).

**Key Characteristics:**
- Celadon ground, forest ink and a restrained warm accent.
- Commissioner headings with Source Sans 3 reading text.
- Broad ruled sections, square surfaces and unframed portraits.
- Real imagery, visible keyboard focus and restrained motion.

## Colors

The palette combines a cool green paper ground with dark forest ink and small warm accents; the frontmatter is the normative color reference.

### Primary

- **Forest Ink:** primary text, strong section rules, filled actions and inverted statement/contact surfaces.
- **Forest Hover:** filled-action hover background, paired with **White** text.
- **Burnt Orange:** name and headline punctuation, light-surface link hovers and light-surface keyboard focus.
- **Warm Peach:** link hover and keyboard-focus color inside the dark contact section, including its footer.

### Neutral

- **Celadon Ground:** the page background and primary text on inverted forest surfaces.
- **Muted Forest:** supporting prose, roles, location text and captions on light surfaces.
- **Celadon Rule:** secondary section dividers and the navigation baseline.
- **Celadon Inset:** product-image and artwork mats.
- **Inverse Muted:** supporting prose on forest statement and contact surfaces.
- **Inverse Link Rule:** the contact-address underline.
- **Inverse Divider:** the footer divider on forest.
- **White:** the filled-action hover text only; it is not the page ground.

**The Surface Contrast Rule.** Use burnt orange for interaction on the light ground and warm peach for interaction in the dark contact section. Preserve a clearly visible focus outline on both.

## Typography

**Display Font:** Commissioner with a sans-serif fallback.

**Body Font:** Source Sans 3 with a sans-serif fallback.

Both fonts are self-hosted variable WOFF2 files with `font-display: swap`; their sources and licences are recorded in [the asset manifest](web/public/ASSETS.md). Headings use medium weight, balanced wrapping and negative tracking. Body text is more open and generously led. There is no separate monospaced or uppercase-label system.

### Hierarchy

- **Display:** the `display` role serves the main introduction; `display-mobile` replaces it at the phone breakpoint.
- **Headline:** the `headline` role pairs project statements with body copy and also appears on the forest statement panel. It resolves to a fixed phone size (37px).
- **Title:** the `title` role names a project, reducing on phones (34px). Artwork headings have their own observed range (`clamp(36px, 5vw, 64px)`) with line height (1.12).
- **Section title:** the `section-title` role accompanies a strong horizontal rule. Larger about and contact headings are surface-specific expressions, not additional default type scales.
- **Body:** the `body` role is the reading default, reducing on phones (18px). The `body-feature` role supports project narratives and artwork descriptions, reducing on phones (19px). Reading widths vary with purpose (52–70ch).
- **Label and caption:** the `label` role serves navigation and supporting information; `caption` serves image context. Prominent text actions use semibold weight (600). The portrait caption reduces on phones (12px), and product-image captions reduce to (13px).

**The Two Voices Rule.** Use Commissioner for headings and the name wordmark; use Source Sans 3 for reading text, navigation, captions and actions.

## Layout

The shared container is centered, with a maximum width (1280px) and desktop side gutters (56px). At viewport widths up to (1000px), gutters become (32px); at widths up to (700px), they become (20px). The artwork reading container is narrower (1100px maximum) and follows the same gutter changes.

Sections use horizontal rules, generous vertical separation and asymmetric or equal two-column grids where the material calls for them. The repeated spacing steps in the frontmatter describe the implemented rhythm; they are not a mandatory mathematical scale. Typical desktop column gaps range from (64–100px), tighten at the middle breakpoint and collapse to a single reading column on phones.

The introduction has a purposeful mobile exception: biography spans the full row, followed by actions alongside the portrait. Its phone grid is `1fr 112px`, with row gap (28px) and a fluid column gap (`clamp(10px, 3vw, 20px)`). Preserve that narrow-screen clearance when changing copy or action labels. The portrait remains visible and uncropped by a decorative frame; the image itself uses `object-fit: cover`.

Navigation changes from a horizontal header to a stacked name and full-width link row on phones. Project narratives, evidence rows, statement panels, about copy and contact content stack in reading order. Long artwork titles can wrap anywhere; artwork images retain their proportions and fit within the viewport rather than becoming cropped thumbnails.

## Elevation & Depth

The public system has no box shadows. It uses tonal contrast, thin rules and the scale of typography to organize the page. Celadon image mats separate source imagery from the page ground; forest blocks create emphasis. Neither treatment implies floating cards or a layered glass surface.

**The Flat Surface Rule.** Keep public surfaces flat. Express hierarchy with space, rules, type and the existing tonal surfaces rather than introducing shadow-based elevation.

## Shapes

Actions, image mats and statement panels have square corners. The keyboard outline uses a nearly square corner from the `focus` radius token. Horizontal rules are fine strokes (1px), with forest for strong section boundaries and the appropriate lighter divider for secondary boundaries.

Portraits remain rectangular and unframed. Images have no decorative masks. Directional icons are stroked inline SVGs, usually (14–20px), with stroke width (1.5); they supplement visible action text.

## Components

### Buttons

Filled actions are compact, solid and direct. Links and the artwork retry button share the same visual treatment: forest fill, celadon text, semibold text (600), square corners and a minimum height (54px). The primary and phone paddings are defined in the frontmatter. Arrow icons sit beside the action text with a desktop gap (24px), reducing on phones (18px).

Hover changes the fill to Forest Hover and the text to White. Keyboard focus uses an outline (3px) offset from the control (6px). Color changes transition over (160ms) with `ease` where the anchor rules apply; the retry button does not introduce a separate motion treatment.

### Text Links

Text actions use semibold weight (600), a text-and-arrow gap (12px) and minimum height (44px). Supporting inline prose links are underlined, with offset (5px) and thickness (1px). Light-surface hover uses Burnt Orange. Focus follows the shared outline; dark contact links use Warm Peach for hover and focus.

### Navigation

The header is a flat, ruled row with a Commissioner name wordmark and Source Sans 3 links. The wordmark uses semibold weight (600), negative tracking (-0.025em) and small accent punctuation. Navigation links have a minimum height (44px). The phone layout keeps the visible links in a horizontal row beneath the name. There is no active-pill, floating-header or collapsed-menu treatment in this public system.

### Cards / Containers

The implemented containers are image mats and a statement panel. Image mats use Celadon Inset with square edges; product images fill their available width, while artwork images remain contained. Product-mat padding is (42px 42px 0) on desktop and (16px 16px 0) on phones; artwork mats use (30px), reducing to (14px).

The statement panel uses Forest Ink, Celadon Ground heading text and Inverse Muted supporting text. It distributes its content vertically, with minimum heights (360px desktop, 340px middle, 280px phone). Padding steps down from the frontmatter's desktop value to (38px 30px) and then (32px 26px). It has no border or shadow.

### Ruled Section Heading

A strong forest rule establishes a new section. A Commissioner heading sits beneath it, with muted supporting text aligned opposite on desktop and below on phones. This is a section boundary, not a label or eyebrow above a title.

### Contact Surface

The contact area is a full-width forest field containing the shared page-width grid. The address is an underlined text-and-arrow action; supporting copy and footer text use Inverse Muted. The footer divider and contact-address underline have separate tonal values. All contact and footer links receive Warm Peach focus outlines and hover color.

### Artwork and Recovery States

Artwork loading, missing-content and connection-error states use the same heading, supporting-text and action vocabulary as the public recovery page. The audio row uses native browser controls with an accessible name and visible supporting text. The native player's browser-specific appearance is not a house component token. No public form-field or chip system is established by this build.

The only entrance animation is the desktop introductory heading: a short upward arrival (12px over 600ms) with `cubic-bezier(0.16, 1, 0.3, 1)` and a small clipping reveal. It runs only at widths of at least (1000px) when the visitor has no reduced-motion preference. Reduced motion disables public animation and transitions and restores automatic scrolling behavior.

## Do's and Don'ts

### Do:

- **Do** use the frontmatter tokens and the existing public stylesheet as the source of visual values.
- **Do** keep the two font roles, readable text measures and responsive reading order intact.
- **Do** use real imagery with descriptive alternative text and recorded provenance.
- **Do** preserve visible focus on both light and forest surfaces, including footer links.
- **Do** keep the narrow-screen action-and-portrait grid within its available width.
- **Do** respect reduced-motion preferences and keep imagery legible without animation.

### Don't:

- **Don't** replace the broad ruled sections with a wall of interchangeable cards.
- **Don't** add fabricated paper texture, ornamental masks, glass effects or decorative shadows.
- **Don't** turn captions or supporting information into an uppercase eyebrow system.
- **Don't** use text glyphs as substitutes for the implemented inline SVG direction icons.
- **Don't** inherit private dashboard colors, fonts or component shapes into the public visual system.
- **Don't** treat browser-native audio control styling as a fixed branded component.
