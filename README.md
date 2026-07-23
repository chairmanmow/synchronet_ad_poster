# Ad Poster (ANSI/TXT ad uploader)

`ad_poster.js` can run in two modes:

- **Interactive UI mode** (online user session / door)
- **CLI batch mode** (non-interactive / cron)

## Files

| File | Purpose |
| --- | --- |
| `ad_poster.js` | UI + CLI posting script |
| `adposter.ini` | Primary config file |
| `ad_poster.ini` | Alternate config filename (fallback) |
| `README.md` | This document |

INI lookup order:

1. `--ini /path/to/file.ini` (if provided)
2. `adposter.ini` in script directory
3. `ad_poster.ini` in script directory

## Installation

1. Copy folder to `/sbbs/xtrn/ad_poster/`.
2. Configure SCFG door entry if using interactive mode:

```
Command Line: ?jsexec xtrn/ad_poster/ad_poster.js
Startup Dir : ../xtrn/ad_poster
Execution   : Native
```

3. Update `adposter.ini`.

## INI format

```ini
[paths]
ads_dir = /sbbs/text/bbs_ads

[defaults]
to = All
from = HM Derdoc
subject = Advertisement
fixed = yes
category = bbs_ad

[locations]
local   = LOCAL_ADS
dovenet = DOVE-ADS
fsxnet  = FSX_ADS

[overrides]
future_beach.ans = Futureland Beach Party

[categories]
future_beach.ans = bbs_ad
network_spot.ans = networks_ads

[ad:future_beach.ans]
subject = Futureland Beach Party
category = bbs_ad
```

### Category behavior

- Default category for random posting comes from `[defaults] category`.
- If omitted, it defaults to `bbs_ad`.
- Per-file category can be set in `[categories]` or `[ad:<filename>]`.

### Per-file subject behavior

- Per-file subject can be set in `[overrides]`, `[subjects]`, `[topics]`, `[topic_overrides]`, or `[ad:<filename>] subject`.

## CLI batch mode

Run with:

```bash
jsexec ../xtrn/ad_poster/ad_poster.js [options]
```

If run with **no args** in non-interactive mode, it will:

- iterate all `[locations]`
- choose a random ad for each message base
- filter by default category (`bbs_ad` unless overridden)

### Common options

- `--mode random|explicit`
- `--file FILE`
- `--location key[,key...]`
- `--sub CODE[,CODE...]`
- `--category NAME`
- `--same-ad` (use one random file for all target subs)
- `--subject TEXT`
- `--file-topic FILE=TEXT` (repeatable)
- `--to NAME`, `--from NAME`, `--fixed yes|no`
- `--width N` / `--render-width N` (see [ANSI layout](#ansi-layout))
- `--dry-run`
- `--preview`

### Examples

Generic cron-style run (random `bbs_ad` per configured sub):

```bash
jsexec ../xtrn/ad_poster/ad_poster.js
```

Random only from `networks_ads` to selected locations:

```bash
jsexec ../xtrn/ad_poster/ad_poster.js --mode random --category networks_ads --location dovenet,fsxnet
```

Explicit file to explicit subs:

```bash
jsexec ../xtrn/ad_poster/ad_poster.js --mode explicit --file future_beach.ans --sub DOVE-ADS,FSX_ADS
```

CLI per-file topic override (takes precedence over INI):

```bash
jsexec ../xtrn/ad_poster/ad_poster.js --mode explicit --file future_beach.ans --subject "Global Subject" --file-topic future_beach.ans="Beach Blast"
```

## ANSI layout

Ads are re-flowed before posting so they survive a message base.

Most `.ans` art is stored **without any row terminators**: the artist's canvas is
some fixed width and the terminal is expected to wrap. Posting such a file
verbatim mangles it, and wrapping it at the wrong width shears the art one
column further left on every row. Two more details bite:

- Art editors write **NUL (0x00) as a blank cell** — usually the single most
  common byte in the file. NUL cannot go into a message body, and dropping it
  collapses every column to its right.
- A row that fills **column 80** makes an 80-column reader auto-wrap, so the
  CRLF that follows costs a second line and the ad comes out double-spaced.

So `ad_poster.js` replays the art through a small terminal model to recover its
row grid, then emits hard-wrapped CRLF rows:

- Canvas width comes from the **SAUCE** record (`TInfo1`) when present,
  otherwise 80. Override with `--render-width N`.
- Rows are hard-wrapped at **79** columns, one clear of the auto-wrap. Override
  with `--width N`.
- NUL and Ctrl-A become blanks, so cell alignment is preserved and neither byte
  reaches the message base.
- `ESC[nC` becomes blanks; SGR colour is passed through; SAUCE, COMNT and the
  DOS EOF marker are stripped.
- Trailing blanks are trimmed per row, except where a background colour is
  active (those are painted cells, not padding).
- The body opens and closes with `ESC[0m`, so the ad neither inherits nor leaks
  attributes.

Posts report the resulting geometry, e.g.
`rows=20 width=79/79 canvas=79 (SAUCE)`. If any row still exceeds the limit the
report says `OVER-WIDE-ROWS=n` — that ad will wrap in an 80-column reader.

### Previewing

`--preview` renders ads to stdout instead of posting, which is the quickest way
to check an ad before it goes out over a network:

```bash
# one ad
jsexec ../xtrn/ad_poster/ad_poster.js --preview -f future_beach.ans

# everything in a category
jsexec ../xtrn/ad_poster/ad_poster.js --preview --category networks_ads
```

In the UI, menu item `3` offers **P**) as posted to the message base, or
**R**) the raw file as stored on disk. The raw view is expected to look sheared
for terminator-less art; the "as posted" view is what actually gets saved.

## Subject precedence

For each post, subject is resolved in this order:

1. `--file-topic FILE=TEXT` (CLI per-file)
2. `--subject TEXT` (CLI global)
3. INI per-file override
4. `[defaults] subject`
5. fallback: `Advertisement: <filename>`

## Mode selection rules

- If running with args: uses CLI mode.
- If no args and no online user session: uses CLI mode.
- If no args and an online user session exists: uses interactive UI mode.
