package com.adaptiveops.orderservice.domain.event;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;
import java.util.UUID;

@JsonIgnoreProperties(ignoreUnknown = true)
public record OrderCancelledEvent(
    UUID eventId,
    UUID orderId,
    String orderNumber,
    String reason,
    Long version,
    Instant occurredAt
) implements DomainEvent {

    public OrderCancelledEvent(UUID orderId, String orderNumber, String reason, Long version) {
        this(UUID.randomUUID(), orderId, orderNumber, reason, version, Instant.now());
    }

    @Override
    @JsonProperty("eventType")
    public String eventType() {
        return "ORDER_CANCELLED";
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
