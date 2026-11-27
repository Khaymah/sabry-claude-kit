# CI/CD with GitHub Actions

- **Situation:** "run tests on every PR", "auto deploy when I merge", secrets for the server, a deploy that anyone with push access can trigger, "ask me before production".
- **Skip when:** the client mandates another CI (GitLab, Azure DevOps): keep the same stages and rules there.
- **Decision:** one workflow checks (typecheck, lint, tests on a Postgres service, build) on every PR and push; a second job deploys over SSH only from `main`, in a GitHub Environment named `production` with required reviewer approval, using a deploy-only SSH key stored in that environment's secrets.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Checks on PRs, deploy from `main` only, secrets in Actions secrets |
| Standard | Production client: Postgres service, build artifact, `production` environment with approval, concurrency lock, pinned actions |
| Advanced | Several environments or a team: staging auto-deploy, OIDC to cloud, SBOM and dependency review, deploy windows |

## Rules

### Minimum — always, never cut

- Secrets only in GitHub Actions secrets (environment-scoped for production). Never in the repo, the workflow file, or a `run:` echo; GitHub masks values but not their transformations (base64, substrings).
- The deploy job has `if: github.ref == 'refs/heads/main'` and `needs: check`. A pull request from a fork never reaches secrets: use `pull_request`, never `pull_request_target` with a checkout of PR code.
- Top-level `permissions: contents: read`; widen per job only when needed.
- The deploy key is a dedicated ed25519 key pair for this repo only, installed on the server for the `deploy` user, restricted in `authorized_keys` (`restrict,command="/usr/local/bin/deploy-entry"`). It is not the owner's personal key.
- Pin the server's host key in the workflow (`known_hosts` secret from `ssh-keyscan` made once, checked by hand). `StrictHostKeyChecking=no` is not allowed.
- The deploy runs the same script as manual deploys (`devops/deploy-zero-downtime.md`); CI only uploads the artifact and calls it.

### Standard — adds

- Checks: `bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, `bun test` against a `postgres:16` service with a health check and a throwaway database; migrations run before the tests so schema drift fails here.
- Build once in CI, ship the artifact (`tar` of `dist` plus production dependencies) with `rsync` to a new release directory, never build on the server.
- `environment: production` with required reviewers = the manual approval gate. The run waits; nothing touches the server until approved.
- `concurrency: group: deploy-production, cancel-in-progress: false`, so two merges queue instead of racing.
- `actions/checkout`, `oven-sh/setup-bun` pinned to a full commit SHA or an exact version with Dependabot updates on.
- `timeout-minutes` on every job so a hung step does not burn the free minutes.
- Deploy summary written to the job summary: release name, previous release (the rollback target).

### Advanced — adds

- Staging deploys automatically from `main`; production deploys the same artifact (promote, don't rebuild) after approval.
- Branch protection on `main`: required checks, linear history, no force pushes, CODEOWNERS for `.github/` and the deploy script.
- Dependency review and `bun audit` on PRs; the deploy key rotated every 6 months.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Tests pass on CI but the Postgres version differs from prod | The service image tag matches the server's major version (`postgres-ops.md`) |
| Migration fails during deploy | Script exits non-zero before the switch, job red, old release still serving, the approval is not "used up": rerun the job |
| Data at 100×: test database grows, suite slows | Tests use transactions or truncate per file, not full reseeds; the job has `timeout-minutes` and sharding is the Advanced step |
| Twice / parallel: two merges within a minute | `concurrency` queues the second; the deploy script's `flock` is the second line of defence |
| Approver approves an old commit's run after newer commits landed | Deploy job checks `git rev-parse origin/main` equals the run's SHA, else exits and asks to rerun |
| A secret rotated on the server but not in Actions | Deploy fails at SSH with a clear step name; secrets listed in the repo README by name, never value |
| Fork PR needs a secret to test | It does not get one; tests use fake keys from `.env.test` committed with dummy values |

## Example — Standard, GitHub Actions

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: test
          POSTGRES_DB: app_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      DATABASE_URL: postgres://postgres:test@localhost:5432/app_test
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.2.0
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun run lint
      - run: bun run db:migrate
      - run: bun test
      - run: bun run build
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist
          retention-days: 7

  deploy:
    needs: check
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    environment: production
    concurrency:
      group: deploy-production
      cancel-in-progress: false
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: dist
          path: dist
      - name: Prepare SSH
        env:
          DeployKey: ${{ secrets.DEPLOY_KEY }}
          KnownHosts: ${{ secrets.KNOWN_HOSTS }}
        run: |
          install -m 700 -d ~/.ssh
          printf '%s\n' "$DeployKey" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          printf '%s\n' "$KnownHosts" > ~/.ssh/known_hosts
      - name: Upload and switch
        env:
          Release: ${{ github.sha }}
          Host: ${{ secrets.DEPLOY_HOST }}
        run: |
          rsync -az --delete dist/ deploy@$Host:/srv/app/releases/$Release/
          ssh deploy@$Host "/usr/local/bin/deploy $Release"
```

Never inline `${{ … }}` expressions inside a `run:` script; pass secrets and any untrusted text (branch name, PR title) through `env:` as above. Other CI: the same stages in GitLab CI with `services: postgres` and protected environments.

## Verify

- [ ] `[M]` A PR from a fork shows green checks and the `deploy` job is skipped; `grep -r "StrictHostKeyChecking=no" .github` finds nothing.
- [ ] `[M]` Pushing a branch other than `main` never runs `deploy`.
- [ ] `[S]` Breaking a test turns the PR red; the Postgres service log shows the migration ran.
- [ ] `[S]` Merging to `main` pauses at "Waiting for approval"; rejecting it leaves the server untouched.
- [ ] `[S]` Two quick merges deploy one after the other, not at the same time.
- [ ] `[A]` Staging gets the same artifact SHA that production later promotes.

## Pitfalls

- **Private key committed "just for CI"** → whole server exposed → Actions secret, dedicated key, `restrict` in `authorized_keys`.
- **`pull_request_target` plus `actions/checkout` of the PR head** → forks run code with secrets → `pull_request` only.
- **Building on the server** → differing toolchain and a slow deploy → build in CI, ship the artifact.
- **`echo ${{ secrets.X }} > file`** → shell injection and a mangled key → env var and `printf '%s\n'`.
- **Unpinned `@main` actions** → supply-chain change under you → pinned tags or SHAs.

## Related

`devops/deploy-zero-downtime.md` · `devops/vps-setup.md` · `devops/postgres-ops.md` · `practices/INDEX.md` · `security/INDEX.md`
