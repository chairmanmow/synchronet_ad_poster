// ad_poster.js — Interactive + CLI ad poster for Synchronet
//
// Interactive usage (online user session):
//   ?jsexec xtrn/ad_poster/ad_poster.js
//
// CLI/cron usage:
//   jsexec ../xtrn/ad_poster/ad_poster.js [options]
//
// Load Synchronet defs.
load("sbbsdefs.js");

var VERSION = "1.3.0";
var P_SAVEATR = 0x80;
var ESC = "\x1b";

// Message readers run at 80 columns. A row that fills column 80 makes the
// terminal auto-wrap, and the CRLF that follows then costs a second line, so
// the art comes out double-spaced and sheared. Stay one column clear.
var MAX_POST_WIDTH = 79;

// Canvas width assumed for art that carries no SAUCE record.
var DEFAULT_RENDER_WIDTH = 80;

// --- Polyfills -------------------------------------------------------------
if (!String.prototype.repeat) {
    String.prototype.repeat = function (n) {
        var r = "";
        for (var i = 0; i < n; i++) r += this;
        return r;
    };
}
if (!String.prototype.endsWith) {
    String.prototype.endsWith = function (suffix) {
        var start = this.length - suffix.length;
        if (start < 0) return false;
        return this.substr(start) === suffix;
    };
}
if (!String.prototype.trim) {
    String.prototype.trim = function () {
        return this.replace(/^\s+|\s+$/g, "");
    };
}
if (!Array.prototype.indexOf) {
    Array.prototype.indexOf = function (value) {
        for (var i = 0; i < this.length; i++) {
            if (this[i] === value) return i;
        }
        return -1;
    };
}

// --- Output helpers --------------------------------------------------------
function hasConsoleOutput() {
    return (typeof console !== "undefined" && console && typeof console.print === "function");
}

function hasConsoleInput() {
    return (typeof console !== "undefined" && console && typeof console.getkey === "function");
}

function isInteractiveSession() {
    return (typeof bbs !== "undefined" && bbs && bbs.online && hasConsoleInput());
}

function println(s) {
    var msg = String((s === undefined || s === null) ? "" : s);
    if (hasConsoleOutput()) {
        console.print(msg + "\r\n");
        return;
    }
    if (typeof writeln === "function") {
        writeln(msg);
        return;
    }
    if (typeof print === "function") {
        print(msg + "\n");
    }
}

function hr(ch, w) {
    var width = w || ((typeof console !== "undefined" && console && console.columns) ? console.columns : 80);
    println((ch || "-").repeat(width));
}

function center(s) {
    var msg = String(s || "");
    var width = ((typeof console !== "undefined" && console && console.columns) ? console.columns : 80);
    var pad = Math.max(0, ((width | 0) - msg.length) >> 1);
    println(" ".repeat(pad) + msg);
}

function pauseIfInteractive() {
    if (isInteractiveSession()) {
        println("");
        println("Press any key...");
        console.getkey();
    }
}

function ensureTrailingSlash(p) {
    var s = String(p || "");
    if (!s.length) return "";
    if (s.charAt(s.length - 1) === "/" || s.charAt(s.length - 1) === "\\") return s;
    return s + "/";
}

function basename(p) {
    var s = String(p || "");
    var i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
    return i >= 0 ? s.substr(i + 1) : s;
}

function normalizeFileKey(name) {
    return basename(String(name || "").trim()).toLowerCase();
}

function parseBool(value, defVal) {
    if (value === undefined || value === null || value === "") return !!defVal;
    var s = String(value).trim().toLowerCase();
    if (s === "1" || s === "true" || s === "yes" || s === "y" || s === "on") return true;
    if (s === "0" || s === "false" || s === "no" || s === "n" || s === "off") return false;
    return !!defVal;
}

function randomIndex(max) {
    if (max <= 0) return 0;
    if (typeof random === "function") return random(max);
    return Math.floor(Math.random() * max);
}

function pickRandom(list) {
    if (!list || !list.length) return "";
    return list[randomIndex(list.length)];
}

function fileExists(path) {
    var p = String(path || "");
    if (!p.length) return false;
    if (typeof file_exists === "function") return file_exists(p);
    var f = new File(p);
    return !!f.exists;
}

function addUnique(list, value) {
    if (list.indexOf(value) < 0) list.push(value);
}

function splitCsv(value) {
    return String(value || "").split(",").map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
}

function parseListArgInto(list, value) {
    splitCsv(value).forEach(function (v) { addUnique(list, v); });
}

// --- Interactive helpers ---------------------------------------------------
function yesNo(prompt, defYes) {
    console.print(prompt + (defYes ? " [Y/n]: " : " [y/N]: "));
    var k = console.getkey().toUpperCase();
    println("");
    if (k === "\r" || k === "\n") return !!defYes;
    return (k === "Y");
}

function promptStr(label, defVal, maxLen) {
    console.print(label + (defVal ? " [" + defVal + "]" : "") + ": ");
    var s = console.getstr(defVal || "", maxLen || 80, K_EDIT);
    return s && s.length ? s : (defVal || "");
}

