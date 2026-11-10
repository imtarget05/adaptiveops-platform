package com.adaptiveops.orderservice.domain.event;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;
import java.util.UUID;

public interface DomainEvent {
    @JsonProperty("eventId")
    UUID eventId();

    @JsonProperty("eventType")
    String eventType();

    @JsonProperty("occurredAt")
    Instant occurredAt();

    @JsonProperty("aggregateId")
    String aggregateId();

    @JsonProperty("aggregateType")
    String aggregateType();
}
