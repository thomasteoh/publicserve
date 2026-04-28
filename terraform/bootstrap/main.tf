# terraform/bootstrap/main.tf
terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 2.0"
    }
  }
}

provider "azurerm" {
  features {}
}

provider "azuread" {}

data "azurerm_client_config" "current" {}
data "azuread_client_config" "current" {}

resource "azurerm_resource_group" "tfstate" {
  name     = "rg-publicserve-tfstate"
  location = "australiaeast"
}

resource "azurerm_storage_account" "tfstate" {
  name                     = "stpublicservettfstate"
  resource_group_name      = azurerm_resource_group.tfstate.name
  location                 = azurerm_resource_group.tfstate.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_storage_container" "tfstate" {
  name                  = "tfstate"
  storage_account_name  = azurerm_storage_account.tfstate.name
  container_access_type = "private"
}

resource "azuread_application" "cicd" {
  display_name = "sp-publicserve-cicd"
}

resource "azuread_service_principal" "cicd" {
  client_id = azuread_application.cicd.client_id
}

resource "azuread_service_principal_password" "cicd" {
  service_principal_id = azuread_service_principal.cicd.id
}

resource "azurerm_role_assignment" "cicd_contributor" {
  scope                = "/subscriptions/${data.azurerm_client_config.current.subscription_id}"
  role_definition_name = "Contributor"
  principal_id         = azuread_service_principal.cicd.object_id
}

resource "azurerm_role_assignment" "cicd_storage_contributor" {
  scope                = azurerm_storage_account.tfstate.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azuread_service_principal.cicd.object_id
}
