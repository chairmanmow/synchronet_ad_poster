// adposter_ui.js — Interactive xtrn for posting ANSI/text ads to msg bases
// SCFG Command Line: ?jsexec adposter_ui.js
// Start-up Dir: /sbbs/xtrn/adposter
// I/O: Native console (not STDIO), Multi-user: Yes
// --- Load Synchronet defs (safe once globally)
load("sbbsdefs.js");

var VERSION = "1.1.2";
var P_SAVEATR = 0x80;  // keep current attributes when printing files
var ESC = "\x1b";              // escape key


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
// ---------- Small helpers ----------
function println(s) { console.print((s || "") + "\r\n"); }
function hr(ch, w) { w = w || console.columns; console.print((ch || "─").repeat(w) + "\r\n"); }
function center(s) { var pad = Math.max(0, ((console.columns | 0) - s.length) >> 1); println(" ".repeat(pad) + s); }

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

function basename(p) {
    var i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    return i >= 0 ? p.substr(i + 1) : p;
}

// ---------- INI loader ----------
function loadIni(path) {
    var f = new File(path);
    if (!f.open("r")) return null;
    var txt = f.readAll().join("\n");
    f.close();
    var ini = {};
    var section = null;
    txt.split(/\r?\n/).forEach(function (line) {
        var s = line.trim();
        if (!s || s[0] === ';' || s[0] === '#') return;
        var m;
        if ((m = s.match(/^\[(.+?)\]$/))) { section = m[1]; ini[section] = ini[section] || {}; return; }
        var kv = s.match(/^([^=]+)=(.*)$/);
        if (kv && section) ini[section][kv[1].trim()] = kv[2].trim();
    });
    return ini;
}

// ---------- File listing / picker ----------
function listAdFiles(dir) {
    var d = directory(dir.replace(/[\\\/]$/, "") + "/*");
    var files = d.filter(function (p) {
        var n = p.toLowerCase();
        return n.endsWith(".ans") || n.endsWith(".txt") || n.endsWith(".asc") || n.endsWith(".msg");
    });
    return files.length ? files : d;
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
            var name = items[i];
            console.print(format("%2d) %s\r\n", idx, name));
        }
        println("");
        println("N) Next page   P) Prev page   Q) Cancel");
        println("Enter number to select…");
        console.print("> ");

        var k = console.getkey(K_UPPER);
        if (k === "Q" || k === ESC) { println(""); return -1; }
        if (k === "N") { if ((page + 1) * pageSize < total) page++; continue; }
        if (k === "P") { if (page > 0) page--; continue; }
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

// ---------- ANSI/Text preview ----------
function previewFile(path) {
    console.clear();
    hr();
    center("Preview: " + basename(path));
    hr();
    var ok = console.printfile(path, P_SAVEATR); // honors bbs.more
    if (!ok) {
        println("");
        println("Failed to display file (maybe binary or missing).");
    }
    println("");
    println("Press any key to return…");
    console.getkey();
}

function stripSauceData(text) {
    if (!text || text.length < 128) return text;
    var tailLen = Math.min(512, text.length);
    var tail = text.slice(-tailLen);
    var marker = tail.lastIndexOf("SAUCE00");
    if (marker === -1) return text;
    var sauceStart = text.length - tailLen + marker;
    if (text.length - sauceStart < 128) return text;
    var cutIdx = sauceStart;
    var commentCount = text.charCodeAt(sauceStart + 104);
    if (!isNaN(commentCount) && commentCount > 0) {
        var commentBytes = 5 + (commentCount * 64);
        var commentStart = cutIdx - commentBytes;
        if (commentStart >= 0 && text.substr(commentStart, 5) === "COMNT") {
            cutIdx = commentStart;
        }
    }
    if (cutIdx > 0 && text.charCodeAt(cutIdx - 1) === 0x1A) cutIdx--;
    return text.substring(0, cutIdx);
}

// ---------- Posting ----------
function postToMsgBase(sub_code, body, hdrs) {
    var mb = new MsgBase(sub_code);
    if (!mb.open()) throw new Error("Open msgbase failed (" + sub_code + "): " + mb.last_error);
    try {
        if (!mb.save_msg(hdrs, body)) throw new Error("save_msg failed: " + mb.last_error);
    } finally {
        mb.close();
    }
}

