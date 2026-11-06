# thaamba design system

Source: the brand deck (`thaamba-deck.pdf`, slide 1 rendered as `deck-slide-1.png`),
the logo lockup (`thaamba-logo.svg`), and the published spec at
https://amr-api.open-design.ai/api/v1/public/snapshots/jjfkiex0ecbr2yzqisypn104/files/index.html

**The name is `thaamba`, lowercase, two a's.** Not Thamba, not Thaamba.

## Palette

Monochrome and dark first. The deck defines no red or green, because a deck has
no prices in it. The app does, so it keeps its semantic pair for money moving
and takes everything else from here.

| Token | Hex | Use |
|---|---|---|
| Ink | `#0E0E10` | Primary text and dark elements |
| Surface | `#16161A` | Base background |
| Raised | `#1F1F24` | Elevated surfaces |
| Hairline | `#2C2C32` | Borders and dividers |
| Muted | `#9A9AA2` | Secondary text |
| Paper | `#EDEDEB` | Light surfaces |
| Paper ink | `#111113` | Primary text on light |
| Paper muted | `#56565E` | Secondary text on light |

## Type

Figtree for everything, JetBrains Mono for labels and data.

The deck's own scale is deck scale (120px display, 28px body) and does not
transfer to an app. What transfers is the pairing and the label treatment:
mono, uppercase, letter-spacing `+0.08em`.

## The mark

An octagon, always outlined with rounded joins. Fill it only to show a current
state. The lockup is the mark plus the wordmark in lowercase.

## Layout language

Hairline-bordered cells with a small mono label at the top left, an 8px
baseline rhythm, and generous margins. The app already builds from hairlines
and 10px radii, so this is a change of palette and type rather than structure.
