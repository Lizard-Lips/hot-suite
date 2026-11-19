"""
detoolify.py — recover a standalone tool page from the built hub.

The build only ever transformed tools mechanically (prefix the CSS, wrap the JS,
lift the body markup), so those steps can be undone. The result won't be
byte-identical to whatever was originally written, but it round-trips through
toolify.py to the same output, which is what matters for rebuilding.
"""
import re
import sys

# libraries a tool needs, detected from how its code uses them
LIB_SIGNATURES = [
    ("JSZip",                 "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"),
    ("Tesseract",             "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"),
    ("pdfjsLib",              "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"),
    ("mammoth",               "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js"),
    ("XLSX",                  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"),
    ("mediaInfoFactory",      "https://cdn.jsdelivr.net/npm/mediainfo.js@0.3.1/dist/umd/index.min.js"),
]

FONTS = ('<link href="https://fonts.googleapis.com/css2?'
         'family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap" rel="stylesheet">')


def _blocks(hub, key):
    """Locate this tool's CSS block, JS block and panel markup in the hub."""
    marks = [(m.group(1), m.start()) for m in re.finditer(r'/\* ── (\w+) ── \*/', hub)]
    style_end = hub.index('</style>')
    css_start = next(i for k, i in marks if k == key and i < style_end)
    css_end = min([i for _, i in marks if i > css_start] + [style_end])
    js_start = next(i for k, i in marks if k == key and i > style_end)
    later = [i for _, i in marks if i > js_start]
    js_end = min(later) if later else hub.rindex('</script>')

    host = hub.index('id="host-%s"' % key)
    panel_open = hub.index('<div class="tool-panel" id="panel-%s">' % key, host)
    body_start = hub.index('>', panel_open) + 1
    body = hub[body_start:_match_div(hub, panel_open)]
    return hub[css_start:css_end], hub[js_start:js_end], body


def _match_div(html, open_idx):
    """Index of the </div> that closes the <div> starting at open_idx."""
    depth = 0
    i = open_idx
    while i < len(html):
        nxt_open = html.find('<div', i)
        nxt_close = html.find('</div>', i)
        if nxt_close == -1:
            return len(html)
        if nxt_open != -1 and nxt_open < nxt_close:
            depth += 1
            i = nxt_open + 4
        else:
            depth -= 1
            if depth == 0:
                return nxt_close
            i = nxt_close + 6
    return len(html)


def _unscope_css(css, key):
    """Strip the #panel-<key> prefix that toolify added to every selector."""
    sel = '#panel-' + key
    out = []
    for line in css.split('\n'):
        if line.strip().startswith('/*'):
            out.append(line)
            continue
        # selector list sits before the first '{'
        if '{' in line:
            head, _, tail = line.partition('{')
            parts = []
            for one in head.split(','):
                one = one.strip()
                if one == sel:
                    parts.append('body')          # was body/html/:root
                elif one.startswith(sel + ' '):
                    parts.append(one[len(sel) + 1:])
                else:
                    parts.append(one)
            line = ', '.join(p for p in parts if p) + ' {' + tail
        out.append(line)
    return '\n'.join(out)


def _unwrap_js(js):
    """Remove the IIFE + scoped-document prologue and the closing epilogue."""
    marker = 'const document = __doc;'
    i = js.index(marker) + len(marker)
    j = js.rindex('})();')
    return js[i:j].strip()


def detoolify(hub_path, key, out_path, title):
    hub = open(hub_path, encoding='utf-8').read()
    css, js, body = _blocks(hub, key)
    css = _unscope_css(css.split('*/', 1)[1], key)
    # the scoper attaches the prefix to section comments too; leaving it there
    # turns the next rule into "#panel-x .foo", which never matches standalone
    css = re.sub(r'(?m)^#panel-' + re.escape(key) + r' (/\*[^*]*\*/)', r'\1', css)
    js = _unwrap_js(js.split('*/', 1)[1])

    libs = [url for token, url in LIB_SIGNATURES if token in js]
    lib_tags = '\n'.join('<script src="%s"></script>' % u for u in libs)

    page = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>%(title)s — Lizard Lips</title>
%(fonts)s
%(libs)s
<style>
:root {
  --bg:#0a0d0a; --surface:#111511; --border:#232a23;
  --phos:#8fff6a; --accent:#e8ff47; --accent2:#47c8ff;
  --text:#e8f0e4; --muted:#5f6b5c;
  --pass:#8fff6a; --fail:#ff6b6b; --warn:#ffcf47;
  --mono:'DM Mono',monospace; --sans:'Syne',sans-serif;
  --glow:0 0 6px rgba(232,255,71,.45);
}
%(css)s
</style>
</head>
<body>
%(body)s
<script>
%(js)s
</script>
</body>
</html>
""" % {"title": title, "fonts": FONTS, "libs": lib_tags,
       "css": css.strip(), "body": body.strip(), "js": js.strip()}
    open(out_path, 'w', encoding='utf-8').write(page)
    return {"libs": libs, "css": len(css), "js": len(js), "body": len(body)}


if __name__ == "__main__":
    hub, key, out, title = sys.argv[1:5]
    print(detoolify(hub, key, out, title))
