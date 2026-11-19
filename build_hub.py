"""
build_hub.py — assemble Lizard Lips Hot Suite from the individual tool pages.

Each tool lives as its own standalone HTML page (tool_*.html) and is developed
and tested on its own. This script runs each through toolify.py to scope it into
a panel, then writes the single index.html that gets deployed.

    python3 build_hub.py

Add a tool by dropping its page in beside this file and adding one row to TOOLS.

The spec engine (spec parsing, media analysis, comparison) lives in
engine_spec.js. Edit it there only; the build copies it into every tool that
uses it, so the copies can't drift apart.
"""
import html
import json
from pathlib import Path

from toolify import toolify
from sync_engine import sync as sync_engine

ROOT = Path(__file__).parent
OUT = ROOT / "index.html"

# key, label, one-line description, group, source file, work in progress?, what it takes
TOOLS = [
    ("cutlogger",     "Cut Logger",        "premiere xml to an edit log",         "Tools",       "tool_cutlogger.html",     False, ".xml"),
    ("loudness",      "Loudness Analyser", "loudness and audio qc",               "Tools",       "tool_loudness.html",      False, "audio or video"),
    ("speccheck",     "Delivery QC",       "check a delivery against its spec",   "Tools",       "tool_speccheck.html",     False, "a spec, then the delivery"),
    ("subsync",       "Sub Sync",          "check subtitles against the script",  "In progress", "tool_subsync.html",       True,  ".srt and a script"),
    ("presetbuilder", "Preset Builder",    "premiere export preset from a spec",  "In progress", "tool_presetbuilder.html", True,  "a spec"),
]
GROUP_ORDER = ["Tools", "In progress"]

TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Lizard Lips Hot Suite</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
  :root {
    --bg:#060906; --surface:#0a0e0a; --border:#1b271b; --line:#2b3f2b;
    --text:#c8f2c0; --muted:#6b8f63; --phos:#8fff6a; --accent:#e8ff47; --accent2:#47c8ff;
    --pass:#8fff6a; --fail:#ff6b6b; --warn:#ffcf47;
    --mono:'IBM Plex Mono',ui-monospace,Menlo,Consolas,monospace; --sans:var(--mono);
    --glow:0 0 7px rgba(232,255,71,.4); --rail:272px;
  }
  html, body { height:100%; }
  body { background:var(--bg); color:var(--text); font-family:var(--mono); font-size:13px; display:flex; overflow:hidden; }
  ::selection { background:var(--accent); color:var(--bg); }
  * { scrollbar-width:thin; scrollbar-color:var(--line) transparent; }
  :focus-visible { outline:1px solid var(--accent); outline-offset:2px; }

  /* the tube: scanlines and a soft vignette over everything */
  body::before { content:''; position:fixed; inset:0; z-index:9998; pointer-events:none; mix-blend-mode:multiply;
    background:repeating-linear-gradient(to bottom, transparent 0 2px, rgba(0,0,0,.2) 3px 3px); }
  body::after { content:''; position:fixed; inset:0; z-index:9999; pointer-events:none;
    background:radial-gradient(ellipse at center, transparent 62%, rgba(0,0,0,.38) 100%); }
  @keyframes blink { 0%,50%{opacity:1} 50.01%,100%{opacity:0} }

  /* ── rail ── */
  #sidebar { width:var(--rail); flex:none; height:100vh; display:flex; flex-direction:column; overflow-y:auto;
    border-right:1px solid var(--line); background:var(--surface); z-index:2; }
  #brandhead { padding:18px 14px 14px; border-bottom:1px solid var(--line); cursor:pointer;
    display:flex; flex-direction:column; align-items:center; gap:7px; }
  #brandhead .suite-eyebrow { font-size:9px; letter-spacing:.42em; text-indent:.42em; color:var(--phos); }
  #brandhead .suite-mark { color:var(--accent); font-size:4.9px; line-height:1.02; text-shadow:var(--glow);
    font-family:Menlo,Consolas,'DejaVu Sans Mono',monospace; }
  #brandhead .mk-in { display:inline-block; text-align:left; }
  #brandhead .mk-r { display:block; white-space:pre; }
  #brandhead .mk-shift { transform:translateX(.46em); }
  #brandhead .lizard { color:var(--phos); font-size:6px; line-height:1.2; white-space:pre;
    text-shadow:0 0 5px rgba(143,255,106,.4); font-family:Menlo,Consolas,'DejaVu Sans Mono',monospace; }
  .nav-cat { padding:16px 16px 6px; font-size:11px; color:var(--muted); display:flex; align-items:center; gap:8px; }
  .nav-cat::after { content:''; flex:1; border-top:1px solid var(--border); }
  .nav-item { display:flex; gap:10px; align-items:baseline; width:100%; text-align:left; padding:7px 16px;
    background:none; border:0; border-left:2px solid transparent; color:var(--text); font:inherit; cursor:pointer; }
  .nav-key { color:var(--muted); width:1ch; flex:none; }
  .nav-body { display:flex; flex-direction:column; gap:1px; min-width:0; }
  .nav-label { font-weight:500; text-transform:lowercase; }
  .nav-tag { font-size:11px; color:var(--muted); line-height:1.35; }
  .nav-wip { font-size:10px; color:var(--warn); margin-left:8px; font-weight:400; }
  .nav-item:hover { background:rgba(143,255,106,.05); }
  .nav-item.active { background:rgba(232,255,71,.07); border-left-color:var(--accent); }
  .nav-item.active .nav-label, .nav-item.active .nav-key { color:var(--accent); }
  .sidebar-foot { margin-top:auto; padding:14px 16px; border-top:1px solid var(--border); font-size:11px; color:var(--muted); line-height:1.8; }
  .sidebar-foot kbd { font:inherit; color:var(--text); }

  /* ── stage ── */
  #stage { flex:1; height:100vh; position:relative; overflow:hidden; z-index:1; min-width:0; }
  #stage.dragging::after { content:'drop it'; position:absolute; inset:10px; z-index:50; pointer-events:none;
    border:1px dashed var(--accent); background:rgba(6,9,6,.82); color:var(--accent);
    display:flex; align-items:center; justify-content:center; font-size:15px; }
  .tool-host { position:absolute; inset:0; display:none; overflow-y:auto; background:var(--bg); }
  .tool-host.active { display:block; }
  #toast { position:absolute; left:28px; bottom:44px; z-index:40; padding:8px 12px; background:var(--bg);
    border:1px solid var(--warn); color:var(--warn); font-size:12px; display:none; max-width:70ch; }
  #toast.on { display:block; }

  /* ── home: a session you drop files into ── */
  #landing { position:absolute; inset:0; display:none; overflow-y:auto; padding:38px 34px; }
  #landing.active { display:block; }
  .term { max-width:92ch; line-height:1.75; }
  .term .dim { color:var(--muted); }
  .term .ps::before { content:'~/hot-suite $ '; color:var(--muted); }
  .term .ps { color:var(--accent); margin-top:18px; }
  .ls { margin:6px 0 0; display:grid; grid-template-columns:3ch 19ch minmax(20ch,1fr) auto; column-gap:2ch; }
  .ls button { display:contents; cursor:pointer; font:inherit; color:inherit; background:none; border:0; text-align:left; }
  .ls button > span { padding:3px 0; }
  .ls .k { color:var(--muted); text-align:right; } .ls .n { color:var(--text); font-weight:500; text-transform:lowercase; }
  .ls .d { color:var(--muted); } .ls .t { color:var(--muted); text-align:right; } .ls .t i { font-style:normal; color:var(--warn); }
  .ls button:hover > span, .ls button:focus-visible > span { background:rgba(232,255,71,.08); }
  .ls button:hover .n, .ls button:hover .k { color:var(--accent); }
  .cursor { display:inline-block; width:8px; height:15px; background:var(--phos); vertical-align:-2px; margin-left:4px;
    animation:blink 1.1s steps(1) infinite; }
  #ask { color:var(--text); }
  #ask button { font:inherit; background:none; border:1px solid var(--line); color:var(--accent); padding:2px 10px; margin:6px 8px 0 0; cursor:pointer; }
  #ask button:hover { border-color:var(--accent); background:rgba(232,255,71,.08); }
  #ask .bad { color:var(--warn); }
  /* one moment at load: the listing prints, once per session */
  .booting .term > * { opacity:0; animation:print .01s linear forwards; animation-delay:calc(var(--i,0) * 55ms); }
  .booting .ls button > span { opacity:0; animation:print .01s linear forwards; animation-delay:calc(220ms + var(--i,0) * 45ms); }
  @keyframes print { to { opacity:1; } }
  @media (prefers-reduced-motion: reduce) { .cursor, .booting .term > *, .booting .ls button > span { animation:none !important; opacity:1 !important; } }

  @media (max-width:760px) {
    body { flex-direction:column; overflow:auto; }
    #sidebar { width:100%; height:auto; border-right:0; border-bottom:1px solid var(--line); }
    #brandhead .lizard, .sidebar-foot { display:none; }
    #stage { height:auto; min-height:80vh; }
    .ls { grid-template-columns:3ch 1fr; } .ls .d, .ls .t { display:none; }
  }

  /* ─────────── each tool's own styles, scoped to its panel ─────────── */