// --- INI loading -----------------------------------------------------------
function stripIniInlineComment(value) {
    var s = String(value || "");
    // Remove inline comments like: value ; comment
    var i = s.search(/\s[;#]/);
    if (i >= 0) s = s.substring(0, i);
    return s.trim();
}

function loadIni(path) {
    var f = new File(path);
    if (!f.open("r")) return null;
    var txt = f.readAll().join("\n");
    f.close();

    var ini = {};
    var section = null;

    txt.split(/\r?\n/).forEach(function (line) {
        var s = line.trim();
        if (!s || s.charAt(0) === ';' || s.charAt(0) === '#') return;

        var m = s.match(/^\[(.+?)\]$/);
        if (m) {
            section = m[1].trim();
            ini[section] = ini[section] || {};
            return;
        }

        var kv = s.match(/^([^=]+)=(.*)$/);
        if (kv && section) {
            ini[section][kv[1].trim()] = stripIniInlineComment(kv[2]);
        }
    });

    return ini;
}

function resolveIniPath(cliIniPath) {
    if (cliIniPath && cliIniPath.length) return cliIniPath;

    var candidates = [
        js.exec_dir + "adposter.ini",
        js.exec_dir + "ad_poster.ini"
    ];

    for (var i = 0; i < candidates.length; i++) {
        if (fileExists(candidates[i])) return candidates[i];
    }

    return candidates[0];
}

function loadConfigFromIniObject(ini) {
    var paths = ini.paths || {};
    var defaultsRaw = ini.defaults || {};
    var locations = ini.locations || {};

    var cfg = {
        adsDir: ensureTrailingSlash(paths.ads_dir || "/sbbs/text/bbs_ads"),
        defaults: {
            to: defaultsRaw.to || "All",
            from: defaultsRaw.from || (system ? system.operator : "Sysop"),
            subject: defaultsRaw.subject || "Advertisement",
            fixed: parseBool(defaultsRaw.fixed, true),
            category: (defaultsRaw.category || defaultsRaw.ad_category || defaultsRaw.default_category || "bbs_ad")
        },
        locations: locations,
        subjectByFile: {},
        categoryByFile: {}
    };

    function addSubjectOverride(fileName, subject) {
        var key = normalizeFileKey(fileName);
        if (!key || !subject) return;
        cfg.subjectByFile[key] = String(subject);
    }

    function addCategoryOverride(fileName, category) {
        var key = normalizeFileKey(fileName);
        if (!key || !category) return;
        cfg.categoryByFile[key] = String(category);
    }

    // Flat section aliases for per-file subject overrides.
    var subjSectionNames = ["overrides", "subjects", "topics", "topic_overrides"];
    subjSectionNames.forEach(function (secName) {
        var sec = ini[secName];
        if (!sec) return;
        Object.keys(sec).forEach(function (k) {
            addSubjectOverride(k, sec[k]);
        });
    });

    // Flat section aliases for per-file categories.
    var catSectionNames = ["categories", "ad_categories"];
    catSectionNames.forEach(function (secName) {
        var sec = ini[secName];
        if (!sec) return;
        Object.keys(sec).forEach(function (k) {
            addCategoryOverride(k, sec[k]);
        });
    });

    // Rich per-file sections: [ad:<filename>]
    Object.keys(ini).forEach(function (sectionName) {
        var lower = sectionName.toLowerCase();
        if (lower.indexOf("ad:") !== 0) return;

        var fileSpec = sectionName.substr(3).trim();
        var section = ini[sectionName] || {};

        if (section.subject) addSubjectOverride(fileSpec, section.subject);
        if (section.category) addCategoryOverride(fileSpec, section.category);
    });

    return cfg;
}

function loadRuntimeConfig(cliIniPath) {
    var iniPath = resolveIniPath(cliIniPath || "");
    var ini = loadIni(iniPath);
    if (!ini) throw new Error("Missing INI: " + iniPath);
    return {
        iniPath: iniPath,
        ini: ini,
        cfg: loadConfigFromIniObject(ini)
    };
}

// --- File listing / selection ---------------------------------------------
function listAdFiles(dir) {
    var d = directory(ensureTrailingSlash(dir).replace(/[\\\/]$/, "") + "/*");
    var files = d.filter(function (p) {
        var n = p.toLowerCase();
        return n.endsWith(".ans") || n.endsWith(".txt") || n.endsWith(".asc") || n.endsWith(".msg");
    });
    return files.length ? files : d;
}

function resolveExplicitFile(fileArg, adsDir, allFiles) {
    var arg = String(fileArg || "").trim();
    if (!arg.length) return "";

    var candidates = [
        arg,
        ensureTrailingSlash(adsDir) + arg,
        js.exec_dir + arg
    ];

    for (var i = 0; i < candidates.length; i++) {
        if (fileExists(candidates[i])) return candidates[i];
    }

    var key = normalizeFileKey(arg);
    for (var j = 0; j < allFiles.length; j++) {
        if (normalizeFileKey(allFiles[j]) === key) return allFiles[j];
    }

    return "";
}

function menuSelect(title, items, pageSize) {
    pageSize = pageSize || (console.rows - 6);
    var page = 0;
    var total = items.length;
    if (total === 0) return -1;

    while (true) {
        console.clear();
        hr();
        center(title);
        hr();

        var start = page * pageSize;
        var end = Math.min(total, start + pageSize);
        for (var i = start; i < end; i++) {
            var idx = i - start + 1;
            console.print(format("%2d) %s\r\n", idx, items[i]));
        }

        println("");
        println("N) Next page   P) Prev page   Q) Cancel");
        println("Enter number to select...");
        console.print("> ");

        var k = console.getkey(K_UPPER);
        if (k === "Q" || k === ESC) {
            println("");
            return -1;
        }
        if (k === "N") {
            if ((page + 1) * pageSize < total) page++;
            continue;
        }
        if (k === "P") {
            if (page > 0) page--;
            continue;
        }
        if (k === "\r" || k === "\n") continue;

        if (k >= "0" && k <= "9") {
            console.print(k);
            var rest = console.getstr("", 3, K_NUMBER | K_LINE);
            var num = parseInt(k + (rest || ""), 10);
            println("");

            var sel = start + (num - 1);
            if (!isNaN(num) && num >= 1 && sel < end) return sel;
        }
    }
}

// --- ANSI/text body handling ----------------------------------------------
// Raw view: the file exactly as it sits on disk. Art stored without row
// terminators shears here, which is expected -- it is not what gets posted.
function previewFileRaw(path) {
    console.clear();
    var ok = console.printfile(path, P_SAVEATR);
    if (!ok) {
        println("");
        println("Failed to display file (maybe binary or missing).");
    }

    println("");
    println("Press any key to return...");
    console.getkey();
}

// Posted view: byte-for-byte what save_msg() will store.
function previewFileAsPosted(path, opts) {
    console.clear();

    var ad;
    try {
        ad = readAdBody(path, opts);
    } catch (e) {
        println("Failed to render: " + e);
        console.getkey();
        return;
    }

    console.print(ad.body);
    println("");
    println(describeBodyReport(ad.report));
    if (ad.report.overWide) {
        println("WARNING: " + ad.report.overWide + " row(s) exceed " + ad.report.limit +
            " columns and will wrap in the reader.");
    }
    println("Press any key to return...");
    console.getkey();
}

function previewFile(path, opts) {
    console.clear();
    hr();
    center("Preview: " + basename(path));
    hr();
    println("");
    println("P) As posted to the message base (recommended)");
    println("R) Raw file, as stored on disk");
    println("Q) Back");
    console.print("> ");

    var k = console.getkey(K_UPPER);
    println("");

    if (k === "P" || k === "\r" || k === "\n") previewFileAsPosted(path, opts);
    else if (k === "R") previewFileRaw(path);
}

// SAUCE is a 128-byte trailer, optionally preceded by a COMNT block. For
// character art (DataType 1) TInfo1 holds the canvas width the artist drew at,
// which is the only reliable way to re-wrap art saved without row terminators.
function parseSauce(text) {
    var out = { body: text, width: 0, rows: 0 };
    if (!text || text.length < 128) return out;

    var tailLen = Math.min(512, text.length);
    var marker = text.slice(-tailLen).lastIndexOf("SAUCE00");
    if (marker === -1) return out;

    var start = text.length - tailLen + marker;
    if (text.length - start < 128) return out;

    var dataType = text.charCodeAt(start + 94);
    var fileType = text.charCodeAt(start + 95);
    if (dataType === 1 && (fileType === 0 || fileType === 1)) {  // ASCII or ANSi
        out.width = text.charCodeAt(start + 96) | (text.charCodeAt(start + 97) << 8);
        out.rows = text.charCodeAt(start + 98) | (text.charCodeAt(start + 99) << 8);
    }

    var cutIdx = start;
    var commentCount = text.charCodeAt(start + 104);
    if (!isNaN(commentCount) && commentCount > 0) {
        var commentStart = cutIdx - (5 + (commentCount * 64));
        if (commentStart >= 0 && text.substr(commentStart, 5) === "COMNT") {
            cutIdx = commentStart;
        }
    }
    if (cutIdx > 0 && text.charCodeAt(cutIdx - 1) === 0x1A) cutIdx--;

    out.body = text.substring(0, cutIdx);
    return out;
}

// Returns the whole escape sequence beginning at index i.
function matchEscapeSeq(text, i) {
    if (text.charAt(i) !== ESC) return "";
    if (text.charAt(i + 1) !== "[") {
        return (i + 1 < text.length) ? text.substr(i, 2) : ESC;
    }

    for (var j = i + 2; j < text.length; j++) {
        var c = text.charCodeAt(j);
        if (c >= 0x40 && c <= 0x7E) return text.substring(i, j + 1);  // final byte
    }

    return text.substring(i);  // unterminated
}

// Track background only: a trailing space is art if it is painted, blank if not.
function applySgrBackground(seq, bg) {
    var params = seq.substring(2, seq.length - 1).split(";");
    for (var i = 0; i < params.length; i++) {
        var n = parseInt(params[i], 10);
        if (isNaN(n)) n = 0;
        if (n === 0) bg = 0;
        else if (n >= 40 && n <= 47) bg = n - 40;
        else if (n >= 100 && n <= 107) bg = n - 100;
        else if (n === 49) bg = 0;
    }
    return bg;
}

// Replay the art through a minimal terminal to recover its row grid. Much art
// is stored with no row terminators at all, relying on the terminal to wrap at
// the canvas width, so counting columns is the only way to find the rows.
function renderAnsiRows(text, width, report) {
    var rows = [];
    var row = [];          // tokens: ["sgr", seq] | ["chr", char, bg]
    var col = 0;
    var bg = 0;
    var pendingWrap = false;
    var i = 0;

    function endRow() {
        rows.push(row);
        row = [];
        col = 0;
        pendingWrap = false;
    }

    function putChar(ch) {
        if (pendingWrap) endRow();
        row.push(["chr", ch, bg]);
        col++;
        // Deferred wrap, as a real terminal does it: the cursor sits on the last
        // column until something else is printed, so an explicit CRLF right
        // after a full row costs no extra line.
        if (col >= width) pendingWrap = true;
    }

    while (i < text.length) {
        var code = text.charCodeAt(i);
        var ch = text.charAt(i);

        if (code === 0x1A) break;               // DOS EOF marker

        // Art editors emit NUL as a blank cell, and it is by far the most common
        // byte in a typical .ans. It cannot go into a message body (NUL
        // terminates the text), and neither can Ctrl-A (Synchronet reads it as
        // an attribute code and eats the byte after it). Substitute a blank so
        // the cell -- and therefore every column to its right -- survives.
        if (code === 0x00 || code === 0x01) {
            putChar(" ");
            i++;
            continue;
        }

        if (ch === ESC) {
            var seq = matchEscapeSeq(text, i);
            var fin = seq.charAt(seq.length - 1);
            i += seq.length;

            if (seq.charAt(1) !== "[") {
                report.dropped++;
            } else if (fin === "m") {
                bg = applySgrBackground(seq, bg);
                row.push(["sgr", seq]);
            } else if (fin === "C") {
                // Cursor-forward is just a run of blanks in a hard-wrapped body.
                var n = parseInt(seq.substring(2, seq.length - 1), 10);
                if (isNaN(n) || n < 1) n = 1;
                while (n-- > 0) putChar(" ");
            } else if (fin === "K" || fin === "s" || fin === "u" || fin === "h" || fin === "l") {
                // Erase-to-EOL / save / restore / mode: no effect once rows are hard-wrapped.
            } else {
                report.dropped++;               // absolute positioning cannot survive re-wrapping
            }
            continue;
        }

        if (code === 0x0D) {                    // CR, or the CR of a CRLF
            if (text.charCodeAt(i + 1) === 0x0A) i++;
            endRow();
            i++;
            continue;
        }
        if (code === 0x0A) {
            endRow();
            i++;
            continue;
        }
        if (code === 0x09) {                    // tab -> next 8-column stop
            var stop = 8 - (col % 8);
            while (stop-- > 0) putChar(" ");
            i++;
            continue;
        }
        if (code === 0x08) {                    // backspace: unrepresentable
            report.dropped++;
            i++;
            continue;
        }

        putChar(ch);
        i++;
    }

    if (row.length) rows.push(row);
    return rows;
}

// Drop trailing blanks, but keep painted ones, and keep any colour changes that
// sat in the trimmed tail so the next row still starts in the right attribute.
function rowToLine(row) {
    var end = row.length;
    while (end > 0) {
        var t = row[end - 1];
        if (t[0] === "sgr") { end--; continue; }
        if (t[1] === " " && t[2] === 0) { end--; continue; }
        break;
    }

    var text = "";
    var width = 0;
    for (var i = 0; i < end; i++) {
        text += row[i][1];
        if (row[i][0] === "chr") width++;
    }
    for (var j = end; j < row.length; j++) {
        if (row[j][0] === "sgr") text += row[j][1];
    }

    return { text: text, width: width };
}

function buildAdBody(raw, opts) {
    opts = opts || {};

    var sauce = parseSauce(raw);
    var report = {
        dropped: 0,      // escape sequences that cannot survive re-wrapping
        rows: 0,
        maxWidth: 0,
        overWide: 0,
        sauceWidth: sauce.width
    };

    var renderWidth = parseInt(opts.renderWidth, 10);
    if (isNaN(renderWidth) || renderWidth < 8) renderWidth = sauce.width || DEFAULT_RENDER_WIDTH;
    report.renderWidth = renderWidth;

    var maxWidth = parseInt(opts.maxWidth, 10);
    if (isNaN(maxWidth) || maxWidth < 8) maxWidth = MAX_POST_WIDTH;
    report.limit = maxWidth;

    var rows = renderAnsiRows(sauce.body, renderWidth, report);

    var lines = [];
    for (var i = 0; i < rows.length; i++) {
        var line = rowToLine(rows[i]);
        if (line.width > report.maxWidth) report.maxWidth = line.width;
        if (line.width > maxWidth) report.overWide++;
        lines.push(line.text);
    }

    while (lines.length && !lines[lines.length - 1].length) lines.pop();
    report.rows = lines.length;

    // Reset first so the ad does not inherit the reader's colours, and last so
    // it does not leak its own into whatever the reader prints next.
    var body = lines.length ? (ESC + "[0m" + lines.join("\r\n") + ESC + "[0m\r\n") : "";
    return { body: body, report: report };
}

function describeBodyReport(report) {
    var s = "rows=" + report.rows + " width=" + report.maxWidth + "/" + report.limit +
        " canvas=" + report.renderWidth + (report.sauceWidth ? " (SAUCE)" : " (assumed)");
    if (report.overWide) s += " OVER-WIDE-ROWS=" + report.overWide;
    if (report.dropped) s += " dropped-seqs=" + report.dropped;
    return s;
}

function readAdBody(filePath, opts) {
    var f = new File(filePath);
    if (!f.open("rb")) {
        throw new Error("Error " + f.error + " opening file: " + filePath);
    }

    var raw = f.read(f.length) || "";
    f.close();

    return buildAdBody(raw, opts);
}

// --- Posting ---------------------------------------------------------------
function postToMsgBase(sub_code, body, hdrs) {
    var mb = new MsgBase(sub_code);
    if (!mb.open()) throw new Error("Open msgbase failed (" + sub_code + "): " + mb.last_error);
    try {
        if (!mb.save_msg(hdrs, body)) throw new Error("save_msg failed: " + mb.last_error);
    } finally {
        mb.close();
    }
}

function isValidSubCode(subCode) {
    var lc = String(subCode || "").toLowerCase();
    if (lc === "mail") return true;
    return (typeof msg_area !== "undefined" && msg_area && msg_area.sub && !!msg_area.sub[lc]);
}

function getFileCategory(filePath, cfg) {
    var key = normalizeFileKey(filePath);
    if (cfg.categoryByFile[key]) return String(cfg.categoryByFile[key]);
    return String(cfg.defaults.category || "bbs_ad");
}

function getEffectiveSubject(filePath, cfg, opts) {
    var key = normalizeFileKey(filePath);

    if (opts && opts.fileSubjects && opts.fileSubjects[key]) return String(opts.fileSubjects[key]);
    if (opts && opts.subject) return String(opts.subject);
    if (cfg.subjectByFile[key]) return String(cfg.subjectByFile[key]);
    if (cfg.defaults.subject) return String(cfg.defaults.subject);

    return "Advertisement: " + basename(filePath);
}

function buildHeaders(filePath, cfg, opts) {
    var headers = {
        to: (opts.to || cfg.defaults.to || "All"),
        from: (opts.from || cfg.defaults.from || (system ? system.operator : "Sysop")),
        subject: getEffectiveSubject(filePath, cfg, opts)
    };

    var fixed = (typeof opts.fixed === "boolean") ? opts.fixed : cfg.defaults.fixed;
    if (fixed) headers.auxattr = (headers.auxattr || 0) | MSG_FIXED_FORMAT;

    if (opts.dateNum) {
        headers.when_written_time = system.datestr(opts.dateNum);
        headers.when_written_zone = system.timezone;
    } else if (opts.dateStr) {
        headers.when_written_time = new Date(opts.dateStr).valueOf() / 1000;
        headers.when_written_zone = system.timezone;
    }

    return headers;
}

function resolveTargetSubCodes(cfg, opts) {
    var out = [];

    if (opts.subCodes.length) {
        opts.subCodes.forEach(function (s) {
            addUnique(out, s);
        });
        return out;
    }

    if (opts.locationKeys.length) {
        var locationMap = {};
        Object.keys(cfg.locations).forEach(function (k) {
            locationMap[k.toLowerCase()] = cfg.locations[k];
        });

        opts.locationKeys.forEach(function (lk) {
            var sub = locationMap[String(lk).toLowerCase()];
            if (!sub) throw new Error("Unknown location key: " + lk);
            addUnique(out, sub);
        });

        return out;
    }

    Object.keys(cfg.locations).forEach(function (k) {
        addUnique(out, cfg.locations[k]);
    });

    return out;
}

// --- CLI -------------------------------------------------------------------
function parseFileTopicValue(value) {
    var s = String(value || "");
    var eq = s.indexOf("=");
    if (eq <= 0) throw new Error("--file-topic expects FILE=TOPIC");

    return {
        fileKey: normalizeFileKey(s.substring(0, eq)),
        topic: s.substring(eq + 1).trim()
    };
}

function parseCliArgs(rawArgs) {
    var args = rawArgs || [];
    var opts = {
        hasArgs: (args.length > 0),
        help: false,
        iniPath: "",
        adsDir: "",
        mode: "auto",       // auto | random | explicit
        locationKeys: [],     // INI [locations] keys
        subCodes: [],         // explicit sub internal codes
        fileArg: "",         // explicit ad file
        category: "",        // category filter (for random)
        subject: "",         // global subject override
        fileSubjects: {},     // per-file subject override
        to: "",
        from: "",
        fixed: undefined,
        dateNum: "",
        dateStr: "",
        sameAd: false,
        dryRun: false,
        preview: false,
        maxWidth: "",        // hard-wrap limit for the posted body
        renderWidth: "",     // canvas width override (else SAUCE, else 80)
        quiet: false
    };

    function needValue(i, flag) {
        if (i + 1 >= args.length) throw new Error("Missing value for " + flag);
        return args[i + 1];
    }

    for (var i = 0; i < args.length; i++) {
        var a = String(args[i]);

        if (a === "--help" || a === "-h") {
            opts.help = true;
        } else if (a === "--ini" || a === "--config") {
            opts.iniPath = needValue(i, a); i++;
        } else if (a === "--ads-dir") {
            opts.adsDir = needValue(i, a); i++;
        } else if (a === "--mode") {
            opts.mode = String(needValue(i, a)).toLowerCase(); i++;
        } else if (a === "--random") {
            opts.mode = "random";
        } else if (a === "--explicit") {
            opts.mode = "explicit";
        } else if (a === "--location" || a === "--loc") {
            parseListArgInto(opts.locationKeys, needValue(i, a)); i++;
        } else if (a === "--sub") {
            parseListArgInto(opts.subCodes, needValue(i, a)); i++;
        } else if (a === "--file" || a === "-f") {
            opts.fileArg = needValue(i, a); i++;
        } else if (a === "--category") {
            opts.category = needValue(i, a); i++;
        } else if (a === "--subject") {
            opts.subject = needValue(i, a); i++;
        } else if (a === "--file-topic") {
            var pair = parseFileTopicValue(needValue(i, a));
            opts.fileSubjects[pair.fileKey] = pair.topic;
            i++;
        } else if (a === "--to") {
            opts.to = needValue(i, a); i++;
        } else if (a === "--from") {
            opts.from = needValue(i, a); i++;
        } else if (a === "--fixed") {
            opts.fixed = parseBool(needValue(i, a), true); i++;
        } else if (a === "--date-num" || a === "-D") {
            opts.dateNum = needValue(i, a); i++;
        } else if (a === "--date-str" || a === "-T") {
            opts.dateStr = needValue(i, a); i++;
        } else if (a === "--same-ad") {
            opts.sameAd = true;
        } else if (a === "--dry-run") {
            opts.dryRun = true;
        } else if (a === "--preview") {
            opts.preview = true;
        } else if (a === "--width") {
            opts.maxWidth = needValue(i, a); i++;
        } else if (a === "--render-width" || a === "--canvas-width") {
            opts.renderWidth = needValue(i, a); i++;
        } else if (a === "--quiet") {
            opts.quiet = true;
        } else if (a.charAt(0) === "-") {
            throw new Error("Unknown option: " + a);
        } else {
            // Positional fallback: first positional arg = explicit file.
            if (!opts.fileArg) opts.fileArg = a;
            else throw new Error("Unexpected positional argument: " + a);
        }
    }

    return opts;
}

function printUsage() {
    println("Ad Poster v" + VERSION);
    println("");
    println("Usage:");
    println("  jsexec ../xtrn/ad_poster/ad_poster.js [options]");
    println("");
    println("Modes:");
    println("  (no args, non-interactive): random ad per configured location");
    println("  --mode random|explicit    explicit mode requires --file");
    println("  --random                  alias for --mode random");
    println("  --explicit                alias for --mode explicit");
    println("");
    println("Targeting:");
    println("  --location key[,key...]   keys from [locations]");
    println("  --sub CODE[,CODE...]      sub internal code(s), bypasses location keys");
    println("");
    println("Ad selection:");
    println("  --file FILE               explicit ad file (name or path)");
    println("  --category NAME           category filter for random mode");
    println("  --same-ad                 use one random file for all target subs");
    println("");
    println("Headers/overrides:");
    println("  --subject TEXT            global subject override");
    println("  --file-topic FILE=TEXT    per-file subject override (repeatable)");
    println("  --to NAME                 To field");
    println("  --from NAME               From field");
    println("  --fixed yes|no            fixed-format flag");
    println("  --date-num VALUE          numeric date override (-D style)");
    println("  --date-str VALUE          date/time string override (-T style)");
    println("");
    println("Layout:");
    println("  --width N                 hard-wrap limit for the body (default " + MAX_POST_WIDTH + ")");
    println("  --render-width N          canvas width of the art (default: SAUCE, else " + DEFAULT_RENDER_WIDTH + ")");
    println("");
    println("Misc:");
    println("  --ini PATH                INI path (default: adposter.ini / ad_poster.ini)");
    println("  --ads-dir PATH            override ads_dir from INI");
    println("  --dry-run                 show what would be posted, do not post");
    println("  --preview                 render the ad to stdout, do not post");
    println("  --quiet                   quieter logging");
    println("  --help                    this help");
    println("");
    println("Preview an ad exactly as it will appear in the message base:");
    println("  jsexec ../xtrn/ad_poster/ad_poster.js --preview -f future_beach.ans");
}

function emitRaw(s) {
    if (hasConsoleOutput()) console.print(s);
    else if (typeof write === "function") write(s);
    else if (typeof print === "function") print(s);
}

// Render ads to stdout instead of posting, so layout can be checked before it
// lands in a message base (and, for netmail, in front of other people's users).
function runPreview(opts) {
    var runtimeCfg = loadRuntimeConfig(opts.iniPath);
    var cfg = runtimeCfg.cfg;
    if (opts.adsDir) cfg.adsDir = ensureTrailingSlash(opts.adsDir);

    var adFiles = listAdFiles(cfg.adsDir);
    if (!adFiles.length) throw new Error("No ad files found in " + cfg.adsDir);

    var targets = [];
    if (opts.fileArg) {
        var one = resolveExplicitFile(opts.fileArg, cfg.adsDir, adFiles);
        if (!one) throw new Error("Unable to resolve ad file: " + opts.fileArg);
        targets.push(one);
    } else if (opts.category) {
        targets = adFiles.filter(function (p) {
            return String(getFileCategory(p, cfg)).toLowerCase() === String(opts.category).toLowerCase();
        });
        if (!targets.length) throw new Error("No ads in category '" + opts.category + "'");
    } else {
        targets = adFiles;
    }

    var worst = 0;
    targets.forEach(function (adPath) {
        var ad = readAdBody(adPath, opts);
        worst += ad.report.overWide;

        println("");
        println("=== " + basename(adPath) + " [" + describeBodyReport(ad.report) + "] ===");
        emitRaw(ad.body);
        if (ad.report.overWide) {
            println("WARNING: " + ad.report.overWide + " row(s) exceed " + ad.report.limit +
                " columns and will wrap in an 80-column reader.");
        }
    });

    println("");
    println("Previewed " + targets.length + " ad(s); over-wide rows: " + worst);
    return { attempted: targets.length, posted: targets.length, failed: 0 };
}

function runBatch(opts) {
    var runtimeCfg = loadRuntimeConfig(opts.iniPath);
    var cfg = runtimeCfg.cfg;

    if (opts.adsDir) cfg.adsDir = ensureTrailingSlash(opts.adsDir);

    var adFiles = listAdFiles(cfg.adsDir);
    if (!adFiles.length) throw new Error("No ad files found in " + cfg.adsDir);

    var mode = opts.mode || "auto";
    if (mode === "auto") mode = opts.fileArg ? "explicit" : "random";
    if (mode !== "random" && mode !== "explicit") {
        throw new Error("Invalid mode: " + mode + " (expected random|explicit)");
    }

    var targetSubs = resolveTargetSubCodes(cfg, opts);
    if (!targetSubs.length) {
        throw new Error("No target message bases. Configure [locations] or pass --sub/--location.");
    }

    var explicitFile = "";
    if (mode === "explicit") {
        if (!opts.fileArg) throw new Error("Explicit mode requires --file FILE");
        explicitFile = resolveExplicitFile(opts.fileArg, cfg.adsDir, adFiles);
        if (!explicitFile) throw new Error("Unable to resolve ad file: " + opts.fileArg);
    }

    var category = String(opts.category || cfg.defaults.category || "bbs_ad");
    var randomPool = [];
    if (mode === "random") {
        randomPool = adFiles.filter(function (p) {
            return String(getFileCategory(p, cfg)).toLowerCase() === category.toLowerCase();
        });
        if (!randomPool.length) {
            throw new Error("No ads found in category '" + category + "' under " + cfg.adsDir);
        }
    }

    var sharedRandom = "";
    if (mode === "random" && opts.sameAd) {
        sharedRandom = pickRandom(randomPool);
    }

    var stats = {
        attempted: 0,
        posted: 0,
        failed: 0
    };

    targetSubs.forEach(function (subCode) {
        stats.attempted++;

        if (!isValidSubCode(subCode)) {
            stats.failed++;
            if (!opts.quiet) println("ERROR: Invalid sub-code: " + subCode);
            return;
        }

        var adPath = explicitFile;
        if (mode === "random") {
            adPath = opts.sameAd ? sharedRandom : pickRandom(randomPool);
        }

        if (!adPath) {
            stats.failed++;
            if (!opts.quiet) println("ERROR: Could not choose ad file for sub: " + subCode);
            return;
        }

        var hdrs = buildHeaders(adPath, cfg, opts);

        if (opts.dryRun) {
            if (!opts.quiet) {
                println("DRY-RUN: " + subCode + " <= " + basename(adPath) +
                    " [category=" + getFileCategory(adPath, cfg) +
                    ", subject=\"" + hdrs.subject + "\"] " +
                    describeBodyReport(readAdBody(adPath, opts).report));
            }
            stats.posted++;
            return;
        }

        try {
            var ad = readAdBody(adPath, opts);
            postToMsgBase(subCode, ad.body, hdrs);
            stats.posted++;
            if (!opts.quiet) {
                println("Posted: " + subCode + " <= " + basename(adPath) +
                    " [category=" + getFileCategory(adPath, cfg) + "] " +
                    describeBodyReport(ad.report));
            }
        } catch (e) {
            stats.failed++;
            if (!opts.quiet) println("ERROR posting to " + subCode + ": " + e);
        }
    });

    if (!opts.quiet) {
        println("Summary: attempted=" + stats.attempted + " posted=" + stats.posted + " failed=" + stats.failed);
    }

    return stats;
}

// --- UI mode ---------------------------------------------------------------
function runUI(cliIniPath) {
    if (!isInteractiveSession()) {
        throw new Error("UI mode requires an online user session.");
    }

    // enable MORE pausing but don't force pause-off
    bbs.sys_status |= SS_MOFF;
    bbs.sys_status &= ~SS_PAUSEOFF;

    var runtimeCfg = loadRuntimeConfig(cliIniPath || "");
    var cfg = runtimeCfg.cfg;

    var adsDir = cfg.adsDir;
    var locKeys = Object.keys(cfg.locations);
    var locLabels = locKeys.map(function (k) { return k + "  ->  " + cfg.locations[k]; });

    var state = {
        locKey: locKeys[0] || "",
        subCode: (locKeys[0] ? cfg.locations[locKeys[0]] : ""),
        filePath: "",
        toName: cfg.defaults.to || "All",
        fromName: cfg.defaults.from || (system ? system.operator : "Sysop"),
        subject: cfg.defaults.subject || "Advertisement",
        fixed: !!cfg.defaults.fixed,
        dateNum: "",
        dateStr: ""
    };

    while (true) {
        console.clear();
        hr();
        center("Ad Poster v" + VERSION);
        hr();
        println("1) Choose location");
        println("2) Choose ad file");
        println("3) Preview selected file");
        println("4) Compose headers");
        println("5) Post");
        println("Q) Quit");
        hr();

        println("");
        println("Current selection:");
        println("  Location : " + (state.locKey ? (state.locKey + " -> " + state.subCode) : "(none)"));
        println("  Ad file  : " + (state.filePath ? state.filePath : "(none)"));
        println("  To/From  : " + state.toName + "  /  " + state.fromName);
        println("  Subject  : " + state.subject + (state.fixed ? "  [Fixed-Format]" : ""));
        if (state.dateNum) println("  Date(-D) : " + state.dateNum);
        if (state.dateStr) println("  Date(-T) : " + state.dateStr);
        hr();

        console.print("> ");
        var c = console.getkey(K_UPPER);
        println("");

        if (c === "Q" || c === ESC) break;

        if (c === "1") {
            if (locKeys.length === 0) {
                println("No locations in [locations].");
                console.getkey();
                continue;
            }
            var idx = menuSelect("Select Location", locLabels, 20);
            if (idx >= 0) {
                state.locKey = locKeys[idx];
                state.subCode = cfg.locations[state.locKey];
            }
        }
        else if (c === "2") {
            var files = listAdFiles(adsDir).map(basename);
            if (!files.length) {
                println("No files in " + adsDir);
                console.getkey();
                continue;
            }

            var sel = menuSelect("Select Ad File (" + adsDir + ")", files, 20);
            if (sel >= 0) {
                state.filePath = ensureTrailingSlash(adsDir) + files[sel];
                var key = normalizeFileKey(state.filePath);
                if (cfg.subjectByFile[key]) {
                    state.subject = cfg.subjectByFile[key];
                }
            }
        }
        else if (c === "3") {
            if (!state.filePath) {
                println("No file selected.");
                console.getkey();
                continue;
            }
            previewFile(state.filePath, state);
        }
        else if (c === "4") {
            state.toName = promptStr("To", state.toName, 64);
            state.fromName = promptStr("From", state.fromName, 64);
            state.subject = promptStr("Subject", state.subject, 72);
            state.fixed = yesNo("Fixed-format (preserve ANSI spacing)?", state.fixed);

            if (yesNo("Override message date/time?", (state.dateNum || state.dateStr) ? true : false)) {
                state.dateNum = promptStr("Numeric date (-D) (blank to skip)", state.dateNum, 32);
                state.dateStr = promptStr("Date/time string (-T) (blank to skip)", state.dateStr, 64);
            } else {
                state.dateNum = "";
                state.dateStr = "";
            }
        }
        else if (c === "5") {
            if (!state.subCode) {
                println("Select a location first.");
                console.getkey();
                continue;
            }
            if (!isValidSubCode(state.subCode)) {
                println("Invalid sub-code: " + state.subCode);
                console.getkey();
                continue;
            }
            if (!state.filePath) {
                println("Select a file first.");
                console.getkey();
                continue;
            }

            try {
                var ad = readAdBody(state.filePath, state);
                var hdrs = buildHeaders(state.filePath, cfg, {
                    to: state.toName,
                    from: state.fromName,
                    subject: state.subject,
                    fixed: state.fixed,
                    dateNum: state.dateNum,
                    dateStr: state.dateStr,
                    fileSubjects: {}
                });

                postToMsgBase(state.subCode, ad.body, hdrs);
                println("");
                println("Posted successfully to: " + state.subCode);
                println(describeBodyReport(ad.report));
            } catch (e) {
                println("");
                println("ERROR posting: " + e);
            }

            println("Press any key...");
            console.getkey();
        }
    }

    println("");
    println("Returning to the BBS...");
}

// --- Entrypoint ------------------------------------------------------------
function runMain() {
    var args = (typeof argv !== "undefined" && argv) ? argv : [];
    var opts = parseCliArgs(args);

    if (opts.help) {
        printUsage();
        return;
    }

    if (opts.preview) {
        runPreview(opts);
        return;
    }

    var useCli = (!isInteractiveSession() || opts.hasArgs);

    if (useCli) {
        var stats = runBatch(opts);
        if (stats.failed > 0) {
            throw new Error("Completed with failures: " + stats.failed + " of " + stats.attempted);
        }
        return;
    }

    runUI(opts.iniPath);
}

try {
    runMain();
} catch (e) {
    println("");
    println("ad_poster.js failed:");
    println(String(e));
    pauseIfInteractive();
    throw e;
}
