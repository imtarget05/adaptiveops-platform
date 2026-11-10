package com.adaptiveops.orderservice.service.dto;

import com.adaptiveops.orderservice.domain.model.OrderItem;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.UUID;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Schema(description = "Order line item details")
public class OrderItemResponse {

    @Schema(description = "Item ID")
    private UUID id;

    @Schema(description = "Stock keeping unit", example = "SKU-01")
    private String sku;

    @Schema(description = "Product display name", example = "Cloud Operations Handbook")
    private String productName;

    @Schema(description = "Unit price", example = "49.99")
    private BigDecimal unitPrice;

    @Schema(description = "Quantity", example = "2")
    private Integer quantity;

    @Schema(description = "Calculated line total", example = "99.98")
    private BigDecimal lineTotal;

    public static OrderItemResponse fromEntity(OrderItem item) {
        if (item == null) {
            return null;
        }
        return OrderItemResponse.builder()
                .id(item.getId())
                .sku(item.getSku())
                .productName(item.getProductName())
                .unitPrice(item.getUnitPrice())
                .quantity(item.getQuantity())
                .lineTotal(item.getLineTotal())
                .build();
    }
}
