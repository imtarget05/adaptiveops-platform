package com.adaptiveops.orderservice.domain.event;

import com.adaptiveops.orderservice.domain.model.OrderStatus;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;
import java.util.UUID;

@JsonIgnoreProperties(ignoreUnknown = true)
public record OrderStatusChangedEvent(
    UUID eventId,
    UUID orderId,
    String orderNumber,
    OrderStatus previousStatus,
    OrderStatus newStatus,
    Long version,
    Instant occurredAt
) implements DomainEvent {

    public OrderStatusChangedEvent(UUID orderId, String orderNumber, OrderStatus previousStatus, OrderStatus newStatus, Long version) {
        this(UUID.randomUUID(), orderId, orderNumber, previousStatus, newStatus, version, Instant.now());
    }

    @Override
    @JsonProperty("eventType")
    public String eventType() {
        return "ORDER_STATUS_CHANGED";
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
