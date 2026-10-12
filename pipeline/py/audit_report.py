#!/usr/bin/env python3
"""Audit a Ruff Liners weekly Euka report JSON against source control totals.

Usage: python3 audit_report.py report.json controls.json

controls.json holds the totals read straight from the Euka source files (see
SKILL.md, Phase 6). Exit code 0 = PASS, 1 = FAIL. Never edit report numbers to
make this pass; re-run the failing query instead.
"""
import json, re, sys

L = [f"l{i}" for i in range(1, 8)]
fails, warns = [], []


def close(a, b, tol):
    return a is not None and b is not None and abs(a - b) <= tol


def fail(msg):
    fails.append(msg)


def warn(msg):
    warns.append(msg)


def pct(cur, prior):
    if prior in (0, None) or cur is None:
        return None
    return round((cur - prior) / prior * 100, 1)


def lvl_sum(block, prefix, i):
    vals = [block[f"{prefix}{n}"][i] for n in range(1, 8)]
    if any(v is None for v in vals):
        return None
    return sum(vals)


def main(rp, cp):
    r = json.load(open(rp))
    c = json.load(open(cp))
    d, W, M, T = r["d30"], r["weeklyCharts"], r["monthlyCharts"], r["tables"]

    # 1. Schema and lengths
    for k in ["meta", "d30", "weeklyCharts", "monthlyCharts", "tables", "agents", "analysis"]:
        if k not in r:
            fail(f"missing top-level field {k}")
    for k, v in W.items():
        if isinstance(v, list) and len(v) != 13:
            fail(f"weeklyCharts.{k} has {len(v)} values, expected 13")
    for k, v in M.items():
        if isinstance(v, list) and len(v) != 6:
            fail(f"monthlyCharts.{k} has {len(v)} values, expected 6")
    for t in L:
        if t not in d["tiers"]:
            fail(f"d30.tiers.{t} missing")

    # 2. d30 levels reconcile to d30 totals and controls
    for f_t, f_d, tol in [("creators", "creators", 0), ("newCreators", "newCreators", 0), ("videos", "videos", 0),
                          ("views", "views", 0), ("gmv", "gmv", 0.5), ("msgs", "msgs", 0), ("samples", "samples", 0)]:
        s = sum(d["tiers"][t][f_t] for t in L)
        if not close(s, d[f_d], tol):
            fail(f"d30 levels {f_t} sum {s} != d30.{f_d} {d[f_d]}")
    for k, v in c["d30"].items():
        if k in d and not close(d[k], v, 0.5):
            fail(f"d30.{k} {d[k]} != source {v}")

    # 3. d30 % changes recomputed from prior-period controls
    for k, prior in c["d30_prior"].items():
        exp = pct(d[k], prior)
        got = d.get(k + "Pct")
        if exp is None and got is None:
            continue
        if not close(got, exp, 0.11):
            fail(f"d30.{k}Pct {got} != recomputed {exp}")
    for t in L:
        for f in ["msgs", "samples"]:
            exp = pct(d["tiers"][t][f], c["tier_prior"][t][f])
            got = d["tiers"][t][f + "Pct"]
            if not (exp is None and got is None) and not close(got, exp, 0.11):
                fail(f"d30.tiers.{t}.{f}Pct {got} != recomputed {exp}")
    if not close(d["retentionDelta"], round(c["retention_current"] - c["retention_prior"], 1), 0.11):
        fail("d30.retentionDelta does not match source retention values")
    sg = c["shop_gmv_guardrail"]
    if not (sg["gmvFiltered"] is False and sg["filteredGmvUnavailable"] is False and sg["shopGmvError"] is None) and d["shopGmv"] != 0:
        fail("shopGmv used although the GMV guardrail failed")

    # 4. GMV Max
    gm = d["gmvMax"]
    if gm["spend"] and not close(gm["roi"], round(gm["revenue"] / gm["spend"], 2), 0.011):
        fail("gmvMax.roi != revenue/spend")
    cov = 0
    for b in d["gmvMaxByAge"]:
        if b["spend"] and not close(b["roi"], round(b["revenue"] / b["spend"], 2), 0.011):
            fail(f"gmvMaxByAge {b['label']} roi wrong")
        if not close(b["pct"], round(b["spend"] / gm["spend"] * 100, 1), 0.11):
            fail(f"gmvMaxByAge {b['label']} pct wrong")
        cov += b["pct"]
    if d["gmvMaxByAge"] and cov < 99.5:
        warn(f"gmvMaxByAge covers {cov:.1f}% of spend (creative report not fully paged)")

    # 5. Weekly reconciliation
    cw = c["weekly"]
    for i in range(13):
        checks = [("gl", W["gmv"][i], 0.5), ("vwl", W["views"][i], 0), ("vl", W["vid"][i], 0),
                  ("crl", cw["creators"][i], 0), ("ncl", cw["new_creators"][i], 0),
                  ("ml", cw["msgs"][i], 0), ("sl", cw["samples"][i], 0)]
        for p, tot, tol in checks:
            s = lvl_sum(W, p, i)
            if s is not None and not close(s, tot, tol):
                fail(f"weekly {W['labels'][i]} {p}1..7 sum {round(s, 2)} != total {tot}")
        for n in range(1, 8):
            if W[f"ncl{n}"][i] > W[f"crl{n}"][i]:
                fail(f"weekly {W['labels'][i]} ncl{n} > crl{n}")
    for k in ["gmv", "views", "vid", "ret"]:
        for i, v in enumerate(cw[k]):
            if not close(W[k][i], v, 0.5):
                fail(f"weekly {k}[{i}] {W[k][i]} != source {v}")

    # 6. Monthly reconciliation
    cm = c["monthly"]
    for i in range(6):
        checks = [("gl", M["gmv"][i], 0.5), ("vwl", M["views"][i], 0), ("vl", cm["videos"][i], 0),
                  ("crl", cm["creators"][i], 0), ("ncl", cm["new_creators"][i], 0),
                  ("ml", cm["msgs"][i], 0), ("sl", cm["samples"][i], 0), ("sal", cm["samples_approved"][i], 0)]
        for p, tot, tol in checks:
            s = lvl_sum(M, p, i)
            if tot is None:
                if s is not None:
                    fail(f"monthly {M['labels'][i]} {p} should be null (no source)")
                continue
            if s is None or not close(s, tot, tol):
                fail(f"monthly {M['labels'][i]} {p}1..7 sum {s} != total {tot}")
        for n in range(1, 8):
            if M[f"ncl{n}"][i] > M[f"crl{n}"][i]:
                fail(f"monthly {M['labels'][i]} ncl{n} > crl{n}")
    for k in ["gmv", "shopGmv", "affiliateGmv", "views", "ret"]:
        for i, v in enumerate(cm[k]):
            if not close(M[k][i], v, 0.5):
                fail(f"monthly {k}[{i}] {M[k][i]} != source {v}")
    if M["labels"][-1].endswith("*") and M["ret"][-1] is not None:
        warn("partial-month retention is shown; it will read low on the chart")

    # 7. Tables
    def sorted_desc(rows, key, name):
        vals = [x[key] for x in rows]
        if vals != sorted(vals, reverse=True):
            fail(f"tables.{name} not sorted by {key}")
    sorted_desc(T["topCreators"], "sgmv", "topCreators")
    sorted_desc(T["topVideos"], "gmv", "topVideos")
    sorted_desc(T["activeCreators"], "v30", "activeCreators")
    sorted_desc(T["weeklyTopCreators"], "gmv", "weeklyTopCreators")
    sorted_desc(T["weeklyTopVideos"], "gmv", "weeklyTopVideos")
    sorted_desc(T["weeklyActiveCreators"], "vid", "weeklyActiveCreators")
    for name in ["topCreators", "topVideos", "weeklyTopCreators", "weeklyTopVideos", "weeklyActiveCreators"]:
        g = "sgmv" if name == "topCreators" else "gmv"
        for x in T[name]:
            if x["ord"] and not close(x["aov"], x[g] / x["ord"], 0.02):
                fail(f"tables.{name} {x['h']} aov {x['aov']} != gmv/orders {round(x[g] / x['ord'], 2)}")
    for x in T["topCreators"]:
        if x["active"] != (x["v30"] > 0):
            fail(f"topCreators {x['h']} active flag wrong")
        if x["vmgmv"] > x["v30"]:
            fail(f"topCreators {x['h']} vmgmv > v30")
        if x["v7"] > x["v30"]:
            fail(f"topCreators {x['h']} v7 > v30")
        if x["v30"] > x["vlife"]:
            fail(f"topCreators {x['h']} v30 > vlife")
    sg_by_h = {x["h"]: x["sgmv"] for x in T["topCreators"]}
    for x in T["activeCreators"]:
        if x["gmvN"] > x["gmvT"] + 0.01:
            fail(f"activeCreators {x['h']} gmvN > gmvT")
        if x["h"] in sg_by_h and not close(x["gmvT"], sg_by_h[x["h"]], 0.5):
            fail(f"activeCreators {x['h']} gmvT {x['gmvT']} != topCreators sgmv {sg_by_h[x['h']]}")
        if x["v30"] and not close(x["avgv"], x["views"] / x["v30"], 1):
            fail(f"activeCreators {x['h']} avgv wrong")
    for ctrl_h, ctrl_g in c.get("creator_store_gmv", {}).items():
        for x in T["activeCreators"]:
            if x["h"] == ctrl_h and not close(x["gmvT"], ctrl_g, 0.5):
                fail(f"activeCreators {ctrl_h} gmvT {x['gmvT']} != source {ctrl_g}")

    # 8. Agents
    ids = [a["id"] for a in r["agents"]]
    if len(ids) != len(set(ids)):
        fail("duplicate agent ids")
    start = c["window_start"]
    unenriched = []
    for a in r["agents"]:
        if a["date_posted"] < start:
            fail(f"agent {a['id']} posted {a['date_posted']} before window start")
        if any("not enriched" in str(a[k]) for k in ["gmv_filter", "kw_filter", "other_filters", "list_segment", "commission_display"]):
            unenriched.append(a["id"])
    if unenriched:
        warn(f"{len(unenriched)} of {len(r['agents'])} agents missing get_outreach_agent enrichment")
    ca = c["agents"]
    n_out = sum(1 for a in r["agents"] if a["agent_type"] == "outreach")
    n_crm = sum(1 for a in r["agents"] if a["agent_type"] == "crm")
    if n_out != ca["outreach_in_window"] or n_crm != ca["crm_in_window"]:
        fail(f"agents: {n_out} outreach / {n_crm} crm, source says {ca['outreach_in_window']} / {ca['crm_in_window']}")

    # 9. Numbers quoted in the analysis that can't be traced to the data
    pool = set()

    def walk(o):
        if isinstance(o, dict):
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
        elif isinstance(o, (int, float)) and not isinstance(o, bool):
            pool.add(float(o))
    walk({k: v for k, v in r.items() if k != "analysis"})
    walk(c)
    for extra in c.get("derived_numbers", []):
        pool.add(float(extra))
    text = " ".join(r["analysis"].values())
    unverified = []
    for m in re.finditer(r"\$([\d,]+(?:\.\d+)?)(K|M)?(?:[–-][\d,.]+(K|M))?", text):
        n = float(m.group(1).replace(",", ""))
        suffix = m.group(2) or m.group(3)
        n *= {"K": 1e3, "M": 1e6}.get(suffix, 1)
        tol = max(0.006 * n, 1) if suffix else 1
        if not any(abs(n - p) <= tol for p in pool):
            unverified.append(m.group(0))
    if unverified:
        warn("dollar figures in analysis not traced to data (check by hand or add to derived_numbers): "
             + ", ".join(sorted(set(unverified))))

    print("AUDIT:", "PASS" if not fails else "FAIL")
    print(f"  failures: {len(fails)}  warnings: {len(warns)}")
    for f in fails:
        print("  FAIL -", f)
    for w in warns:
        print("  WARN -", w)
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