// ---------- Main UI flow ----------
function runUI() {
    if (!bbs || !console) throw new Error("Not running under a user session (bbs/console unavailable).");

    // enable MORE pausing but don't force pause-off
    bbs.sys_status |= SS_MOFF;
    bbs.sys_status &= ~SS_PAUSEOFF;

    var iniPath = js.exec_dir + "adposter.ini";
    var ini = loadIni(iniPath);
    if (!ini) {
        println("\r\nadposter: Missing INI: " + iniPath);
        println("Create adposter.ini with [paths], [defaults], [locations]");
        console.print("\r\nPress any key…"); console.getkey();
        return;
    }

    var adsDir = (ini.paths && ini.paths.ads_dir) || "/sbbs/text/bbs_ads";
    if (adsDir[adsDir.length - 1] !== "/") adsDir += "/";
    var defaults = ini.defaults || {};
    var locations = ini.locations || {};
    var locKeys = Object.keys(locations);
    var locLabels = locKeys.map(function (k) { return k + "  →  " + locations[k]; });

    // session state
    var state = {
        locKey: locKeys[0] || "",
        subCode: (locKeys[0] ? locations[locKeys[0]] : ""),
        filePath: "",
        toName: defaults.to || "All",
        fromName: defaults.from || (system ? system.operator : "Sysop"),
        subject: defaults.subject || "Advertisement",
        fixed: (String(defaults.fixed || "").toLowerCase() === "yes" || String(defaults.fixed || "").toLowerCase() === "true"),
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
        println("  Location : " + (state.locKey ? (state.locKey + " → " + state.subCode) : "(none)"));
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
            if (locKeys.length === 0) { println("No locations in [locations]."); console.getkey(); continue; }
            var idx = menuSelect("Select Location", locLabels, 20);
            if (idx >= 0) { state.locKey = locKeys[idx]; state.subCode = locations[state.locKey]; }
        }
        else if (c === "2") {
            var files = listAdFiles(adsDir).map(basename);
            if (!files || !files.length) { println("No files in " + adsDir); console.getkey(); continue; }
            var sel = menuSelect("Select Ad File (" + adsDir + ")", files, 20);
            if (sel >= 0) state.filePath = adsDir.replace(/[\\\/]$/, "/") + files[sel];
        }
        else if (c === "3") {
            if (!state.filePath) { println("No file selected."); console.getkey(); continue; }
            previewFile(state.filePath);
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
                state.dateNum = ""; state.dateStr = "";
            }
        }
        else if (c === "5") {
            if (!state.subCode) { println("Select a location first."); console.getkey(); continue; }
            if (!msg_area.sub[state.subCode.toLowerCase()] && state.subCode.toLowerCase() !== "mail") {
                println("Invalid sub-code in INI: " + state.subCode); console.getkey(); continue;
            }
            if (!state.filePath) { println("Select a file first."); console.getkey(); continue; }

            var f = new File(state.filePath);
            if (!f.open("rb")) { println("Error " + f.error + " opening file."); console.getkey(); continue; }
            var raw = f.read(f.length) || "";
            var body = stripSauceData(raw).replace(/\r?\n/g, "\r\n");
            f.close();

            var hdrs = {
                to: state.toName || "All",
                from: state.fromName || (system ? system.operator : "Sysop"),
                subject: state.subject || ("Advertisement: " + basename(state.filePath))
            };
            if (state.fixed) hdrs.auxattr = (hdrs.auxattr || 0) | MSG_FIXED_FORMAT;

            if (state.dateNum) {
                hdrs.when_written_time = system.datestr(state.dateNum);
                hdrs.when_written_zone = system.timezone;
            } else if (state.dateStr) {
                hdrs.when_written_time = new Date(state.dateStr).valueOf() / 1000;
                hdrs.when_written_zone = system.timezone;
            }

            try {
                postToMsgBase(state.subCode, body, hdrs);
                println(""); println("Posted successfully to: " + state.subCode);
            } catch (e) {
                println(""); println("ERROR posting: " + e);
            }
            println("Press any key…"); console.getkey();
        }
    }

    println("\r\nReturning to the BBS…");
}

// --- Run with error trap so you can SEE failures on-screen
try {
    runUI();
} catch (e) {
    println("\r\nadposter_ui.js crashed:");
    println(String(e));
    println("\r\nPress any key…");
    console.getkey();
}
