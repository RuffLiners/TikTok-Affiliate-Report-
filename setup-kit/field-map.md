# Euka API → Report Field Map

## `get_dashboard_performance_overview` response fields

| API field (exact name)         | Report field    | Notes |
|-------------------------------|-----------------|-------|
| `totalShopGMV`                | `shopGmv`       | Total account GMV: affiliate + product cards + in-house. **Only trust when guardrail passes.** |
| `totalShopGMVDifference`      | `shopGmvPct`    | % change vs prior period |
| `totalAffiliateGMV`           | `affiliateGmv`  | Affiliate-only GMV from the overview endpoint |
| `totalAffiliateGMVDifference` | `affiliateGmvPct` | % change vs prior period |
| `shopGmvError`                | (guardrail)     | Must be `null` to trust `totalShopGMV` |
| `gmvFiltered`                 | (guardrail)     | Must be `false` to trust `totalShopGMV` |
| `filteredGmvUnavailable`      | (guardrail)     | Must be `false` to trust `totalShopGMV` |

### Guardrail rule
Only use `totalShopGMV` as `shopGmv` when **all three** conditions are true:
- `gmvFiltered === false`
- `filteredGmvUnavailable === false`
- `shopGmvError === null`

If any condition fails, set `shopGmv = 0` (dashboard falls back to affiliate GMV).

## `creator_store_performance` response fields

| API field   | Report field | Notes |
|-------------|--------------|-------|
| GMV         | `gmv`        | Affiliate-only store GMV (backward-compat field) |

## Report schema fields (d30)

| Field           | Source                          | Description |
|-----------------|---------------------------------|-------------|
| `gmv`           | `creator_store_performance`     | Affiliate GMV (backward-compat) |
| `shopGmv`       | `get_dashboard_performance_overview` → `totalShopGMV` | Total account GMV (primary for targets) |
| `affiliateGmv`  | `get_dashboard_performance_overview` → `totalAffiliateGMV` | Affiliate-only from overview |
| `affiliateGmvPct` | `totalAffiliateGMVDifference` | Affiliate GMV % change |

## Report schema fields (monthlyCharts)

| Field        | Source | Description |
|--------------|--------|-------------|
| `gmv`        | `creator_store_performance` per month | Affiliate GMV per month |
| `shopGmv`    | `totalShopGMV` per month | Total account GMV per month (used for target tracker) |
| `affiliateGmv` | `totalAffiliateGMV` per month | Affiliate GMV from overview per month |
