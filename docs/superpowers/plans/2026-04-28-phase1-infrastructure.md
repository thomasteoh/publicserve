# Phase 1: Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision all Azure resources for publicserve (nprod + prod) using Terraform workspaces + tfvars.

**Architecture:** Single subscription, per-env resource groups. Terraform workspace-per-env (`nprod`/`prod`) with a shared root module. Bootstrap module creates the TF state storage account and service principal once manually.

**Tech Stack:** Terraform ~> 1.7, AzureRM provider ~> 3.0, Azure CLI (for bootstrap)

---

## File Structure

```
terraform/
  main.tf                  # root: provider, RG, module calls
  variables.tf             # location, sp_principal_id
  outputs.tf               # swa_hostname, storage_account_name, keyvault_uri
  backend.tf               # azurerm remote state (workspace-aware)
  terraform.tfvars         # shared defaults
  nprod.tfvars             # nprod overrides
  prod.tfvars              # prod overrides
  modules/
    swa/
      main.tf              # azurerm_static_web_app (Standard, SystemAssigned identity)
      variables.tf
      outputs.tf           # hostname, principal_id
    storage/
      main.tf              # storage account (HNS enabled) + all tables
      variables.tf
      outputs.tf           # storage_account_name, primary_connection_string
    keyvault/
      main.tf              # key vault (RBAC) + role assignments
      variables.tf         # sp_principal_id, swa_principal_id
      outputs.tf           # vault_uri
  bootstrap/
    main.tf                # TF state storage account + SP (apply once, manually)
    outputs.tf             # sp_client_id, sp_object_id, storage_account_name
```

---

## Task 1: Bootstrap — TF State Storage + Service Principal

**Files:**
- Create: `terraform/bootstrap/main.tf`
- Create: `terraform/bootstrap/outputs.tf`

Bootstrap is run once manually. It creates the Azure resources needed before workspace Terraform can run.

- [ ] **Step 1: Create bootstrap main.tf**

```hcl
# terraform/bootstrap/main.tf
terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 2.0"
    }
  }
}

provider "azurerm" {
  features {}
}

provider "azuread" {}

data "azurerm_client_config" "current" {}
data "azuread_client_config" "current" {}

resource "azurerm_resource_group" "tfstate" {
  name     = "rg-publicserve-tfstate"
  location = "australiaeast"
}

resource "azurerm_storage_account" "tfstate" {
  name                     = "stpublicservettfstate"
  resource_group_name      = azurerm_resource_group.tfstate.name
  location                 = azurerm_resource_group.tfstate.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_storage_container" "tfstate" {
  name                  = "tfstate"
  storage_account_name  = azurerm_storage_account.tfstate.name
  container_access_type = "private"
}

resource "azuread_application" "cicd" {
  display_name = "sp-publicserve-cicd"
}

resource "azuread_service_principal" "cicd" {
  client_id = azuread_application.cicd.client_id
}

resource "azuread_service_principal_password" "cicd" {
  service_principal_id = azuread_service_principal.cicd.id
}

resource "azurerm_role_assignment" "cicd_contributor" {
  scope                = "/subscriptions/${data.azurerm_client_config.current.subscription_id}"
  role_definition_name = "Contributor"
  principal_id         = azuread_service_principal.cicd.object_id
}

resource "azurerm_role_assignment" "cicd_storage_contributor" {
  scope                = azurerm_storage_account.tfstate.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azuread_service_principal.cicd.object_id
}
```

- [ ] **Step 2: Create bootstrap outputs.tf**

```hcl
# terraform/bootstrap/outputs.tf
output "sp_client_id" {
  value     = azuread_application.cicd.client_id
  sensitive = false
}

output "sp_client_secret" {
  value     = azuread_service_principal_password.cicd.value
  sensitive = true
}

output "sp_object_id" {
  value = azuread_service_principal.cicd.object_id
}

output "tfstate_storage_account_name" {
  value = azurerm_storage_account.tfstate.name
}
```

- [ ] **Step 3: Apply bootstrap (run manually once)**

```bash
cd terraform/bootstrap
az login   # authenticate as an owner/admin of the subscription
terraform init
terraform apply
```

Expected: 6 resources created. Note the outputs:
```bash
terraform output sp_client_id       # → ARM_CLIENT_ID
terraform output -raw sp_client_secret  # → ARM_CLIENT_SECRET
terraform output sp_object_id       # → needed for keyvault module variable
```

Store these as GitHub Actions secrets (done in Phase 4 setup).

- [ ] **Step 4: Commit**

```bash
git add terraform/bootstrap/
git commit -m "feat(infra): add bootstrap module for TF state and SP"
```

---

## Task 2: Terraform Backend + Root Variables

**Files:**
- Create: `terraform/backend.tf`
- Create: `terraform/variables.tf`
- Create: `terraform/terraform.tfvars`
- Create: `terraform/nprod.tfvars`
- Create: `terraform/prod.tfvars`

