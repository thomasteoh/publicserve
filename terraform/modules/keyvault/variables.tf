variable "prefix" {
  description = "Resource name prefix (e.g. 'publicserve')"
  type        = string
}

variable "environment" {
  description = "Deployment environment — matches Terraform workspace name (e.g. 'nprod', 'prod')"
  type        = string
}

variable "resource_group_name" {
  description = "Name of the resource group to deploy into"
  type        = string
}

variable "location" {
  description = "Azure region for the Key Vault"
  type        = string
}

variable "sp_principal_id" {
  description = "Object ID of CI/CD SP — granted Key Vault Secrets Officer"
  type        = string
}

variable "swa_principal_id" {
  description = "Object ID of SWA managed identity — granted Key Vault Secrets User"
  type        = string
}
