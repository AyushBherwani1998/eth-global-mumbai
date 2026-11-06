# Groww reference tokens (measured from the Figma community file "Groww App UI", Nov 2026)

Source frames: Stocks home, Individual Stock Page, Mutual Funds dashboard. Screenshots in this folder.

## Light
- Ground: #FFFFFF (no off-white)
- Card border: #E8E8E8, 1px, radius 10px, no shadow, no fill
- Text primary: #000000 (names, prices); secondary #919191 / #969696 (labels, sector chip)
- Gain / Buy: #00B386 (text, chart line, Buy button fill, active tab underline)
- Loss / Sell: #F35D5D (text, Sell button fill)
- Nav active / brand: #5367FF (bottom-nav active icon + label only)
- Chip (filter): outlined #E8E8E8, radius 999; selected = fill #EBEBEB with 1px #222222 border, text #222222
- Tabs (Overview / News / Events): text; active = #00B386 text + 3px #00B386 underline
- Sector chip on detail: outlined #E8E8E8, radius 10, text #919191, 13px semibold
- Dotted separator under chart: 1px dotted #D0D0D0
- Bottom nav: white, hairline top border, 3 items (icon + 11px label), active #5367FF

## Dark (Groww dark mode)
- Ground: #121212; card: #1A1A1A; border: #2C2C2C; text #FFFFFF; secondary #8F8F8F
- Gain #0FCB9A, Loss #FF6B6B, nav active #7B8BFF (same hues, lifted for contrast)

## Type (Roboto in the Figma file; Groww production uses a similar grotesk)
- Stock name 20/400; price 24/500; change 14/500 (green/red); range label "1D" 14/500 #969696
- Section title 18/500 ("Most bought on Groww"); card title 16/500; card price 15/400; card change 13/600
- Index card: label 12/500 #000, value 12/400, change 12/400 red/green
- Header title 20/500 next to a 34px round logo; search + QR + avatar icons at right

## Layout
- Page padding 20px; card grid 2 columns, 176px cards, 160px tall, 15px inner padding, logo top-left, name, price, change
- Index strip: two 195x68 outlined cards side by side
- Detail header: back arrow row; logo row with alarm / bookmark / search icons; name; price; change + range
- Chart: 308px tall, green line, no grid, expand icon bottom-right, dotted baseline, then NSE|BSE toggle + 1D 1W 1M 1Y 5Y ALL chips (selected = grey fill, dark border)
- "Create Stock SIP" promo card: icon tile + title + subtitle + chevron
- Overview / News / Events tabs
- Fixed bottom bar: Sell (red) and Buy (green), 10px radius, 52px tall, 50/50
- MF dashboard: "Investments (4)" title; summary card with 2x2 label/value grid, XIRR row with "Portfolio analysis" link; list rows name + SIP tag + value green + (invested) grey
