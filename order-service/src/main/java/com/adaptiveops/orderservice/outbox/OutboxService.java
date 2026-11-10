package com.adaptiveops.orderservice.outbox;

import com.adaptiveops.orderservice.domain.event.DomainEvent;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class OutboxService {

    private final OutboxRepository outboxRepository;
    private final ObjectMapper objectMapper;

    @Transactional(propagation = Propagation.MANDATORY)
    public OutboxMessage saveEvent(DomainEvent event) {
        try {
            String payloadJson = objectMapper.writeValueAsString(event);
            OutboxMessage message = OutboxMessage.builder()
                    .id(UUID.randomUUID())
                    .aggregateType(event.aggregateType())
                    .aggregateId(event.aggregateId())
                    .eventType(event.eventType())
                    .payload(payloadJson)
                    .status(OutboxStatus.PENDING)
                    .retryCount(0)
                    .createdAt(Instant.now())
                    .build();

            OutboxMessage saved = outboxRepository.save(message);
            log.info("Saved outbox message id={} for eventType={}", saved.getId(), saved.getEventType());
            return saved;
        } catch (JsonProcessingException e) {
            log.error("Failed to serialize domain event: {}", event, e);
            throw new IllegalArgumentException("Could not serialize event to JSON", e);
        }
    }
}
