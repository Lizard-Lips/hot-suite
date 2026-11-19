"""
toolify.py — turn a standalone tool page into a scoped panel for the hub.

Each tool is written and tested as its own complete HTML page. This converts one
into a panel that can live alongside the others inside index.html:

  * CSS   every rule gets prefixed with #panel-<key> so it can't leak, and the
          tool's own :root palette is dropped so it inherits the hub's theme
  * HTML  the <body> contents become the panel markup
  * JS    wrapped in an IIFE where document.getElementById / querySelector /
          querySelectorAll only see inside this panel, so tools are free to
          reuse generic ids like #dropzone
  * libs  external <script src> are hoisted out to be shared and de-duplicated
"""
import re

WRAPPER_HEAD = """(function(){
  const __root = window.document.getElementById('panel-%(key)s');
  // scoped document facade — named __doc then aliased so the tool's own
  // `document.*` references resolve here without a TDZ self-reference.
  const __doc = new Proxy(window.document, {
    get(target, prop) {
      if (prop === 'getElementById') return (id) => __root ? __root.querySelector('#' + (window.CSS && CSS.escape ? CSS.escape(id) : id)) : null;
      if (prop === 'querySelector') return (sel) => __root ? __root.querySelector(sel) : null;
      if (prop === 'querySelectorAll') return (sel) => __root ? __root.querySelectorAll(sel) : [];
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    }
  });
  const document = __doc;

%(body)s

})();
"""


def _split(html):
    """Pull the style, body and inline script out of a standalone tool page.

    Deliberately index-based rather than regex: several tools embed a literal
    "</script>" or "</body>" inside a JS string (print-report features), and a
    greedy regex truncates them mid-function.
    """
    # external libraries
    libs = re.findall(r'<script src="([^"]+)"></script>', html)

    # <style> … </style>
    s0 = html.index("<style>") + len("<style>")
    s1 = html.index("</style>", s0)
    css = html[s0:s1]

    # inline script: the first bare <script> after the libs, to the LAST </script>
    j = html.index("<style>")
    k = j
    while True:
        k = html.find("<script>", k + 1)
        if k == -1:
            raise ValueError("no inline <script> found")
        if k > s1:
            break
    js = html[k + len("<script>"): html.rindex("</script>")]

    # <body> … </body>  (last closing tag, for the same reason as above)
    b0 = html.index(">", html.index("<body")) + 1
    b1 = html.rindex("</body>")
    body = html[b0:b1]
    # drop the script tags out of the body markup
    body = re.sub(r'<script[\s\S]*?</script>', '', body)
    return {"css": css, "js": js, "body": body.strip(), "libs": libs}


def _strip_root_vars(css):
    """Remove the tool's own :root palette so it inherits the hub's theme."""
    out, i = [], 0
    while True:
        m = re.search(r':root\s*\{', css[i:])
        if not m:
            out.append(css[i:])
            break
        start = i + m.start()
        out.append(css[i:start])
        depth, k = 0, i + m.end() - 1
        while k < len(css):
            if css[k] == '{':
                depth += 1
            elif css[k] == '}':
                depth -= 1
                if depth == 0:
                    break
            k += 1
        i = k + 1
    return "".join(out)


def _scope_css(css, sel):
    """Prefix every selector with the panel root."""
    css = _strip_root_vars(css)
    out, i = [], 0
    while i < len(css):
        # keep comments verbatim
        if css.startswith("/*", i):
            e = css.find("*/", i)
            e = len(css) if e == -1 else e + 2
            out.append(css[i:e]); i = e; continue
        # at-rules: recurse into the block, leave the condition alone
        if css[i] == '@':
            brace = css.find('{', i)
            semi = css.find(';', i)
            if semi != -1 and (brace == -1 or semi < brace):   # @import etc.
                out.append(css[i:semi + 1]); i = semi + 1; continue
            head = css[i:brace + 1]
            depth, k = 1, brace + 1
            while k < len(css) and depth:
                if css[k] == '{': depth += 1
                elif css[k] == '}': depth -= 1
                k += 1
            inner = css[brace + 1:k - 1]
            if re.match(r'@(media|supports|layer)', head, re.I):
                out.append(head + _scope_css(inner, sel) + "}")
            else:                                   # @keyframes, @font-face …
                out.append(head + inner + "}")
            i = k; continue
        brace = css.find('{', i)
        if brace == -1:
            out.append(css[i:]); break
        selectors = css[i:brace].strip()
        depth, k = 1, brace + 1
        while k < len(css) and depth:
            if css[k] == '{': depth += 1
            elif css[k] == '}': depth -= 1
            k += 1
        block = css[brace:k]
        if selectors:
            parts = []
            for one in selectors.split(','):
                one = one.strip()
                if not one:
                    continue
                if one in ('html', 'body', ':root'):
                    parts.append(sel)
                elif one.startswith(('html ', 'body ')):
                    parts.append(sel + ' ' + one.split(' ', 1)[1])
                elif one.startswith(sel):
                    parts.append(one)
                else:
                    parts.append(sel + ' ' + one)
            out.append(', '.join(parts) + block)
        i = k
    return "".join(out)


def toolify(path, key):
    html = open(path, encoding="utf-8").read()
    parts = _split(html)
    sel = "#panel-" + key
    return {
        "css": _scope_css(parts["css"], sel),
        "js": WRAPPER_HEAD % {"key": key, "body": parts["js"]},
        "panel_html": '<div class="tool-panel" id="panel-%s">\n%s\n</div>' % (key, parts["body"]),
        "ext_scripts": parts["libs"],
    }


if __name__ == "__main__":
    import sys
    r = toolify(sys.argv[1], sys.argv[2])
    print("css:", len(r["css"]), "js:", len(r["js"]), "html:", len(r["panel_html"]))
    print("libs:", r["ext_scripts"])
