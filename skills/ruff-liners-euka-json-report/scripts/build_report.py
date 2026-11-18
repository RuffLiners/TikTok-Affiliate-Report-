#!/usr/bin/env python3
"""Build the Ruff Liners weekly Euka report body and audit controls from exports.

Usage: python3 -I build_report.py inputs.json out_dir
Writes out_dir/draft.json (meta, d30, weeklyCharts, monthlyCharts, tables),
out_dir/controls.json (audit controls, derived_numbers left empty) and prints
the handles that need follower/engagement data plus any capped values.
See SKILL.md Phase 3 for the inputs.json format. Numbers are never adjusted to
fit a total; the only rule applied is newCreators <= creators per level.
"""
import sys, json, csv, datetime as dt, collections
from zoneinfo import ZoneInfo
LA = ZoneInfo("America/Los_Angeles")
D = dt.date.fromisoformat
FIELDS = ["activeCreators", "videos", "totalGmv", "invitesSent", "samplesDelivered", "samplesApproved"]


def lv(x):
    """Accept a raw get_dashboard_creator_level_breakdown response or 7 rows of 6 numbers."""
    if isinstance(x, dict):
        x = x["tiers"]
    if x and isinstance(x[0], dict):
        by = {t["tier"]: t for t in x}
        return [[by[f"L{i}"][f] or 0 for f in FIELDS] for i in range(1, 8)]
    return x


def load_videos(path):
    rows = []
    for r in csv.DictReader(open(path, encoding="utf-8-sig")):
        if not r.get("Date"):
            continue
        d = dt.datetime.fromisoformat(r["Date"].replace("Z", "+00:00"))
        r["d"] = d.astimezone(LA).date()
        r["h"] = r["Creator"].strip().lower()
        for k, n in [("Video Revenue", "gmv"), ("Items Sold", "items"), ("Views Count", "views"),
                     ("Likes Count", "likes"), ("Comments Count", "cmt"), ("Creator 30-Day GMV", "ggmv")]:
            try:
                r[n] = float(r.get(k) or 0)
            except ValueError:
                r[n] = 0.0
        t = (r.get("GMV Tier") or "").strip()
        r["tier"] = 1 if t in ("", "L0") else int(t[1])   # population rule: no tier -> L1
        rows.append(r)
    return rows


def load_cw(path):
    out = []
    for r in csv.DictReader(open(path, encoding="utf-8-sig")):
        r["h"] = r["Creator"].strip().lower()
        r["gmv"] = float(r["Video Revenue"] or 0)
        r["items"] = float(r["Items Sold"] or 0)
        out.append(r)
    return out


def short(p):
    p = p or ""
    if "XL Floor Cover" in p: return "XL Floor Cover"
    if "Travel Bed" in p or "Travel Dog Bed" in p: return "Travel Dog Bed"
    if "Hard Bottom Backseat Extenders" in p or "Back Seat Extender" in p: return "Back Seat Ext."
    if "Hammock" in p: return "Soft Hammock"
    if "Seat Cover" in p: return "Seat Cover"
    return p[:40] or "Unknown"


