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
