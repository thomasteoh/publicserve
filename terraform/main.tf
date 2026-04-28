# terraform/main.tf
terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
}

locals {
  env    = terraform.workspace
  prefix = "publicserve"
}

resource "azurerm_resource_group" "main" {
  name     = "rg-${local.prefix}-${local.env}"
  location = var.location
}

module "swa" {
  source              = "./modules/swa"
  prefix              = local.prefix
  environment         = local.env
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
}

module "storage" {
  source              = "./modules/storage"
  prefix              = local.prefix
  environment         = local.env
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
}

module "keyvault" {
  source              = "./modules/keyvault"
  prefix              = local.prefix
  environment         = local.env
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  sp_principal_id     = var.sp_principal_id
  swa_principal_id    = module.swa.principal_id
}
