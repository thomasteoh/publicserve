variable "location" {
  description = "Azure region for all resources"
  type        = string
  default     = "australiaeast"
}

variable "sp_principal_id" {
  description = "Object ID of the CI/CD service principal (from bootstrap outputs)"
  type        = string
}
