# terraform/bootstrap/outputs.tf
output "sp_client_id" {
  description = "Application (client) ID of the CI/CD service principal"
  value       = azuread_application.cicd.client_id
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
