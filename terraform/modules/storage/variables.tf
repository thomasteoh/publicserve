# terraform/modules/storage/variables.tf
variable "prefix" {
  description = "Resource name prefix (e.g. 'publicserve'). Combined with environment must be ≤22 chars to keep storage account name ≤24 chars."
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
  description = "Azure region for the storage account"
  type        = string
}
