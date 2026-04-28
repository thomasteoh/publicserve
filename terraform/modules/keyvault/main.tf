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
