package com.adaptiveops.orderservice.outbox;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.core.MessagePropertiesBuilder;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

@Component
@ConditionalOnProperty(name = "adaptiveops.outbox.enabled", havingValue = "true", matchIfMissing = true)
@Slf4j
public class OutboxPublisher {

    private final OutboxRepository outboxRepository;
    private final RabbitTemplate rabbitTemplate;
    private final String exchangeName;
    private final int maxRetries;
    private final int batchSize;

    private final Counter successCounter;
    private final Counter failureCounter;

    private static final Map<String, String> ROUTING_KEYS = Map.of(
            "ORDER_CREATED", "order.event.created",
            "ORDER_STATUS_CHANGED", "order.event.status-changed",
            "ORDER_CANCELLED", "order.event.cancelled"
    );

    public OutboxPublisher(OutboxRepository outboxRepository,
                           RabbitTemplate rabbitTemplate,
                           MeterRegistry meterRegistry,
                           @Value("${adaptiveops.rabbitmq.exchange:orders.topic.exchange}") String exchangeName,
                           @Value("${adaptiveops.outbox.max-retries:5}") int maxRetries,
                           @Value("${adaptiveops.outbox.batch-size:50}") int batchSize) {
        this.outboxRepository = outboxRepository;
        this.rabbitTemplate = rabbitTemplate;
        this.exchangeName = exchangeName;
        this.maxRetries = maxRetries;
        this.batchSize = batchSize;

        this.successCounter = meterRegistry.counter("outbox.dispatch.success");
        this.failureCounter = meterRegistry.counter("outbox.dispatch.failure");
    }

    @Scheduled(fixedDelayString = "${adaptiveops.outbox.polling-interval-ms:2000}")
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void publishPendingMessages() {
        List<OutboxMessage> messages;
        try {
            messages = outboxRepository.findPendingMessagesWithLock(maxRetries, batchSize);
        } catch (Exception e) {
            log.debug("Native FOR UPDATE SKIP LOCKED not supported or failed, using standard find: {}", e.getMessage());
            messages = outboxRepository.findTop50ByStatusAndRetryCountLessThanOrderByCreatedAtAsc(OutboxStatus.PENDING, maxRetries);
        }

        if (messages.isEmpty()) {
            return;
        }

        log.debug("Found {} pending outbox messages to dispatch", messages.size());

        for (OutboxMessage message : messages) {
            processMessage(message);
        }
    }

    public boolean processMessage(OutboxMessage message) {
        String routingKey = ROUTING_KEYS.getOrDefault(message.getEventType(), "order.event.general");
        CorrelationData correlationData = new CorrelationData(message.getId().toString());

        try {
            MessageProperties props = MessagePropertiesBuilder.newInstance()
                    .setContentType(MessageProperties.CONTENT_TYPE_JSON)
                    .setContentEncoding(StandardCharsets.UTF_8.name())
                    .setHeader("eventType", message.getEventType())
                    .setHeader("aggregateType", message.getAggregateType())
                    .setHeader("aggregateId", message.getAggregateId())
                    .setMessageId(message.getId().toString())
                    .setTimestamp(java.util.Date.from(message.getCreatedAt()))
                    .build();

            Message amqpMessage = new Message(message.getPayload().getBytes(StandardCharsets.UTF_8), props);

            rabbitTemplate.send(exchangeName, routingKey, amqpMessage, correlationData);

            // Wait for publisher confirm
            CorrelationData.Confirm confirm = correlationData.getFuture().get(5, TimeUnit.SECONDS);
            if (confirm != null && confirm.isAck()) {
                message.setStatus(OutboxStatus.SENT);
                message.setProcessedAt(Instant.now());
                message.setLastError(null);
                outboxRepository.save(message);
                successCounter.increment();
                log.info("Outbox message id={} published successfully to routingKey={}", message.getId(), routingKey);
                return true;
            } else {
                handleFailure(message, confirm != null ? confirm.getReason() : "Broker NACK or no response");
                return false;
            }
        } catch (Exception e) {
            log.error("Failed to publish outbox message id={}: {}", message.getId(), e.getMessage());
            handleFailure(message, e.getMessage());
            return false;
        }
    }

    private void handleFailure(OutboxMessage message, String errorReason) {
        message.setRetryCount(message.getRetryCount() + 1);
        message.setLastError(errorReason != null ? errorReason : "Unknown error");
        if (message.getRetryCount() >= maxRetries) {
            message.setStatus(OutboxStatus.FAILED);
            log.error("Outbox message id={} reached max retries ({}), marked as FAILED", message.getId(), maxRetries);
        }
        outboxRepository.save(message);
        failureCounter.increment();
    }
}
