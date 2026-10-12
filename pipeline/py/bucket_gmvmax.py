#!/usr/bin/env python3
"""Build d30.gmvMaxByAge from EVERY page of get_gmv_max_creative_report.

Usage: python3 bucket_gmvmax.py <ref_date YYYY-MM-DD> <header_spend> page1.json page2.json ...
Each page file is the raw JSON the tool returned (with "rows" and "hasMore").
Fails unless the last page has hasMore=false and buckets sum to the header within $0.05.
Publish date is decoded from the TikTok video id (id >> 32 = unix seconds); itemId -1 = no video.
"""
import json, sys, datetime as dt

ref = dt.date.fromisoformat(sys.argv[1]); header = float(sys.argv[2]); files = sys.argv[3:]
order = ["< 30 days", "1–2 months", "2–3 months", "3–5 months", "5+ months", "Unknown post date"]
B = {k: [0, 0.0, 0.0] for k in order}
last_has_more = True
for f in files:
    page = json.load(open(f))
    last_has_more = page.get("hasMore", True)
    for r in page["rows"]:
        iid, c, rev = str(r["itemId"]), float(r["cost"]), float(r["grossRevenue"])
        if iid == "-1":
            b = "Unknown post date"
        else:
            age = (ref - dt.datetime.fromtimestamp(int(iid) >> 32, dt.timezone.utc).date()).days
            b = "< 30 days" if age <= 29 else "1–2 months" if age <= 60 else "2–3 months" if age <= 90 else "3–5 months" if age <= 150 else "5+ months"
        B[b][0] += 1; B[b][1] += c; B[b][2] += rev
total = sum(v[1] for v in B.values())
out = [{"label": k, "videos": v[0], "spend": round(v[1], 2), "revenue": round(v[2], 2),
        "roi": round(v[2] / v[1], 2) if v[1] else 0, "pct": round(v[1] / header * 100, 1)}
       for k, v in B.items() if v[0]]
print(json.dumps(out, ensure_ascii=False, indent=1))
print(f"bucket spend {total:.2f} vs header {header:.2f} (diff {header - total:.2f})", file=sys.stderr)
if last_has_more:
    sys.exit("FAIL: last page still has hasMore=true — keep paging")
if abs(total - header) > 0.05:
    sys.exit("FAIL: buckets do not sum to the header spend")
