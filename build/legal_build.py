#!/usr/bin/env python3
"""Turn the counsel-supplied legal text into styled HTML for the site.

    python3 build/legal_build.py

Reads build/source/legal/{terms,privacy}.txt — plain text extracted from the
PDFs counsel provided, kept verbatim — and writes build/legal-terms.html and
build/legal-privacy.html, which assemble.py injects into the legal pages.

The wording is never edited here. The script only recognises structure
(sections, sub-headings, bullet lists, the retention table) and marks it up.
It asserts at the end that every word of the source survives into the output,
so a parsing mistake fails the build instead of quietly dropping a clause.
"""
import html as H
import pathlib
import re
import sys

BUILD = pathlib.Path(__file__).resolve().parent
SRC = BUILD / "source" / "legal"

# Sub-headings are titles that carry no section number. Listing them explicitly
# beats guessing from capitalisation: a heuristic that misfires on legal text
# either invents a heading mid-clause or buries one, and both are silent.
SUBHEADS = {
    # Terms
    "Join Fee", "Other Fees", "Interest", "Failed Payments", "Chargebacks",
    "Taxes", "Host Responsibilities", "Hunt Review", "Future Community Hunts",
    "Host Compensation", "Marketing", "Public Sharing",
    # Privacy
    "Information You Provide", "Information Collected Automatically",
    "Information From Third Parties", "Information We Do Not Collect",
    "AI-Assisted Verification", "AI Training", "California Residents",
    "Other U.S. State Privacy Laws", "International Users",
    "Payment Providers", "Cloud Infrastructure Providers",
    "Analytics Providers", "Email and Communications Providers",
    "Customer Support Providers", "AI Service Providers",
    "Professional Advisors", "Business Transfers", "Legal Requirements",
}
# A second, shallower level nested under the ones above.
SUBSUBHEADS = {
    "Account Information", "Identity and Eligibility Information",
    "Payment Information", "Hunt Activity", "Communications",
    "Host Applications", "Connected Social Accounts", "Service Providers",
}

DISPLAY_TITLES = {"HUNTZ TERMS OF SERVICE": "Huntz Terms of Service"}
SECTION_RE = re.compile(r"^(\d{1,2})\.\s+(.+)$")
BULLET_RE = re.compile(r"^\s*●\s*(.+)$")

# The retention table in Privacy §7. PDF text extraction flattens tables into
# ragged lines, so the rows are declared here and checked against the source
# rather than reconstructed from whitespace columns.
RETENTION_TABLE = [
    ("Account information",
     "For the life of your account and up to 30 days after account closure, unless a longer period is required by law"),
    ("Payment and transaction records",
     "Seven (7) years after the applicable transaction for tax, accounting, and regulatory purposes"),
    ("Proof submissions (photos, videos, reflections, logs)",
     "Six (6) months after the applicable Hunt concludes, unless retained for an active dispute, fraud investigation, or legal obligation"),
    ("Dispute records", "Three (3) years after resolution"),
    ("Customer support communications", "Two (2) years after the last communication"),
    ("Aggregated or de-identified analytics",
     "May be retained indefinitely because they no longer identify an individual"),
]

# ---------------------------------------------------------------- typography
INK, BODY, MUTED, CLAY = "#16130E", "#4A453C", "#6E6759", "#C24E1F"
SERIF = "'Playfair Display','Times New Roman',serif"
SANS = "'Figtree',Arial,Helvetica,sans-serif"
RULE = "rgba(22,19,14,.14)"

S = {
    "h2": f"margin:0 0 14px;font:600 clamp(23px,2.5vw,30px)/1.2 {SERIF};letter-spacing:-.012em;color:{INK};text-wrap:balance",
    "h3": f"margin:30px 0 10px;font:700 13px {SANS};letter-spacing:.13em;text-transform:uppercase;color:{CLAY}",
    "h4": f"margin:22px 0 8px;font:600 16px {SERIF};color:{INK}",
    "p": f"margin:0 0 15px;font:400 15.5px/1.75 {SANS};color:{BODY};text-wrap:pretty",
    "ul": f"margin:0 0 18px;padding-left:20px;display:flex;flex-direction:column;gap:7px;list-style:none",
    "li": f"position:relative;font:400 15.5px/1.7 {SANS};color:{BODY};text-wrap:pretty",
    "caps": (f"margin:0 0 15px;padding:16px 18px;border-left:2px solid {CLAY};background:rgba(194,78,31,.05);"
             f"font:600 12.5px/1.85 {SANS};letter-spacing:.02em;color:{INK}"),
    "sec": f"margin:0 0 44px;scroll-margin-top:86px",
}


def norm(s: str) -> str:
    """Collapse the ragged spacing PDF extraction leaves behind."""
    s = s.replace(" ", " ")
    s = re.sub(r"\s*\n\s*", " ", s)
    s = re.sub(r" {2,}", " ", s)
    return s.strip()


def esc(s: str) -> str:
    return H.escape(s, quote=False)


