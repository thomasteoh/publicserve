terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }

  backend "azurerm" {
    resource_group_name  = "rg-publicserve-tfstate"
    storage_account_name = "stpublicservettfstate"
    container_name       = "tfstate"
    key                  = "publicserve.tfstate"
    # Workspace state files land at env:/<workspace>/publicserve.tfstate automatically
  }
}
