package com.adaptiveops.orderservice.service.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Schema(description = "Order item creation payload")
public class CreateOrderItemRequest {

    @NotBlank(message = "SKU is required")
    @Schema(description = "Stock keeping unit", example = "SKU-01")
    private String sku;

    @Schema(description = "Product display name", example = "Cloud Operations Handbook")
    private String productName;

    @NotNull(message = "Unit price is required")
    @DecimalMin(value = "0.01", message = "Unit price must be greater than zero")
    @Schema(description = "Unit price of item", example = "49.99")
    private BigDecimal unitPrice;

    @NotNull(message = "Quantity is required")
    @Min(value = 1, message = "Quantity must be at least 1")
    @Schema(description = "Item quantity", example = "2")
    private Integer quantity;
}