def linkify(s: str) -> str:
    """Emails and huntz.ai become real links; everything else is left alone."""
    s = re.sub(r"([\w.+-]+@[\w-]+\.[\w.]+)",
               rf'<a href="mailto:\1" style="color:{CLAY};text-decoration:none;border-bottom:1px solid rgba(194,78,31,.4)">\1</a>', s)
    s = re.sub(r"(?<![\w/@.])(huntz\.ai)(?![\w@])",
               r'<a href="/" style="color:%s;text-decoration:none;border-bottom:1px solid rgba(194,78,31,.4)">\1</a>' % CLAY, s)
    return s


def is_caps_block(t: str) -> bool:
    letters = [c for c in t if c.isalpha()]
    return len(letters) > 25 and sum(c.isupper() for c in letters) / len(letters) > 0.9


def isolate_headings(raw: str) -> str:
    """Put every heading on a paragraph of its own.

    The PDF often runs a heading straight into the sentence beneath it, so
    splitting on blank lines alone merges the two. Section headings are found by
    their number continuing the sequence (1, 2, 3 …), which makes a false
    positive on ordinary prose effectively impossible; named sub-headings are
    matched against the lists above.
    """
    lines = raw.split("\n")
    out, i, expect = [], 0, 1
    while i < len(lines):
        line = lines[i]
        m = re.match(r"^\s*(\d{1,2})\.\s+(\S.*)$", line)
        if m and int(m.group(1)) == expect:
            title = norm(m.group(2))
            # A heading that wraps ends on a dangling connective ("… Issues, and").
            if (re.search(r"\b(and|or|of|to|the|a|in|for|with)$", title, re.I)
                    and i + 1 < len(lines) and lines[i + 1].strip()
                    and len(norm(lines[i + 1])) < 40):
                i += 1
                title += " " + norm(lines[i])
            out += ["", f"{expect}. {title}", ""]
            expect += 1
            i += 1
            continue
        if norm(line) in SUBHEADS or norm(line) in SUBSUBHEADS:
            out += ["", norm(line), ""]
            i += 1
            continue
        out.append(line)
        i += 1
    return "\n".join(out)


def blocks(raw: str):
    """Yield normalised paragraph-ish blocks, splitting bullets onto their own."""
    for chunk in re.split(r"\n\s*\n", raw):
        if not chunk.strip():
            continue
        # A chunk can mix a lead-in sentence with the bullets that follow it.
        cur, mode = [], None
        for line in chunk.split("\n"):
            if not line.strip():
                continue
            m = BULLET_RE.match(line)
            this = "bullet" if m else "text"
            # continuation of a wrapped bullet: indented, no marker
            if this == "text" and mode == "bullet" and re.match(r"^\s{6,}\S", line):
                cur[-1] += " " + line.strip()
                continue
            if this != mode and cur:
                yield mode, cur
                cur = []
            mode = this
            cur.append(m.group(1).strip() if m else line.strip())
        if cur:
            yield mode, cur


