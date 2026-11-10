package com.adaptiveops.orderservice.service.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Schema(description = "Order creation request payload")
public class CreateOrderRequest {

    @NotBlank(message = "Customer ID is required")
    @Schema(description = "Identifier of customer placing the order", example = "cust-01")
    private String customerId;

    @Schema(description = "Customer email address", example = "devops@adaptiveops.internal")
    private String customerEmail;

    @NotEmpty(message = "At least one order item is required")
    @Valid
    @Schema(description = "List of items in the order")
    private List<CreateOrderItemRequest> items;

    @Schema(description = "Total amount for the order (auto-calculated if omitted)", example = "99.98")
    private BigDecimal totalAmount;

    @Schema(description = "ISO 4217 Currency code", example = "USD", defaultValue = "USD")
    private String currency;

    @Schema(description = "Shipping delivery address", example = "100 Innovation Way, Cloud City")
    private String shippingAddress;
}
