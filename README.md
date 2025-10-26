# Ad Poster (ANSI/TXT ad uploader)

Interactive Synchronet xtrn for previewing ANSI/TXT ads and posting them into one or more message bases.

## Files

| File | Purpose |
| --- | --- |
| `ad_poster.js` | The interactive JavaScript door (invoked via `?jsexec`). |
| `adposter.ini` | Sysop configuration (paths, defaults, message-area mappings). |
| `README.md` | This document. |

> **Note**: The script looks specifically for `adposter.ini` (no underscore). Keep both file name and location as shown above.

## Installation

1. **Copy the directory**  
   Place the entire `xtrn/ad_poster/` folder under your Synchronet installation, e.g. `/sbbs/xtrn/ad_poster/`.

2. **Create (or reuse) an ads directory**  
   Store your ANSI/TXT ad files somewhere accessible to the BBS (for example `/sbbs/text/bbs_ads`). The `ads_dir` setting in the INI points here.

3. **Configure SCFG**  
   ```
   SCFG -> External Programs -> Online Programs (Doors) -> Add
      Name/Prompt : Ad Poster (or similar)
      Internal ID : AD_POSTER
      Command Line: ?jsexec xtrn/ad_poster/ad_poster.js
      Startup Dir : ../xtrn/ad_poster
      Execution   : Native
      Multi-user  : Yes
   ```
   Adjust the relative paths if your Synchronet root differs. The program does not require drop files.

4. **Review `adposter.ini`**  
   This file lives beside the script (`/sbbs/xtrn/ad_poster/adposter.ini`). Three sections matter:

   ```ini
   [paths]
   ads_dir = /sbbs/text/bbs_ads        ; Folder of ANSI/TXT ads. Use absolute paths.

   [defaults]
   to = All                           ; Default "To" field.
   from = HM Derdoc                   ; Default "From" (often your sysop name).
   subject = Advertisement            ; Default subject line.
   fixed = yes                        ; yes/no: mark MSG_FIXED_FORMAT.

   [locations]
   local   = LOCAL_ADS                ; menu key → Synchronet sub internal code
   dovenet = DOVE-ADS
   fsxnet  = FSX_ADS
   ```

   - **`ads_dir`** can be any absolute path. Use a directory that only contains ANSI/TXT ads, or the picker will display every file it finds.
   - **`defaults`** are optional. Leave fields blank to prompt the user each session.
   - **`locations`** maps menu labels to Synchronet sub-board *internal* codes (exactly as defined in SCFG ➝ Message Areas). Add as many entries as you need; the first entry becomes the default selection when the door opens.

5. **Permissions/ACLs**  
   Ensure the `ads_dir` contents are readable by the Synchronet account and that the target message bases allow posts from the intended users.

## Usage

1. Launch the door from your BBS (or via `?jsexec xtrn/ad_poster/ad_poster.js` at the server console).
2. Choose a posting location (`[locations]` entries appear as menu options).
3. Pick an ad file from `ads_dir`. The picker filters for `.ans`, `.txt`, `.asc`, and `.msg` (other files are listed but may not render nicely).
4. Preview the file if desired (the door strips SAUCE blocks automatically before posting).
5. Edit To/From/Subject or toggle “fixed format” (preserves ANSI spacing and colors).
6. Post. The script writes the message via `MsgBase.save_msg()` and reports success/failure on screen.

## Tips

- Keep ad filenames short and descriptive—the picker shows only basenames.
- To add networked subs (e.g., fsxNet, DOVE-Net), copy their exact internal codes from SCFG; mismatches will be rejected before posting.
- Multiple sysops can share the same `adposter.ini`. If you want per-node defaults, duplicate the directory and update SCFG to point at alternate INIs.

Enjoy curating ads!