def render(raw: str, doc_id: str):
    """Return (html, toc) for one document."""
    out, toc = [], []
    open_section = False
    skip_table = False

    seen_title = False
    for mode, lines in blocks(raw):
        text = norm(" ".join(lines))
        if not text:
            continue

        # The document's own masthead and date, styled as the page header.
        if not seen_title and mode == "text":
            seen_title = True
            shown = DISPLAY_TITLES.get(text, text)
            out.append(f'<div style="font:600 11px {SANS};letter-spacing:.2em;'
                       f'text-transform:uppercase;color:{MUTED};margin-bottom:16px">Legal</div>')
            out.append(f'<h1 style="margin:0 0 12px;font:600 clamp(32px,4.4vw,54px)/1.05 {SERIF};'
                       f'letter-spacing:-.014em;color:{INK};text-wrap:balance">{esc(shown)}</h1>')
            continue
        if re.match(r"^(Effective Date|Last Updated)\b", text):
            out.append(f'<p style="margin:0 0 34px;font:600 11px {SANS};letter-spacing:.14em;'
                       f'text-transform:uppercase;color:{MUTED}">{esc(text)}</p>')
            continue

        if mode == "bullet":
            items = "".join(
                f'<li style="{S["li"]}"><span style="position:absolute;left:-20px;top:.62em;width:5px;height:5px;'
                f'border-radius:50%;background:{CLAY};opacity:.55"></span>{linkify(esc(norm(b)))}</li>'
                for b in lines)
            out.append(f'<ul style="{S["ul"]}">{items}</ul>')
            continue

        # The retention table: emit once, then swallow its flattened remains.
        if text.startswith("Information Retention Period"):
            rows = "".join(
                f'<tr><th scope="row" style="text-align:left;vertical-align:top;padding:13px 18px 13px 0;'
                f'border-top:1px solid {RULE};font:600 14.5px/1.6 {SANS};color:{INK};width:38%">{esc(a)}</th>'
                f'<td style="vertical-align:top;padding:13px 0;border-top:1px solid {RULE};'
                f'font:400 14.5px/1.6 {SANS};color:{BODY}">{esc(b)}</td></tr>'
                for a, b in RETENTION_TABLE)
            head = (f'<thead><tr>'
                    f'<th scope="col" style="text-align:left;padding:0 18px 10px 0;font:700 11px {SANS};'
                    f'letter-spacing:.14em;text-transform:uppercase;color:{MUTED}">Information</th>'
                    f'<th scope="col" style="text-align:left;padding:0 0 10px;font:700 11px {SANS};'
                    f'letter-spacing:.14em;text-transform:uppercase;color:{MUTED}">Retention Period</th>'
                    f'</tr></thead>')
            out.append(
                f'<div style="overflow-x:auto;margin:0 0 20px">'
                f'<table style="width:100%;min-width:440px;border-collapse:collapse">'
                f'{head}<tbody>{rows}</tbody></table></div>')
            skip_table = True
            continue
        if skip_table:
            # Rows re-appear as loose text; drop them until real prose resumes.
            if text.startswith(("Deleting", "If you request deletion")):
                skip_table = False
            else:
                continue

        m = SECTION_RE.match(text)
        if m and len(text) < 90:
            num, title = m.group(1), norm(m.group(2))
            anchor = f"{doc_id}-{num}"
            toc.append((num, title, anchor))
            if open_section:
                out.append("</section>")
            out.append(f'<section id="{anchor}" style="{S["sec"]}">'
                       f'<h2 style="{S["h2"]}"><span style="color:{CLAY};font-size:.62em;'
                       f'vertical-align:.28em;margin-right:.5em;font-family:{SANS};font-weight:700">'
                       f'{num}</span>{esc(title)}</h2>')
            open_section = True
            continue

        if text in SUBHEADS:
            out.append(f'<h3 style="{S["h3"]}">{esc(text)}</h3>')
            continue
        if text in SUBSUBHEADS:
            out.append(f'<h4 style="{S["h4"]}">{esc(text)}</h4>')
            continue

        style = S["caps"] if is_caps_block(text) else S["p"]
        out.append(f'<p style="{style}">{linkify(esc(text))}</p>')

    if open_section:
        out.append("</section>")
    return "\n".join(out), toc


def toc_html(toc, doc_id):
    items = "".join(
        f'<li><button type="button" data-goto="{a}" style="display:flex;gap:10px;width:100%;text-align:left;'
        f'background:none;border:0;padding:5px 0;cursor:pointer;font:500 14px/1.5 {SANS};color:{BODY}" '
        f'data-toc-item>'
        f'<span style="color:{MUTED};font-variant-numeric:tabular-nums;min-width:1.5em">{n}</span>'
        f'<span>{esc(t)}</span></button></li>'
        for n, t, a in toc)
    return (f'<nav aria-label="Contents" style="margin:0 0 46px;padding:22px 24px;border:1px solid {RULE};'
            f'border-radius:16px;background:rgba(255,255,255,.5)">'
            f'<div style="font:700 11px {SANS};letter-spacing:.16em;text-transform:uppercase;color:{MUTED};'
            f'margin-bottom:12px">Contents</div>'
            f'<ol style="list-style:none;margin:0;padding:0;columns:2;column-gap:34px" data-toc>{items}</ol></nav>')


def build(name, doc_id, title, datestamp, intro_until):
    raw = (SRC / f"{name}.txt").read_text()
    body, toc = render(isolate_headings(raw), doc_id)
    # Everything before section 1 is the preamble; it renders above the contents.
    split = body.find('<section id="%s-1"' % doc_id)
    preamble, sections = body[:split], body[split:]
    html = preamble + toc_html(toc, doc_id) + sections
    dest = BUILD / f"legal-{name}.html"
    dest.write_text(html)

    # Fidelity gate: every word of counsel's text must survive.
    # Compare alphanumeric runs, so pure punctuation (the period after a section
    # number, a dropped bullet glyph) does not read as missing wording.
    src_words = re.findall(r"[a-z0-9]+", norm(raw.replace("●", " ")).lower())
    out_words = re.findall(r"[a-z0-9]+", norm(re.sub(r"<[^>]+>", " ", H.unescape(html))).lower())
    # Compared as a multiset, not in sequence: PDF extraction reads the retention
    # table one column at a time, so the source's word order there is genuinely
    # interleaved. Dropping a clause — the failure that matters — still trips this.
    from collections import Counter
    missing = Counter(src_words) - Counter(out_words)
    if missing:
        sys.exit(f"{name}: {sum(missing.values())} source words missing from output: "
                 f"{list(missing.elements())[:12]}")
    print(f"  {name}: {len(toc)} sections, {len(src_words)} words, all present -> {dest.name}")
    return len(toc)


print("building legal pages from counsel's text")
build("terms", "tos", "Terms of Service", "Effective July 30, 2026", 1)
build("privacy", "pp", "Privacy Policy", "Last updated July 30, 2026", 1)