- [ ] **Step 1: Create backend.tf**

```hcl
# terraform/backend.tf
terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }

  backend "azurerm" {
    resource_group_name  = "rg-publicserve-tfstate"
    storage_account_name = "stpublicservettfstate"
    container_name       = "tfstate"
    key                  = "publicserve.tfstate"
    # Workspace state files land at env:/<workspace>/publicserve.tfstate automatically
  }
}
```

- [ ] **Step 2: Create variables.tf**

```hcl
# terraform/variables.tf
variable "location" {
  description = "Azure region for all resources"
  type        = string
  default     = "australiaeast"
}

variable "sp_principal_id" {
  description = "Object ID of the CI/CD service principal (from bootstrap outputs)"
  type        = string
}
```

- [ ] **Step 3: Create tfvars files**

```hcl
# terraform/terraform.tfvars
location = "australiaeast"
```

```hcl
# terraform/nprod.tfvars
# nprod-specific overrides (currently none beyond defaults)
sp_principal_id = "REPLACE_WITH_BOOTSTRAP_SP_OBJECT_ID"
```

```hcl
# terraform/prod.tfvars
sp_principal_id = "REPLACE_WITH_BOOTSTRAP_SP_OBJECT_ID"
```

- [ ] **Step 4: Commit**

```bash
git add terraform/backend.tf terraform/variables.tf terraform/*.tfvars
git commit -m "feat(infra): add Terraform backend config and variables"
```

---

## Task 3: SWA Module

**Files:**
- Create: `terraform/modules/swa/main.tf`
- Create: `terraform/modules/swa/variables.tf`
- Create: `terraform/modules/swa/outputs.tf`

- [ ] **Step 1: Create modules/swa/variables.tf**

```hcl
# terraform/modules/swa/variables.tf
variable "prefix" {
  type = string
}

variable "environment" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}
```

- [ ] **Step 2: Create modules/swa/main.tf**

```hcl
# terraform/modules/swa/main.tf
resource "azurerm_static_web_app" "this" {
  name                = "swa-${var.prefix}-${var.environment}"
  resource_group_name = var.resource_group_name
  location            = var.location
  sku_tier            = "Standard"
  sku_size            = "Standard"

  identity {
    type = "SystemAssigned"
  }
}
```

- [ ] **Step 3: Create modules/swa/outputs.tf**

```hcl
# terraform/modules/swa/outputs.tf
output "hostname" {
  value = azurerm_static_web_app.this.default_host_name
}

output "principal_id" {
  description = "System-assigned managed identity object ID — used for Key Vault RBAC"
  value       = azurerm_static_web_app.this.identity[0].principal_id
}

output "api_key" {
  description = "Deployment token — store as AZURE_STATIC_WEB_APPS_API_TOKEN in GitHub Environment"
  value       = azurerm_static_web_app.this.api_key
  sensitive   = true
}
```

- [ ] **Step 4: Commit**

```bash
git add terraform/modules/swa/
git commit -m "feat(infra): add SWA Terraform module"
```

---

## Task 4: Storage Module

**Files:**
- Create: `terraform/modules/storage/main.tf`
- Create: `terraform/modules/storage/variables.tf`
- Create: `terraform/modules/storage/outputs.tf`

- [ ] **Step 1: Create modules/storage/variables.tf**

```hcl
# terraform/modules/storage/variables.tf
variable "prefix" {
  type = string
}

variable "environment" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}
```

- [ ] **Step 2: Create modules/storage/main.tf**

```hcl
# terraform/modules/storage/main.tf
resource "azurerm_storage_account" "this" {
  name                     = "st${var.prefix}${var.environment}"
  resource_group_name      = var.resource_group_name
  location                 = var.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  is_hns_enabled           = true  # ADLS Gen2 hierarchical namespace
}

locals {
  tables = [
    "Users",
    "Accounts",
    "Sessions",
    "VerificationTokens",
    "Groups",
    "UserGroups",
    "Orgs",
    "OrgGroups",
    "StorageLocations",
    "Records",
  ]
}

resource "azurerm_storage_table" "tables" {
  for_each             = toset(local.tables)
  name                 = each.key
  storage_account_name = azurerm_storage_account.this.name
}
```

- [ ] **Step 3: Create modules/storage/outputs.tf**

```hcl
# terraform/modules/storage/outputs.tf
output "storage_account_name" {
  value = azurerm_storage_account.this.name
}

output "primary_connection_string" {
  value     = azurerm_storage_account.this.primary_connection_string
  sensitive = true
}
```

- [ ] **Step 4: Commit**

```bash
git add terraform/modules/storage/
git commit -m "feat(infra): add storage account Terraform module"
```

---

## Task 5: Key Vault Module

**Files:**
- Create: `terraform/modules/keyvault/main.tf`
- Create: `terraform/modules/keyvault/variables.tf`
- Create: `terraform/modules/keyvault/outputs.tf`