def main(inp_path, out):
    I = json.load(open(inp_path))
    Wn = I["windows"]
    rows = load_videos(I["files"]["videos"])
    first, ctier, cg = {}, {}, {}
    byh = collections.defaultdict(list)
    for r in rows:
        h = r["h"]
        if h not in first or r["d"] < first[h]: first[h] = r["d"]
        ctier[h] = r["tier"]; cg[h] = r["ggmv"]; byh[h].append(r)
    win = lambda a, b: [r for r in rows if a <= r["d"] <= b]
    caps = []

    def posting(a, b, levels, tag):
        views, new, hs = [0] * 7, [0] * 7, set()
        for r in win(a, b):
            views[r["tier"] - 1] += int(r["views"]); hs.add(r["h"])
        for h in hs:
            if a <= first[h] <= b: new[ctier[h] - 1] += 1
        for i in range(7):
            if new[i] > levels[i][0]:
                caps.append((tag, f"L{i+1}", new[i], levels[i][0])); new[i] = levels[i][0]
        return views, new

    def ret(a, b, pa, pb):
        cur = {r["h"] for r in win(a, b)}; pr = {r["h"] for r in win(pa, pb)}
        return round(len(cur & pr) / len(pr) * 100, 1) if pr else None
    pct = lambda c, p: None if not p else round((c - p) / p * 100, 1)
    r2 = lambda x: round(x, 2)
    S = lambda l, i: sum(t[i] for t in l)
    year = D(I["report_date"]).year
    fdate = lambda x: x.strftime("%b ") + str(x.day) + ("" if x.year == year else f", {x.year}")

    A, B = map(D, Wn["cur"]); PA, PB = map(D, Wn["prior"]); WA, WB = map(D, Wn["week"])
    Lc, Lp = lv(I["levels"]["cur"]), lv(I["levels"]["prior"])
    v30, n30 = posting(A, B, Lc, "d30"); vp, npr = posting(PA, PB, Lp, "prior30")
    c30, cpr, cwk = load_cw(I["files"]["cw_cur"]), load_cw(I["files"]["cw_prior"]), load_cw(I["files"]["cw_week"])
    orders, orders_p = int(sum(r["items"] for r in c30)), int(sum(r["items"] for r in cpr))
    ov, gm, rt = I["overview"], I["gmvmax"], I["retention"]
    g = ov["guardrail"]
    ok = g["gmvFiltered"] is False and g["filteredGmvUnavailable"] is False and g["shopGmvError"] is None
    d30 = {"gmv": r2(S(Lc, 2)), "gmvPct": pct(S(Lc, 2), S(Lp, 2)),
           "shopGmv": r2(ov["shopGmv"]) if ok else 0, "shopGmvPct": round(ov["shopGmvPct"], 1) if ok else 0,
           "affiliateGmv": r2(ov["affiliateGmv"]), "affiliateGmvPct": round(ov["affiliateGmvPct"], 1),
           "orders": orders, "ordersPct": pct(orders, orders_p),
           "videos": S(Lc, 1), "videosPct": pct(S(Lc, 1), S(Lp, 1)),
           "views": sum(v30), "viewsPct": pct(sum(v30), sum(vp)),
           "creators": S(Lc, 0), "creatorsPct": pct(S(Lc, 0), S(Lp, 0)),
           "newCreators": sum(n30), "newCreatorsPct": pct(sum(n30), sum(npr)),
           "retention": round(rt["cur"], 1), "retentionDelta": round(round(rt["cur"], 2) - round(rt["prior"], 2), 1),
           "gmvMax": {"spend": gm["spend"], "revenue": gm["revenue"], "roi": round(gm["revenue"] / gm["spend"], 2) if gm["spend"] else 0},
           "gmvMaxByAge": [], "msgs": S(Lc, 3), "msgsPct": pct(S(Lc, 3), S(Lp, 3)),
           "samples": S(Lc, 4), "samplesPct": pct(S(Lc, 4), S(Lp, 4)), "tiers": {}}
    for i in range(7):
        t, p = Lc[i], Lp[i]
        d30["tiers"][f"l{i+1}"] = {"creators": t[0], "newCreators": n30[i], "videos": t[1], "views": v30[i], "gmv": r2(t[2]),
                                   "msgs": t[3], "msgsPct": pct(t[3], p[3]), "samples": t[4], "samplesPct": pct(t[4], p[4])}
    # GMV Max by content age (publish date decoded from the TikTok video id)
    if I["files"].get("gmvmax_creatives") and gm["spend"]:
        labels = ["< 30 days", "1–2 months", "2–3 months", "3–5 months", "5+ months", "Unknown post date"]
        bk = {k: [set(), 0.0, 0.0] for k in labels}
        f = lambda x: float(x or 0)
        for r in csv.DictReader(open(I["files"]["gmvmax_creatives"], encoding="utf-8-sig")):
            try:
                age = (B - dt.datetime.fromtimestamp(int(r["Video ID"]) >> 32, dt.timezone.utc).date()).days
                if age < -3 or age > 4000: raise ValueError
                k = labels[0] if age <= 29 else labels[1] if age <= 60 else labels[2] if age <= 90 else labels[3] if age <= 150 else labels[4]
            except (ValueError, TypeError, OverflowError):
                k = labels[5]
            bk[k][0].add(r["Video ID"]); bk[k][1] += f(r["Cost"]); bk[k][2] += f(r["Gross revenue"])
        cs, cr = sum(v[1] for v in bk.values()), sum(v[2] for v in bk.values())
        # spend with no creative row (product cards etc.) is the residual to the ads-overview header
        bk[labels[5]][1] += gm["spend"] - cs; bk[labels[5]][2] += gm["revenue"] - cr
        for k in labels:
            v, s, rv = bk[k]
            if abs(s) < 0.005 and not v: continue
            d30["gmvMaxByAge"].append({"label": k, "videos": len(v), "spend": r2(s), "revenue": r2(rv),
                                       "roi": round(rv / s, 2) if s > 0 else 0, "pct": round(s / gm["spend"] * 100, 1)})
        print(f"GMV Max: creative rows cover {cs/gm['spend']*100:.1f}% of spend; residual {gm['spend']-cs:.2f} -> Unknown post date")

    def series(names, ranges, levels, prefixes, first_prev):
        C = {k: [] for k in ["gmv", "views", "ret", "vid"]}
        for p in prefixes:
            for n in range(1, 8): C[f"{p}{n}"] = []
        tot = collections.defaultdict(list); prev = first_prev
        for name, (a, b), l in zip(names, ranges, levels):
            l = lv(l); vw, nw = posting(a, b, l, name)
            C["gmv"].append(r2(S(l, 2))); C["views"].append(sum(vw)); C["vid"].append(S(l, 1)); C["ret"].append(ret(a, b, *prev)); prev = (a, b)
            idx = {"crl": 0, "vl": 1, "gl": 2, "ml": 3, "sl": 4, "sal": 5}
            for n in range(7):
                for p in prefixes:
                    C[f"{p}{n+1}"].append(nw[n] if p == "ncl" else vw[n] if p == "vwl" else (r2(l[n][2]) if p == "gl" else l[n][idx[p]]))
            for k, i in [("creators", 0), ("videos", 1), ("msgs", 3), ("samples", 4), ("samples_approved", 5)]: tot[k].append(S(l, i))
            tot["new_creators"].append(sum(nw))
        return C, tot
    ws = [D(s) for s in Wn["week_starts"]]
    wr = [(a, a + dt.timedelta(days=6)) for a in ws]
    W, wt = series([f"{a.month}/{a.day}" for a in ws], wr, I["levels"]["weeks"], ["crl", "ncl", "vl", "gl", "vwl", "ml", "sl"],
                   (ws[0] - dt.timedelta(days=7), ws[0] - dt.timedelta(days=1)))
    W = {"labels": [f"{a.month}/{a.day}" for a in ws], **W}
    mr = [(D(a), D(b)) for _, a, b in Wn["months"]]
    pm_end = mr[0][0] - dt.timedelta(days=1)
    M, mt = series([m[0] for m in Wn["months"]], mr, I["levels"]["months"], ["crl", "ncl", "vl", "gl", "vwl", "ml", "sl", "sal"],
                   (pm_end.replace(day=1), pm_end))
    del M["vid"]
    M = {"labels": [m[0] for m in Wn["months"]], "gmv": M.pop("gmv"), "shopGmv": ov["monthly_shop"], "affiliateGmv": ov["monthly_aff"], **M}

    CI = I.get("creator_info", {})
    flw = lambda h: CI.get(h, {}).get("flw", 0)
    eng = lambda h: CI.get(h, {}).get("eng")
    ggmv = lambda h: r2(CI[h]["ggmv"]) if CI.get(h, {}).get("ggmv") is not None else r2(cg.get(h, 0))
    def agg(c):
        o = collections.defaultdict(lambda: [0.0, 0.0])
        for r in c: o[r["h"]][0] += r["gmv"]; o[r["h"]][1] += r["items"]
        return o
    g30, gw = agg(c30), agg(cwk)
    def stats(h, a, b):
        s = [r for r in byh[h] if a <= r["d"] <= b]
        return len(s), int(sum(r["views"] for r in s)), sum(1 for r in s if r["gmv"] > 0)
    vid30 = {r["Video ID"] for r in win(A, B)}
    gmvN = collections.defaultdict(float)
    for r in c30:
        if r["Video ID"] in vid30: gmvN[r["h"]] += r["gmv"]
    aov = lambda gg, o: r2(gg / o) if o else 0
    lifev = {r["Video ID"]: r for r in rows}
    def vrow(r):
        x = lifev.get(r["Video ID"], {})
        return {"h": r["h"], "ggmv": ggmv(r["h"]), "prod": short(r["Product"]), "gmv": r2(r["gmv"]), "views": int(x.get("views", 0)),
                "ord": int(r["items"]), "aov": aov(r["gmv"], r["items"]), "likes": int(x.get("likes", 0)), "cmt": int(x.get("cmt", 0)),
                "clicks": None, "date": fdate(x["d"]) if x.get("d") else ""}
    def wrow(h):
        n, vw_, _ = stats(h, WA, WB); gg, o = gw.get(h, [0, 0])
        return {"h": h, "ggmv": ggmv(h), "gmv": r2(gg), "views": vw_, "vid": n, "ord": int(o), "aov": aov(gg, o)}
    T = {"topCreators": []}
    for h, (gg, o) in sorted(g30.items(), key=lambda x: -x[1][0])[:15]:
        n, vw_, vm = stats(h, A, B); n7 = stats(h, WA, WB)[0]
        T["topCreators"].append({"h": h, "flw": flw(h), "sgmv": r2(gg), "ggmv": ggmv(h), "views": vw_, "v30": n, "vmgmv": vm,
                                 "vlife": len(byh[h]), "v7": n7, "ord": int(o), "aov": aov(gg, o), "eng": eng(h), "active": n > 0})
    T["topVideos"] = [vrow(r) for r in sorted(c30, key=lambda r: -r["gmv"])[:15]]
    cnt = collections.Counter(r["h"] for r in win(A, B))
    T["activeCreators"] = []
    for h, n in sorted(cnt.items(), key=lambda x: (-x[1], -g30.get(x[0], [0])[0]))[:15]:
        vw_ = stats(h, A, B)[1]; gg, o = g30.get(h, [0, 0])
        T["activeCreators"].append({"h": h, "ggmv": ggmv(h), "flw": flw(h), "v30": n, "gmvN": r2(gmvN.get(h, 0)), "gmvT": r2(gg),
                                    "views": vw_, "avgv": round(vw_ / n), "ord": int(o)})
    T["weeklyTopCreators"] = [wrow(h) for h, _ in sorted(gw.items(), key=lambda x: -x[1][0])[:10]]
    T["weeklyTopVideos"] = [vrow(r) for r in sorted(win(WA, WB), key=lambda r: -r["gmv"])[:10]]
    cw_ = collections.Counter(r["h"] for r in win(WA, WB))
    T["weeklyActiveCreators"] = [wrow(h) for h, _ in sorted(cw_.items(), key=lambda x: (-x[1], -gw.get(x[0], [0])[0]))[:10]]

    rd = D(I["report_date"])
    meta = {"reportDate": I["report_date"], "label": rd.strftime("%B ") + f"{rd.day}, {rd.year}",
            "dataWindow": f"{A.strftime('%b')} {A.day} – {B.strftime('%b')} {B.day}, {B.year}"}
    json.dump({"meta": meta, "d30": d30, "weeklyCharts": W, "monthlyCharts": M, "tables": T},
              open(f"{out}/draft.json", "w"), ensure_ascii=False, indent=1)
    ctrl = {"window_start": Wn["cur"][0],
            "d30": {k: d30[k] for k in ["gmv", "shopGmv", "affiliateGmv", "orders", "videos", "views", "creators", "newCreators",
                                         "msgs", "samples", "shopGmvPct", "affiliateGmvPct", "retention"]},
            "d30_prior": {"gmv": r2(S(Lp, 2)), "orders": orders_p, "videos": S(Lp, 1), "views": sum(vp), "creators": S(Lp, 0),
                          "newCreators": sum(npr), "msgs": S(Lp, 3), "samples": S(Lp, 4)},
            "tier_prior": {f"l{i+1}": {"msgs": Lp[i][3], "samples": Lp[i][4]} for i in range(7)},
            "retention_current": round(rt["cur"], 2), "retention_prior": round(rt["prior"], 2),
            "shop_gmv_guardrail": g,
            "weekly": {"gmv": W["gmv"], "views": W["views"], "vid": W["vid"], "creators": wt["creators"], "new_creators": wt["new_creators"],
                       "msgs": wt["msgs"], "samples": wt["samples"], "ret": W["ret"]},
            "monthly": {"gmv": M["gmv"], "shopGmv": ov["monthly_shop"], "affiliateGmv": ov["monthly_aff"], "views": M["views"],
                        "videos": mt["videos"], "creators": mt["creators"], "new_creators": mt["new_creators"], "msgs": mt["msgs"],
                        "samples": mt["samples"], "samples_approved": mt["samples_approved"], "ret": M["ret"]},
            "creator_store_gmv": {x["h"]: x["sgmv"] for x in T["topCreators"]},
            "agents": {"outreach_in_window": 0, "crm_in_window": 0}, "derived_numbers": []}
    json.dump(ctrl, open(f"{out}/controls.json", "w"), indent=1)
    need = sorted({x["h"] for t in T.values() for x in t} - set(CI))
    print("capped newCreators (level had fewer dashboard creators):", caps or "none")
    print("handles missing creator_info (search_creators filters.handles):", need or "none")
    print("d30:", {k: v for k, v in d30.items() if k not in ("tiers", "gmvMaxByAge")})


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
