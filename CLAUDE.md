# Git — Production Branch

**Always push to `claude/friendly-gauss-AGnJ3`.** This is the branch Vercel deploys from.

```
git push origin claude/friendly-gauss-AGnJ3
# or to mirror main:
git push origin main:claude/friendly-gauss-AGnJ3
```

Never push to `main` alone — it will not deploy to production.
