# Git — Production Branch

**Always push directly to `claude/friendly-gauss-AGnJ3`.** This is the only branch. Vercel deploys from it.

```
git push origin HEAD:claude/friendly-gauss-AGnJ3
```

## Rules
- Work directly on `claude/friendly-gauss-AGnJ3` — no feature branches, no dev branches
- Never push to `main` — it is not connected to Vercel
- Never create new branches
- Every commit goes straight to production
