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