__TOOL_CSS__

  /* ═══════════ THEME ═══════════
     Every tool is written as its own page, so left alone they drift apart.
     This loads after all of them and sets the shared furniture — frame, type,
     controls — in one terminal language. #stage in front outranks a tool's own
     #panel rules; !important only where a tool styles an element by id. */
  #stage .tool-panel { display:flex; flex-direction:column; min-height:100%; font-family:var(--mono); font-size:13px; color:var(--text); background:var(--bg); }
  #stage .tool-panel * { border-radius:0 !important; letter-spacing:0; }

  /* prompt line */
  #stage .tool-panel header { position:sticky; top:0; z-index:6; display:flex; align-items:baseline; justify-content:flex-start; gap:14px;
    padding:13px 28px; background:var(--bg); border-bottom:1px solid var(--line); }
  #stage .tool-panel .header-left { display:contents; }
  #stage .tool-panel header h1 { font:500 14px var(--mono); text-transform:lowercase; color:var(--accent); text-shadow:var(--glow); }
  #stage .tool-panel header h1::before { content:'~/hot-suite $ '; color:var(--muted); font-weight:400; text-shadow:none; }
  #stage .tool-panel header span { font:400 12px var(--mono); color:var(--muted); text-transform:none; }
  #stage .tool-panel header span::before { content:'# '; }

  /* working column: left-aligned, one width for every tool */
  #stage .tool-panel main { flex:1 0 auto; display:flex; flex-direction:column; align-items:stretch !important; justify-content:flex-start;
    gap:24px !important; padding:28px 28px 44px !important; max-width:1000px !important; width:100%; margin:0 !important; }
  #stage .tool-panel main > * { max-width:none !important; width:100% !important; }

  /* status line */
  #stage .tool-panel footer { position:sticky; bottom:0; z-index:6; display:flex !important; flex-direction:row; align-items:center; justify-content:space-between;
    gap:20px; padding:0 28px !important; height:30px; flex:none; background:#0c120c !important; border-top:1px solid var(--line) !important; font:400 11px var(--mono) !important; color:var(--muted); }
  #stage .tool-panel footer .footer-disclaimer, #stage .tool-panel footer .warn-txt { flex:1; padding:0 !important; background:none !important; border:0 !important;
    text-align:left !important; color:var(--warn) !important; opacity:1 !important; font-size:11px !important; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
  #stage .tool-panel footer .footer-meta { padding:0 !important; gap:18px; flex:none; display:flex; }
  #stage .tool-panel footer .footer-meta span { font-size:11px !important; }
  #stage .tool-panel footer .footer-meta span:last-child, #stage .tool-panel footer > span:last-child:not(:first-child) { display:none; }

  /* windows: a frame with its title set into the top edge */
  #stage .tool-panel .panel, #stage .tool-panel #settings-panel { position:relative; background:transparent !important; border:1px solid var(--line) !important;
    padding:24px 20px 18px !important; gap:14px; }
  #stage .tool-panel .panel > .panel-title, #stage .tool-panel .panel > .panel-label { position:absolute; top:-9px; left:12px; margin:0; padding:0 8px !important;
    background:var(--bg); border:0 !important; font:400 12px/16px var(--mono) !important; color:var(--phos) !important; text-transform:lowercase !important; white-space:nowrap; }
  #stage .tool-panel .panel-title .n, #stage .tool-panel .panel-title .num { color:var(--muted); }
  #stage .tool-panel .section-title { display:flex; align-items:center; gap:10px; margin-top:8px; padding:0 !important; border:0 !important;
    font:400 12px var(--mono) !important; color:var(--phos) !important; text-transform:lowercase !important; }
  #stage .tool-panel .section-title::after { content:''; flex:1; border-top:1px solid var(--line); }

  /* small labels and help text */
  #stage .tool-panel :is(.setting-label,.drop-label,.diff-lbl,.rule-hd,.res-hd,.fn-hd,.issues-hd,.chg-hd,.skip-hd,.stat-label,.stat-lbl,.metric-label,.info-label,.col-head,.pairs-hd,.step,th) {
    font-family:var(--mono) !important; font-size:11px !important; font-weight:400 !important; text-transform:lowercase !important; }
  #stage .tool-panel :is(.hint,.option-desc,.setting-hint,.dz-sub,.drop-sub,.drop-formats,.col-hint) { font:400 12px/1.6 var(--mono) !important; }
  #stage .tool-panel .dz .s { font:400 12px/1.6 var(--mono) !important; color:var(--muted); }
  #stage .tool-panel .option-label { font:500 13px var(--mono) !important; }

  /* drop zones: a prompt waiting for a file */
  #stage .tool-panel :is(#dropzone,.dz) { border:1px dashed var(--line) !important; background:transparent; padding:26px 22px !important; min-height:0 !important;
    text-align:left !important; align-items:flex-start !important; }
  #stage .tool-panel #dropzone::before, #stage .tool-panel .drop-icon { display:none !important; }
  #stage .tool-panel :is(#dropzone,.dz):is(:hover,.drag,.drag-over) { border-color:var(--accent) !important; background:rgba(232,255,71,.04) !important; }
  #stage .tool-panel :is(#dropzone.has-file,.dz.loaded) { border:1px solid var(--phos) !important; }
  #stage .tool-panel :is(.drop-title,.dz-title) , #stage .tool-panel .dz .t { font:500 14px var(--mono) !important; color:var(--text) !important; margin:0 0 5px !important; }
  #stage .tool-panel :is(.drop-title,.dz-title)::before, #stage .tool-panel .dz .t::before { content:'> '; color:var(--phos); }
  #stage .tool-panel :is(.drop-title,.dz-title)::after, #stage .tool-panel .dz .t::after { content:''; display:inline-block; width:8px; height:15px; margin-left:6px;
    vertical-align:-2px; background:var(--phos); animation:blink 1.1s steps(1) infinite; }
  #stage .tool-panel .dz.loaded :is(.dz-title,.t)::after { display:none; }
  #stage .tool-panel :is(#file-name) , #stage .tool-panel .dz .fn { font:400 13px var(--mono) !important; color:var(--phos) !important; margin:0 !important; }
  #stage .tool-panel #dropzone.has-file #file-name::before { content:'> '; }

  /* commands */
  #stage .tool-panel :is(.btn,.dl-btn,.add-btn,.export-btn,.exp-btn,#analyse-btn), #stage .tool-panel .cue-edit-actions button {
    flex:0 0 auto !important; width:auto !important; align-self:flex-start; padding:8px 12px !important; cursor:pointer;
    font:500 13px var(--mono) !important; text-transform:lowercase !important; white-space:nowrap;
    background:transparent !important; color:var(--accent) !important; border:1px solid var(--line) !important; transition:none !important; transform:none !important; }
  #stage .tool-panel :is(.btn,.dl-btn,.add-btn,.export-btn,.exp-btn,#analyse-btn)::before { content:'[ '; opacity:.6; }
  #stage .tool-panel :is(.btn,.dl-btn,.add-btn,.export-btn,.exp-btn,#analyse-btn)::after { content:' ]'; opacity:.6; }
  #stage .tool-panel :is(.btn,.dl-btn,.add-btn,.export-btn,.exp-btn,#analyse-btn):hover { border-color:var(--accent) !important; background:rgba(232,255,71,.09) !important; opacity:1 !important; }
  /* the one thing to press next reads as selected: inverse video */
  #stage .tool-panel :is(.btn:not(.btn-ghost,.btn-reject,.btn-edit,.btn-sm),.btn-accept,.dl-btn:not(.dl-ghost),#analyse-btn) {
    background:var(--accent) !important; color:var(--bg) !important; border-color:var(--accent) !important; }
  #stage .tool-panel :is(.btn:not(.btn-ghost,.btn-reject,.btn-edit,.btn-sm),.btn-accept,.dl-btn:not(.dl-ghost),#analyse-btn):hover { background:var(--phos) !important; border-color:var(--phos) !important; }
  #stage .tool-panel .btn-sm { padding:5px 9px !important; font-size:12px !important; }
  #stage .tool-panel button:disabled { opacity:.32 !important; cursor:not-allowed; }
  #stage .tool-panel #analyse-btn { display:none; } #stage .tool-panel #analyse-btn.visible { display:inline-block; }
  #stage .tool-panel :is(.export-row,.btn-row,#dl-row,.fixbar-actions) { gap:10px; flex-wrap:wrap; }

  /* tabs: the selected one is inverse */
  #stage .tool-panel :is(.tabs button,.mode-tab) { padding:4px 10px !important; font:400 12px var(--mono) !important; text-transform:lowercase; cursor:pointer;
    background:transparent !important; color:var(--muted) !important; border:1px solid var(--line) !important; }
  #stage .tool-panel :is(.tabs button.on,.mode-tab.active) { background:var(--text) !important; color:var(--bg) !important; border-color:var(--text) !important; }

  /* choices: [x] and [ ] */
  #stage .tool-panel .tag { gap:0 !important; padding:3px 9px !important; font:400 12px var(--mono) !important; opacity:1 !important; cursor:pointer;
    background:transparent !important; color:var(--muted) !important; border:1px solid var(--line) !important; }
  #stage .tool-panel .tag::before { content:'[ ] '; white-space:pre; }
  #stage .tool-panel .tag.active { color:var(--text) !important; border-color:var(--phos) !important; }
  #stage .tool-panel .tag.active::before { content:'[x] '; color:var(--phos); }
  #stage .tool-panel .tag.locked { opacity:.3 !important; cursor:not-allowed; }
  #stage .tool-panel .tag-x { display:none; }
  #stage .tool-panel .toggle { width:auto !important; height:auto !important; cursor:pointer; font:400 13px var(--mono); color:var(--muted); white-space:nowrap; }
  #stage .tool-panel .toggle :is(.toggle-track,.toggle-thumb) { display:none !important; }
  #stage .tool-panel .toggle::after { content:'[ ] off'; }
  #stage .tool-panel .toggle:has(input:checked)::after { content:'[x] on'; color:var(--phos); }
  #stage .tool-panel .toggle:focus-within { outline:1px solid var(--accent); outline-offset:3px; }
  #stage .tool-panel input[type=checkbox] { appearance:none; -webkit-appearance:none; display:inline-block !important; flex:none; width:14px !important; height:14px; margin:0;
    vertical-align:-2px; cursor:pointer; background:transparent; border:1px solid var(--muted); }
  #stage .tool-panel input[type=checkbox]:checked { background:var(--phos); border-color:var(--phos); box-shadow:inset 0 0 0 2px var(--bg); }
  #stage .tool-panel .toggle input { width:0 !important; height:0 !important; border:0 !important; position:absolute; }
  #stage .tool-panel :is(.std-btn,.ep-format-btn) { background:transparent !important; border:1px solid var(--line) !important; font-family:var(--mono) !important; }
  #stage .tool-panel :is(.std-btn,.ep-format-btn):hover { border-color:var(--accent) !important; }
  #stage .tool-panel :is(.std-btn,.ep-format-btn).active { border-color:var(--accent) !important; background:rgba(232,255,71,.07) !important; }

  /* fields */
  #stage .tool-panel :is(input:not([type=checkbox],[type=file]),select,textarea) { background:#040604 !important; color:var(--text) !important; caret-color:var(--accent);
    border:1px solid var(--line) !important; font:400 13px var(--mono) !important; }
  #stage .tool-panel :is(input,select,textarea):focus { border-color:var(--accent) !important; outline:0; }

  /* steps and progress */
  #stage .tool-panel .step { border-top:1px solid var(--line) !important; padding:8px 12px 0 0 !important; color:var(--muted); white-space:nowrap; }
  #stage .tool-panel .step i { opacity:1; margin-right:8px; }
  #stage .tool-panel .step.active { color:var(--accent) !important; border-top-color:var(--accent) !important; }
  #stage .tool-panel .step.done { color:var(--phos) !important; border-top-color:var(--phos) !important; }
  #stage .tool-panel :is(.progress-bar-track,.track,.progress-track) { height:10px !important; padding:1px; background:transparent !important; border:1px solid var(--line); }
  #stage .tool-panel :is(.progress-bar-fill,.fill,.progress-fill) { height:100% !important;
    background:repeating-linear-gradient(90deg, var(--phos) 0 6px, transparent 6px 8px) !important; }
  #stage .tool-panel :is(#status,#progress-label,#progress-sub) { font:400 12px var(--mono) !important; text-align:left !important; }
  #stage .tool-panel #progress-wrap { align-items:stretch !important; }

  /* read-outs */
  #stage .tool-panel :is(#stats,.stats-bar) { gap:0 !important; background:transparent !important; border:1px solid var(--line) !important; }
  #stage .tool-panel :is(.stat,.stat-cell) { background:transparent !important; border-right:1px solid var(--line); text-align:left; padding:12px 16px !important; }
  #stage .tool-panel :is(.stat,.stat-cell):last-child { border-right:0; }
  #stage .tool-panel :is(.stat-num,.stat-val,.metric-val) { font:500 21px var(--mono) !important; }
  #stage .tool-panel :is(.metric,.info-cell,.qc-item,.table-wrap,.shot-card,.col,.card,.script-pane,.ep-sample) { background:transparent !important; border-color:var(--line) !important; }
  #stage .tool-panel :is(.metric,.info-cell) { text-align:left; padding:12px 14px !important; }
  #stage .tool-panel .verdict { background:transparent !important; }
  #stage .tool-panel .verdict.pass { border-color:var(--pass) !important; } #stage .tool-panel .verdict.fail { border-color:var(--fail) !important; }
  #stage .tool-panel :is(.verdict-title,.std-name,.qc-name) { font-family:var(--mono) !important; font-weight:500 !important; }
  #stage .tool-panel .pill { background:transparent !important; padding:0 !important; }
  #stage .tool-panel .pill::before { content:'['; } #stage .tool-panel .pill::after { content:']'; }
  #stage .tool-panel #waveform-canvas { background:#040604 !important; border-color:var(--line) !important; }
  #stage .tool-panel #load-error { color:var(--fail); font-size:12px; }
  #stage .tool-panel #ep-controls { display:flex; flex-direction:column; gap:14px; }
  /* the downloads stay in reach however far the options scroll */
  #stage .tool-panel #dl-row.visible { position:sticky; bottom:58px; z-index:5; margin:0; padding:12px 0 6px; background:var(--bg); border-top:1px solid var(--line); }
  #stage .tool-panel #status { position:sticky; bottom:30px; z-index:5; min-height:28px; margin-top:-24px; padding:4px 0; background:var(--bg); }
