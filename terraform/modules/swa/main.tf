# terraform/modules/swa/main.tf
resource "azurerm_static_web_app" "this" {
  name                = "swa-${var.prefix}-${var.environment}"
  resource_group_name = var.resource_group_name
  location            = var.location
  sku_tier            = "Standard"
  sku_size            = "Standard"

  identity {
    type = "SystemAssigned"
  }
}