- [ ] **Step 1: Create modules/keyvault/variables.tf**

```hcl
# terraform/modules/keyvault/variables.tf
variable "prefix" {
  type = string
}

variable "environment" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "sp_principal_id" {
  description = "Object ID of CI/CD SP — granted Key Vault Secrets Officer"
  type        = string
}

variable "swa_principal_id" {
  description = "Object ID of SWA managed identity — granted Key Vault Secrets User"
  type        = string
}
```

- [ ] **Step 2: Create modules/keyvault/main.tf**

```hcl
# terraform/modules/keyvault/main.tf
data "azurerm_client_config" "current" {}

resource "azurerm_key_vault" "this" {
  name                      = "kv-${var.prefix}-${var.environment}"
  location                  = var.location
  resource_group_name       = var.resource_group_name
  tenant_id                 = data.azurerm_client_config.current.tenant_id
  sku_name                  = "standard"
  enable_rbac_authorization = true
}

resource "azurerm_role_assignment" "sp_secrets_officer" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = var.sp_principal_id
}

resource "azurerm_role_assignment" "swa_secrets_user" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = var.swa_principal_id
}
```

- [ ] **Step 3: Create modules/keyvault/outputs.tf**

```hcl
# terraform/modules/keyvault/outputs.tf
output "vault_uri" {
  value = azurerm_key_vault.this.vault_uri
}

output "vault_id" {
  value = azurerm_key_vault.this.id
}
```

- [ ] **Step 4: Commit**

```bash
git add terraform/modules/keyvault/
git commit -m "feat(infra): add Key Vault Terraform module with RBAC assignments"
```

---

## Task 6: Root Module + Outputs

**Files:**
- Create: `terraform/main.tf`
- Create: `terraform/outputs.tf`

- [ ] **Step 1: Create terraform/main.tf**

```hcl
# terraform/main.tf
terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
}

locals {
  env    = terraform.workspace
  prefix = "publicserve"
}

resource "azurerm_resource_group" "main" {
  name     = "rg-${local.prefix}-${local.env}"
  location = var.location
}

module "swa" {
  source              = "./modules/swa"
  prefix              = local.prefix
  environment         = local.env
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
}

module "storage" {
  source              = "./modules/storage"
  prefix              = local.prefix
  environment         = local.env
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
}

module "keyvault" {
  source              = "./modules/keyvault"
  prefix              = local.prefix
  environment         = local.env
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  sp_principal_id     = var.sp_principal_id
  swa_principal_id    = module.swa.principal_id
}
```

- [ ] **Step 2: Create terraform/outputs.tf**

```hcl
# terraform/outputs.tf
output "swa_hostname" {
  value = module.swa.hostname
}

output "swa_api_key" {
  value     = module.swa.api_key
  sensitive = true
}

output "storage_account_name" {
  value = module.storage.storage_account_name
}

output "storage_connection_string" {
  value     = module.storage.primary_connection_string
  sensitive = true
}

output "keyvault_uri" {
  value = module.keyvault.vault_uri
}
```

- [ ] **Step 3: Commit**

```bash
git add terraform/main.tf terraform/outputs.tf
git commit -m "feat(infra): add root Terraform module wiring all components"
```

---

## Task 7: Validate + Plan

- [ ] **Step 1: Init and validate**

```bash
cd terraform

# Create workspaces and init backend (uses bootstrap-created storage)
terraform init
terraform workspace new nprod
terraform workspace new prod
terraform workspace select nprod

terraform fmt -recursive
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 2: Plan nprod**

```bash
terraform workspace select nprod
terraform plan -var-file=nprod.tfvars -out=nprod.plan
```

Review output. Expected: ~14 resources to add (RG, SWA, storage account, 10 tables, KV, 2 role assignments).

- [ ] **Step 3: Plan prod**

```bash
terraform workspace select prod
terraform plan -var-file=prod.tfvars -out=prod.plan
```

Expected: same resource count, different names.

- [ ] **Step 4: Apply nprod**

```bash
terraform workspace select nprod
terraform apply nprod.plan
```

Expected: Apply complete. Verify in Azure Portal that `rg-publicserve-nprod` exists with all resources.

- [ ] **Step 5: Capture outputs for use in Phase 2**

```bash
terraform output storage_connection_string  # → AZURE_TABLES_CONNECTION_STRING env var
terraform output keyvault_uri               # → AZURE_KEYVAULT_URI env var
terraform output -raw swa_api_key           # → AZURE_STATIC_WEB_APPS_API_TOKEN GitHub secret
```

- [ ] **Step 6: Add .gitignore entries**

```bash
cat >> .gitignore << 'EOF'
*.plan
.terraform/
.terraform.lock.hcl
EOF
git add .gitignore
git commit -m "chore: add .gitignore for Terraform artifacts"
```