</style>
</head>
<body>

<nav id="sidebar">
  <div id="brandhead" data-tool="home" title="Back to the start">
    <div class="suite-eyebrow">LIZARD LIPS</div>
    __WORDMARK__
    <pre class="lizard" id="lizard"></pre>
  </div>
__NAV__
  <div class="sidebar-foot">
    <div><kbd>1</kbd>&ndash;<kbd>__COUNT__</kbd> open a tool &nbsp; <kbd>esc</kbd> back here</div>
    <div>files stay on this machine</div>
  </div>
</nav>

<div id="stage">
  <div id="landing" class="active">
    <div class="term">
      <div class="dim" style="--i:0">hot suite &mdash; post-production tools. nothing you load is uploaded.</div>
      <div class="ps" style="--i:1">ls</div>
      <div class="ls" style="--i:2">__LS__</div>
      <div class="ps" style="--i:4" id="ask-ps">open</div>
      <div id="ask" style="--i:5"><span class="dim">drop a file anywhere and it opens in the right tool, or press a number</span><span class="cursor"></span></div>
    </div>
  </div>
__PANELS__
  <div id="toast" role="status"></div>
</div>

<script>
  const TOOLS = __TOOLS_JS__;      // [key, label, tagline, group, built, takes]
  const BUILT = __NATIVE_KEYS__;
  const $id = id => document.getElementById(id);
  const stage = $id('stage'), landing = $id('landing'), ask = $id('ask'), toast = $id('toast');
  const hosts = {}; BUILT.forEach(k => hosts[k] = $id('host-' + k));
  const labelOf = k => (TOOLS.find(t => t[0] === k) || [])[1] || k;
  let current = 'home', pending = null;
  // A tool can hand a file to another: Delivery QC opens a file in the
  // Loudness Analyser this way. Tools check this flag before offering it.
  window.__llShell = true;

  // one name and one description per tool, taken from the list above
  TOOLS.forEach(([key, label, tag]) => {
    const p = $id('panel-' + key); if (!p) return;
    const h = p.querySelector('header h1'), s = p.querySelector('header span');
    if (h) h.textContent = label; if (s) s.textContent = tag;
  });

  // ── gecko ──
  const lizardEl = $id('lizard');
  let tongue = '_', eyeC = 'c', eyeO = 'O';
  function render() { lizardEl.textContent = [
    "                       )/_", '             _.--..---"-,--' + eyeC + "_", "        \\L..'           ._" + eyeO + "__)" + tongue,
    ",-.     _.+  _  \\..--( /", "  `\\.-''__.-' \\ (     \\_", "    `''" + "'       `\\__   /\\ ", "                ')"].join("\n"); }
  render();
  if (!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    (function flick() { tongue = '~'; render(); setTimeout(() => { tongue = '_'; render(); }, 160); setTimeout(flick, 2200 + Math.random() * 2600); })();
    (function wink() { eyeC = eyeO = '-'; render(); setTimeout(() => { eyeC = 'c'; eyeO = 'O'; render(); }, 120); setTimeout(wink, 3400 + Math.random() * 3000); })();
  }

  // ── moving around ──
  function go(key) {
    if (!hosts[key]) key = 'home';
    current = key;
    landing.classList.toggle('active', key === 'home');
    Object.keys(hosts).forEach(k => hosts[k].classList.toggle('active', k === key));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.tool === key));
    if (location.hash !== '#' + key) history.replaceState(null, '', '#' + key);
    if (key !== 'home') clearAsk();
  }
  document.querySelectorAll('[data-tool]').forEach(el => el.addEventListener('click', () => go(el.dataset.tool)));
  window.addEventListener('hashchange', () => go(location.hash.slice(1)));

  // ── handing files to tools ──
  // What each tool takes, in order. The first entry is what it opens with from
  // the start screen; later ones apply once you're inside it. A third value
  // names a panel that must be showing first.
  const TAKES = {
    cutlogger:     [[/\.xml$/i, '#file-input']],
    loudness:      [[/\.(wav|mp3|aiff?|flac|m4a|aac|mp4|mov)$/i, '#file-input']],
    speccheck:     [[/\.(pdf|docx|xlsx?|txt|csv)$/i, '#spec-input'], [/./, '#assets-input', '#p-files']],
    subsync:       [[/\.(srt|vtt)$/i, '#srt-input'], [/\.(txt|docx|pdf|fdx)$/i, '#script-input']],
    presetbuilder: [[/\.(pdf|docx|xlsx?|txt|csv)$/i, '#spec-input']],
  };
  function give(key, files) {
    const panel = $id('panel-' + key), list = [...files];
    for (const [re, sel, needs] of TAKES[key] || []) {
      if (!re.test(list[0].name)) continue;
      if (needs && panel.querySelector(needs).classList.contains('hidden')) continue;
      const input = panel.querySelector(sel);
      const tab = panel.querySelector('.tabs button[data-m="upload"], .mode-tab[data-smode="upload"]');
      if (tab && /spec|script/.test(sel)) tab.click();
      const dt = new DataTransfer();
      (input.multiple ? list : list.slice(0, 1)).forEach(f => dt.items.add(f));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }
  const ext = name => (name.match(/\.[^.]+$/) || ['this'])[0].toLowerCase();
  function say(msg) { toast.textContent = msg; toast.classList.add('on'); clearTimeout(say.t); say.t = setTimeout(() => toast.classList.remove('on'), 4500); }
  function clearAsk() { pending = null; ask.innerHTML = '<span class="dim">drop a file anywhere and it opens in the right tool, or press a number</span><span class="cursor"></span>'; }
  function openWith(files) {
    const name = files[0].name;
    const fits = BUILT.filter(k => TAKES[k] && TAKES[k][0][0].test(name));
    if (fits.length === 1) { go(fits[0]); give(fits[0], files); return; }
    go('home');
    ask.textContent = '';
    const line = document.createElement('div');
    if (!fits.length) { line.className = 'bad'; line.textContent = 'nothing here opens ' + ext(name) + ' files'; ask.appendChild(line); pending = null; return; }
    line.textContent = name + ' \u2014 which tool?';
    ask.appendChild(line);
    pending = { files, fits };
    fits.forEach(k => {
      const b = document.createElement('button');
      b.textContent = (BUILT.indexOf(k) + 1) + '  ' + labelOf(k).toLowerCase();
      b.addEventListener('click', () => { go(k); give(k, files); });
      ask.appendChild(b);
    });
  }
  const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  // A file dropped anywhere outside a drop zone used to make the browser open
  // it, replacing the suite and losing whatever was in progress.
  window.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); if (!e.target.closest || !e.target.closest('#dropzone,.dz')) stage.classList.add('dragging'); else stage.classList.remove('dragging'); } });
  window.addEventListener('dragleave', e => { if (!e.relatedTarget) stage.classList.remove('dragging'); });
  window.addEventListener('drop', e => {
    stage.classList.remove('dragging');
    if (!hasFiles(e) || e.defaultPrevented) return;          // a tool's own drop zone took it
    e.preventDefault();
    const files = e.dataTransfer.files; if (!files.length) return;
    if (current === 'home') return openWith(files);
    if (!give(current, files)) say(labelOf(current) + " doesn't take " + ext(files[0].name) + ' files at this step');
  });

  window.addEventListener('ll-open', e => {
    const d = e.detail || {};
    if (!hosts[d.tool] || !d.files || !d.files.length) return;
    go(d.tool);
    if (!give(d.tool, d.files)) { say(labelOf(d.tool) + " doesn't take " + ext(d.files[0].name) + ' files'); return; }
    const run = d.run && $id('panel-' + d.tool).querySelector('#analyse-btn');
    if (run) setTimeout(() => run.click(), 60);
  });

  // ── keys ──
  window.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === 'Escape') { go('home'); clearAsk(); return; }
    const n = parseInt(e.key, 10);
    if (!(n >= 1 && n <= BUILT.length)) return;
    const key = BUILT[n - 1];
    if (pending && pending.fits.includes(key)) { const f = pending.files; go(key); give(key, f); }
    else go(key);
  });

  // ── start ──
  try { if (!sessionStorage.getItem('ll-booted')) { document.body.classList.add('booting'); sessionStorage.setItem('ll-booted', '1');
        setTimeout(() => document.body.classList.remove('booting'), 1200); } } catch (e) {}
  go(location.hash.slice(1) || 'home');
