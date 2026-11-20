## Dependabot policy

- Minor and patch npm updates are grouped weekly per ecosystem (`/`, `packages/*`).
- GitHub Actions updates run monthly.
- Auto-merge is allowed only when CI is green (see `.github/workflows/dependabot-automerge.yml`).
- Run `pnpm install` after lockfile updates to refresh the workspace lockfile.