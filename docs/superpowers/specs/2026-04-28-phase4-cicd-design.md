# Phase 4 — CI/CD Pipeline Design

**Project:** publicserve  
**Date:** 2026-04-28  
**Status:** Approved

## Overview

Three GitHub Actions workflows: unit tests on PR, E2E tests on push to main, and a release workflow that detects the environment from the tag name and auto-deploys (Terraform + Azure SWA) to nprod or prod.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Unit test framework | Vitest | First-class Next.js/ESM support |
| E2E framework | Playwright | Modern, fast, cross-browser |
| Release trigger | `release.published` GitHub event | Explicit, decoupled from push |
| Env detection | Tag contains `rc` → nprod, else → prod | Simple, readable convention |
| Prod protection | None (auto-deploy) | No approval gate required |
| Terraform trigger | Release only | Infra and app deploy in same workflow |

## Workflows

### `pr.yml` — Unit Tests

**Trigger:** `pull_request` targeting `main` (opened, synchronize, reopened)

```yaml
on:
  pull_request:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: npm
      - run: npm ci
      - run: npx vitest run
```

### `push-main.yml` — E2E Tests

**Trigger:** `push` to `main`

```yaml
on:
  push:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npx playwright test
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

### `release.yml` — Deploy

**Trigger:** `release` event, type `published`

```yaml
on:
  release:
    types: [published]

jobs:
  detect-env:
    runs-on: ubuntu-latest
    outputs:
      environment: ${{ steps.detect.outputs.env }}
    steps:
      - id: detect
        run: |
          if [[ "${{ github.ref_name }}" == *rc* ]]; then
            echo "env=nprod" >> $GITHUB_OUTPUT
          else
            echo "env=prod" >> $GITHUB_OUTPUT
          fi

  deploy:
    needs: detect-env
    runs-on: ubuntu-latest
    environment: ${{ needs.detect-env.outputs.environment }}
    env:
      ARM_CLIENT_ID: ${{ secrets.ARM_CLIENT_ID }}
      ARM_CLIENT_SECRET: ${{ secrets.ARM_CLIENT_SECRET }}
      ARM_TENANT_ID: ${{ secrets.ARM_TENANT_ID }}
      ARM_SUBSCRIPTION_ID: ${{ secrets.ARM_SUBSCRIPTION_ID }}
      DEPLOY_ENV: ${{ needs.detect-env.outputs.environment }}
    steps:
      - uses: actions/checkout@v4

      - uses: hashicorp/setup-terraform@v3

      - name: Terraform init + apply
        working-directory: terraform
        run: |
          terraform init
          terraform workspace select $DEPLOY_ENV
          terraform apply -var-file=${DEPLOY_ENV}.tfvars -auto-approve

      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: npm

      - run: npm ci
      - run: npm run build

      - name: Deploy to Azure Static Web Apps
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: upload
          app_location: /
          output_location: .next
```

## GitHub Environments

| Environment | Protection | Secrets |
|---|---|---|
| `nprod` | None (auto-deploy) | `ARM_CLIENT_ID`, `ARM_CLIENT_SECRET`, `ARM_TENANT_ID`, `ARM_SUBSCRIPTION_ID`, `AZURE_STATIC_WEB_APPS_API_TOKEN` |
| `prod` | None (auto-deploy) | Same set, prod values |

Each environment has its own copy of `AZURE_STATIC_WEB_APPS_API_TOKEN` (the deploy token from `swa-publicserve-{env}`). The `ARM_*` secrets may be shared (same SP) or per-env depending on desired isolation — either approach is valid.

## Tag Convention

| Tag | Environment |
|---|---|
| `v1.2.0-rc.1`, `v2.0.0-rc`, `1.0.0-rc.3` | `nprod` |
| `v1.2.0`, `v2.0.0`, `1.0.0` | `prod` |

The detection is a simple string-contains check on `github.ref_name`. Any tag with `rc` anywhere in the name routes to nprod.

## Repository Secrets Required

Set at repo level (shared across environments) or per-environment:

| Secret | Scope | Description |
|---|---|---|
| `ARM_CLIENT_ID` | Per-env or repo | SP application ID |
| `ARM_CLIENT_SECRET` | Per-env or repo | SP client secret |
| `ARM_TENANT_ID` | Per-env or repo | Azure tenant ID |
| `ARM_SUBSCRIPTION_ID` | Per-env or repo | Azure subscription ID |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Per-env | SWA deploy token (different per env) |

## File Layout

```
.github/
  workflows/
    pr.yml
    push-main.yml
    release.yml
```

## Out of Scope (Phase 4)

- Terraform plan PR comments
- Slack/email deploy notifications
- Rollback workflow
- Dependency update automation (Renovate / Dependabot)