</script>

<script>
__TOOL_JS__
</script>
</body>
</html>
"""


WORDMARK = '<div class="suite-mark"><span class="mk-in"><span class="mk-r">██╗  ██╗   ██████╗   ████████╗      ███████╗  ██╗   ██╗  ██╗  ████████╗  ███████╗\n██║  ██║  ██╔═══██╗  ╚══██╔══╝      ██╔════╝  ██║   ██║  ██║  ╚══██╔══╝  ██╔════╝</span><span class="mk-r mk-shift">███████║  ██║   ██║     ██║         ███████╗  ██║   ██║  ██║     ██║     █████╗  \n██╔══██║  ██║   ██║     ██║         ╚════██║  ██║   ██║  ██║     ██║     ██╔══╝  </span><span class="mk-r">██║  ██║  ╚██████╔╝     ██║         ███████║  ╚██████╔╝  ██║     ██║     ███████╗\n╚═╝  ╚═╝   ╚═════╝      ╚═╝         ╚══════╝   ╚═════╝   ╚═╝     ╚═╝     ╚══════╝</span></span></div>'


def build():
    # Shared code goes into every tool that uses it first, so a fix made in one
    # place reaches all of them in the same build.
    print("Syncing shared code:")
    sync_engine()

    built = [t for t in TOOLS if t[4]]
    nav, ls, panels, tool_css, tool_js = [], [], [], [], []
    for group in GROUP_ORDER:
        rows = [t for t in built if t[3] == group]
        if not rows:
            continue
        nav.append('  <div class="nav-cat">%s</div>' % html.escape(group.lower()))
        for row in rows:
            key, label, tag, _g, src, wip, takes = row
            badge = '<span class="nav-wip">wip</span>' if wip else ""
            nav.append('  <button class="nav-item" data-tool="%s"><span class="nav-key">%d</span><span class="nav-body">'
                       '<span class="nav-label">%s%s</span><span class="nav-tag">%s</span></span></button>'
                       % (key, built.index(row) + 1, html.escape(label), badge, html.escape(tag)))
    for i, (key, label, tag, _g, src, wip, takes) in enumerate(built):
        ls.append('<button data-tool="%s" style="--i:%d"><span class="k">%d</span><span class="n">%s</span>'
                  '<span class="d">%s</span><span class="t">%stakes %s</span></button>'
                  % (key, i, i + 1, html.escape(label), html.escape(tag), "<i>wip</i> &nbsp;" if wip else "", html.escape(takes)))
        t = toolify(str(ROOT / src), key)
        if t["ext_scripts"]:
            raise SystemExit("%s loads a library with the page (%s) \u2014 use needLib() so it loads on demand"
                             % (src, ", ".join(t["ext_scripts"])))
        tool_css.append("/* \u2500\u2500 %s \u2500\u2500 */\n%s" % (key, t["css"]))
        tool_js.append("/* \u2500\u2500 %s \u2500\u2500 */\n%s" % (key, t["js"]))
        panels.append('  <div class="tool-host" id="host-%s">\n%s\n  </div>' % (key, t["panel_html"]))

    page = (TEMPLATE
            .replace("__WORDMARK__", WORDMARK)
            .replace("__NAV__", "\n".join(nav))
            .replace("__LS__", "".join(ls))
            .replace("__COUNT__", str(len(built)))
            .replace("__PANELS__", "\n".join(panels))
            .replace("__TOOL_CSS__", "\n\n".join(tool_css))
            .replace("__TOOL_JS__", "\n\n".join(tool_js))
            .replace("__TOOLS_JS__", json.dumps([[k, l, t, g, bool(s), tk] for k, l, t, g, s, w, tk in TOOLS]))
            .replace("__NATIVE_KEYS__", json.dumps([t[0] for t in built])))
    OUT.write_text(page, encoding="utf-8")
    print("Wrote %s (%s bytes)" % (OUT, format(len(page.encode("utf-8")), ",")))
    print("Panels:", ", ".join(t[0] for t in built))


if __name__ == "__main__":
    build()
