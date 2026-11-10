package com.adaptiveops.orderservice.service.dto;

import com.adaptiveops.orderservice.domain.model.Order;
import com.adaptiveops.orderservice.domain.model.OrderStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Schema(description = "Order response object")
public class OrderResponse {

    @Schema(description = "Order ID")
    private UUID id;

    @Schema(description = "Human-readable unique order number", example = "ORD-20261108-7A4B1")
    private String orderNumber;

    @Schema(description = "Customer ID", example = "cust-01")
    private String customerId;

    @Schema(description = "Customer email address", example = "devops@adaptiveops.internal")
    private String customerEmail;

    @Schema(description = "Current lifecycle status", example = "CREATED")
    private OrderStatus status;

    @Schema(description = "Order total amount", example = "99.98")
    private BigDecimal totalAmount;

    @Schema(description = "Currency", example = "USD")
    private String currency;

    @Schema(description = "Shipping delivery address", example = "100 Innovation Way, Cloud City")
    private String shippingAddress;

    @Schema(description = "Entity version for optimistic locking", example = "0")
    private Long version;

    @Schema(description = "Creation timestamp")
    private Instant createdAt;

    @Schema(description = "Last update timestamp")
    private Instant updatedAt;

    @Schema(description = "List of ordered items")
    private List<OrderItemResponse> items;

    public static OrderResponse fromEntity(Order order) {
        if (order == null) {
            return null;
        }
        List<OrderItemResponse> itemResponses = order.getItems() != null
                ? order.getItems().stream().map(OrderItemResponse::fromEntity).toList()
                : Collections.emptyList();

        return OrderResponse.builder()
                .id(order.getId())
                .orderNumber(order.getOrderNumber())
                .customerId(order.getCustomerId())
                .customerEmail(order.getCustomerEmail())
                .status(order.getStatus())
                .totalAmount(order.getTotalAmount())
                .currency(order.getCurrency())
                .shippingAddress(order.getShippingAddress())
                .version(order.getVersion())
                .createdAt(order.getCreatedAt())
                .updatedAt(order.getUpdatedAt())
                .items(itemResponses)
                .build();
    }
}
