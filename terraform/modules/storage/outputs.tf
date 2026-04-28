output "storage_account_name" {
  value = azurerm_storage_account.this.name
}

output "primary_connection_string" {
  value     = azurerm_storage_account.this.primary_connection_string
  sensitive = true
}
