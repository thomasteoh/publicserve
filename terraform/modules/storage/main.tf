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
