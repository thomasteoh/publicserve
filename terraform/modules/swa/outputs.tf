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
