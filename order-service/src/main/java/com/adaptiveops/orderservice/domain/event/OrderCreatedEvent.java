package com.adaptiveops.orderservice.domain.event;

import com.adaptiveops.orderservice.domain.model.OrderStatus;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@JsonIgnoreProperties(ignoreUnknown = true)
public record OrderCreatedEvent(
    UUID eventId,
    UUID orderId,
    String orderNumber,
    String customerId,
    String customerEmail,
    OrderStatus status,
    BigDecimal totalAmount,
    String currency,
    Instant occurredAt
) implements DomainEvent {

    public OrderCreatedEvent(UUID orderId, String orderNumber, String customerId, String customerEmail, OrderStatus status, BigDecimal totalAmount, String currency) {
        this(UUID.randomUUID(), orderId, orderNumber, customerId, customerEmail, status, totalAmount, currency, Instant.now());
    }

    @Override
    @JsonProperty("eventType")
    public String eventType() {
        return "ORDER_CREATED";
    }

    @Override
    @JsonProperty("aggregateId")
    public String aggregateId() {
        return orderId.toString();
    }

    @Override
    @JsonProperty("aggregateType")
    public String aggregateType() {
        return "Order";
    }
}
