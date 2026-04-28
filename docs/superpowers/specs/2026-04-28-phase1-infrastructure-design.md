# Phase 1 — Infrastructure Design

**Project:** publicserve  
**Date:** 2026-04-28  
**Status:** Approved

## Overview

Terraform-managed Azure infrastructure for publicserve. Single Azure subscription, two environments (nprod, prod) separated by resource groups and Terraform workspaces. All resources in `australiaeast`.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Azure auth (CI/Deploy) | Service Principal + client secret | Simple, widely supported |
| TF state backend | Azure Storage | Remote, CI-friendly |
| Environment isolation | Single subscription, per-env resource groups | Sufficient isolation, lower overhead |
| Region | australiaeast | User preference |
| Key Vault access model | RBAC | Azure-native, fine-grained |
| TF structure | Workspaces + tfvars | Less duplication than separate env dirs |

## Azure Resources

Resources are workspace-parameterised — `{env}` = `nprod` or `prod`.

### Per-environment

| Resource | Name | Notes |
|---|---|---|
| Resource Group | `rg-publicserve-{env}` | Contains all env resources |
| Static Web App | `swa-publicserve-{env}` | **Standard tier** — required for SSR (Next.js API routes / next-auth) |
| Storage Account | `stpublicserve{env}` | Tables + ADLS Gen2 (hierarchical namespace enabled) |
| Key Vault | `kv-publicserve-{env}` | RBAC-based access; stores storage credentials and app secrets |

#### Storage Account — Table Storage

Tables provisioned in `stpublicserve{env}`:

- `Users`
- `Sessions`
- `Groups`
- `Orgs`
- `OrgGroups`
- `Records`
- `StorageLocations`

#### Storage Account — ADLS Gen2

Hierarchical namespace enabled on `stpublicserve{env}`. Containers are provisioned per organisation at runtime (not via Terraform), using credentials stored in Key Vault.

#### Key Vault — RBAC Role Assignments

| Principal | Role | Scope |
|---|---|---|
| `sp-publicserve-cicd` | Key Vault Secrets Officer | `kv-publicserve-{env}` |
| Static Web App managed identity | Key Vault Secrets User | `kv-publicserve-{env}` |

> **Note:** SWA system-assigned managed identity must be explicitly enabled in the `swa` Terraform module (`identity { type = "SystemAssigned" }`). The identity object ID is used for the RBAC role assignment.

### Bootstrap (one-off, applied manually)

| Resource | Name | Notes |
|---|---|---|
| Resource Group | `rg-publicserve-tfstate` | Not workspace-managed |
| Storage Account | `stpublicservettfstate` | One container per workspace (`nprod`, `prod`) |
| Service Principal | `sp-publicserve-cicd` | Client secret stored as GitHub Actions secret |

Bootstrap lives in `terraform/bootstrap/` and is applied once manually. It is not part of the workspace-parameterised root module.

## Terraform Layout

```
terraform/
  main.tf             # workspace-aware resource definitions
  variables.tf
  outputs.tf
  backend.tf          # azurerm backend; container = terraform.workspace
  terraform.tfvars    # shared defaults (region, prefix, etc.)
  nprod.tfvars        # env-specific overrides
  prod.tfvars
  modules/
    swa/              # Azure Static Web App
    storage/          # Storage account, tables, ADLS Gen2 config
    keyvault/         # Key Vault, RBAC role assignments
  bootstrap/          # TF state storage account + SP (manual, one-off)
    main.tf
    outputs.tf
```

### Workspace Usage

```bash
# First apply
terraform workspace new nprod
terraform apply -var-file=nprod.tfvars

terraform workspace new prod
terraform apply -var-file=prod.tfvars

# Subsequent applies
terraform workspace select nprod
terraform apply -var-file=nprod.tfvars
```

## GitHub Actions Secrets Required

| Secret | Description |
|---|---|
| `ARM_CLIENT_ID` | SP application (client) ID |
| `ARM_CLIENT_SECRET` | SP client secret |
| `ARM_TENANT_ID` | Azure tenant ID |
| `ARM_SUBSCRIPTION_ID` | Azure subscription ID |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | SWA deploy token — set per GitHub Environment (`nprod`/`prod`), different value each |

## Out of Scope (Phase 1)

- Application code
- Auth configuration
- Record/artifact data model
- CI/CD workflow definitions (Phase 4)
