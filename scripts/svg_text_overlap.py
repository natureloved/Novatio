#!/usr/bin/env python3
"""Verify no decorative curve or polygon crosses a text bounding box.

The skill requires a numeric overlap proof, not an eyeball claim: for every
<text> and every <path>/<polygon> in the card, compute the actual geometry
intersection and report it. A text box is widened by 4px vertically to allow
for antialiasing without flagging legitimate descenders/ascenders.

Run: python3 scripts/svg_text_overlap.py <svg> [--verbose]
"""
import sys
import xml.etree.ElementTree as ET

SVG_NS = 'http://www.w3.org/2000/svg'


def parse_d(d):
    """Very small SVG path parser: M/L/H/V/C/Q/Z with absolute coords."""
    cmds, cur, i = [], [], 0
    tokens = d.replace(',', ' ').replace('-', ' -').split()
    while i < len(tokens):
        op = tokens[i]
        if op in ('M', 'm'):
            x, y = float(tokens[i+1]), float(tokens[i+2])
            if cur: cmds.append(cur)
            cur = [(x, y)]
            i += 3
        elif op in ('L', 'l'):
            if not cur:
                i += 3; continue
            cur.append((float(tokens[i+1]), float(tokens[i+2])))
            i += 3
        elif op in ('H', 'h'):
            if not cur:
                i += 2; continue
            cur.append((float(tokens[i+1]), cur[-1][1]))
            i += 2
        elif op in ('V', 'v'):
            if not cur:
                i += 2; continue
            cur.append((cur[-1][0], float(tokens[i+1])))
            i += 2
        elif op in ('C', 'c'):
            if not cur:
                i += 7; continue
            x1, y1 = float(tokens[i+1]), float(tokens[i+2])
            x2, y2 = float(tokens[i+3]), float(tokens[i+4])
            x, y = float(tokens[i+5]), float(tokens[i+6])
            p0 = cur[-1]
            for s in range(1, 9):
                t = s/8; u = 1-t
                cur.append((u**3*p0[0] + 3*u*u*t*x1 + 3*u*t*t*x2 + t**3*x,
                            u**3*p0[1] + 3*u*u*t*y1 + 3*u*t*t*y2 + t**3*y))
            i += 7
        elif op in ('Q', 'q'):
            if not cur:
                i += 5; continue
            x1, y1 = float(tokens[i+1]), float(tokens[i+2])
            x, y = float(tokens[i+3]), float(tokens[i+4])
            p0 = cur[-1]
            for s in range(1, 9):
                t = s/8; u = 1-t
                cur.append((u*u*p0[0] + 2*u*t*x1 + t*t*x,
                            u*u*p0[1] + 2*u*t*y1 + t*t*y))
            i += 5
        elif op in ('A', 'a'):
            # arcs: approximate with a line to the endpoint
            cur.append((float(tokens[i+6]), float(tokens[i+7])))
            i += 8
        elif op in ('Z', 'z'):
            i += 1
        else:
            i += 1
    if cur: cmds.append(cur)
    return cmds


def poly_from_path(d):
    out = []
    for c in parse_d(d):
        out.extend(c)
        if c[0] != c[-1]:
            out.append(c[0])
    return out


def seg_intersects_box(p1, p2, box, pad=4.0):
    """Liang-Barsky style clip test, expanded by pad."""
    x0, y0 = p1; x1, y1 = p2
    bx0, by0, bx1, by1 = box
    bx0 -= pad; by0 -= pad; bx1 += pad; by1 += pad
    dx, dy = x1-x0, y1-y0
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, x0-bx0), (dx, bx1-x0),
                 (-dy, y0-by0), (dy, by1-y0)):
        if abs(p) < 1e-12:
            if q < 0:
                return False
        else:
            r = q/p
            if p < 0:
                if r > t1: return False
                if r > t0: t0 = r
            else:
                if r < t0: return False
                if r < t1: t1 = r
    return True


def main():
    path = sys.argv[1]
    verbose = '--verbose' in sys.argv
    tree = ET.parse(path)
    root = tree.getroot()

    texts, polys = [], []
    for el in root.iter():
        tag = el.tag.split('}')[-1]
        if tag == 'text':
            x = float(el.get('x', 0)); y = float(el.get('y', 0))
            size = float(el.get('font-size', 16))
            ls = el.get('letter-spacing', '0')
            ls = float(ls) if ls not in ('', 'normal') else 0.0
            n = len(el.text or '')
            # rough width: 0.62 em average glyph advance for serif, plus tracking
            w = n * size * 0.62 + n * ls
            texts.append((f'{el.text!r} @({x},{y})',
                          (x, y - size*1.05, x + w, y + size*0.3)))
        elif tag == 'path':
            d = el.get('d')
            if d and el.get('stroke') and el.get('stroke') != 'none':
                pts = poly_from_path(d)
                if len(pts) > 1:
                    polys.append(('path', pts))
        elif tag == 'polygon':
            pts = []
            for pt in el.get('points', '').split():
                a, b = pt.split(',')
                pts.append((float(a), float(b)))
            if len(pts) > 1:
                polys.append(('polygon', pts))

    crossings = []
    for label, box in texts:
        for kind, pts in polys:
            for i in range(len(pts)-1):
                if seg_intersects_box(pts[i], pts[i+1], box):
                    crossings.append((label, kind, pts[i], pts[i+1]))
                    break

    print(f'{path}')
    print(f'  text boxes: {len(texts)}')
    print(f'  decorative paths/polygons: {len(polys)}')
    if crossings:
        print(f'  ✗ CROSSINGS: {len(crossings)}')
        for label, kind, p1, p2 in crossings[:10]:
            print(f'    {label} crossed by {kind} {p1} -> {p2}')
        return 1
    print('  ✓ no curve crosses any text box')
    if verbose:
        for label, box in texts:
            print(f'    {label}: box {tuple(round(v,1) for v in box)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
