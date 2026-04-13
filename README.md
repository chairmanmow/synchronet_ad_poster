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
- `--dry-run`

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
