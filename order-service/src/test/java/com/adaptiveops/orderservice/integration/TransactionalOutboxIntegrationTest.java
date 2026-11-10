package com.adaptiveops.orderservice.integration;

import com.adaptiveops.orderservice.domain.model.OrderStatus;
import com.adaptiveops.orderservice.outbox.OutboxMessage;
import com.adaptiveops.orderservice.outbox.OutboxPublisher;
import com.adaptiveops.orderservice.outbox.OutboxRepository;
import com.adaptiveops.orderservice.outbox.OutboxStatus;
import com.adaptiveops.orderservice.repository.OrderRepository;
import com.adaptiveops.orderservice.service.OrderService;
import com.adaptiveops.orderservice.service.dto.CreateOrderItemRequest;
import com.adaptiveops.orderservice.service.dto.CreateOrderRequest;
import com.adaptiveops.orderservice.service.dto.OrderResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;

import java.math.BigDecimal;
import java.util.List;
import java.util.concurrent.CompletableFuture;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;

@SpringBootTest(properties = {
        "adaptiveops.outbox.enabled=true",
        "adaptiveops.outbox.polling-interval-ms=60000"
})
@ActiveProfiles("test")
class TransactionalOutboxIntegrationTest {

    @Autowired
    private OrderService orderService;

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private OutboxRepository outboxRepository;

    @Autowired
    private OutboxPublisher outboxPublisher;

    @MockBean
    private RabbitTemplate rabbitTemplate;

    @BeforeEach
    void setUp() {
        orderRepository.deleteAll();
        outboxRepository.deleteAll();
    }

    @Test
    @DisplayName("Creating order atomically writes OutboxMessage and OutboxPublisher transitions status to SENT upon ACK")
    void testAtomicOrderCreationAndOutboxDispatch() {
        // Mock rabbitTemplate to simulate broker ACK
        doAnswer(invocation -> {
            CorrelationData correlationData = invocation.getArgument(3);
            if (correlationData != null) {
                correlationData.getFuture().complete(new CorrelationData.Confirm(true, null));
            }
            return null;
        }).when(rabbitTemplate).send(anyString(), anyString(), any(), any(CorrelationData.class));

        CreateOrderRequest request = CreateOrderRequest.builder()
                .customerId("CUST-OUTBOX-1")
                .customerEmail("outbox1@adaptiveops.internal")
                .items(List.of(
                        CreateOrderItemRequest.builder()
                                .sku("SKU-OUTBOX-1")
                                .productName("Outbox Widget")
                                .unitPrice(new BigDecimal("100.00"))
                                .quantity(1)
                                .build()
                ))
                .build();

        // 1. Create order
        OrderResponse response = orderService.createOrder(request);

        // 2. Verify Order exists in database
        assertThat(orderRepository.findById(response.getId())).isPresent();

        // 3. Verify OutboxMessage was saved atomically in PENDING status
        List<OutboxMessage> messages = outboxRepository.findByAggregateId(response.getId().toString());
        assertThat(messages).hasSize(1);
        OutboxMessage outboxMsg = messages.get(0);
        assertThat(outboxMsg.getStatus()).isEqualTo(OutboxStatus.PENDING);
        assertThat(outboxMsg.getEventType()).isEqualTo("ORDER_CREATED");
        assertThat(outboxMsg.getPayload()).contains("ORDER_CREATED");
        assertThat(outboxMsg.getPayload()).contains(response.getId().toString());

        // 4. Trigger OutboxPublisher to process message
        boolean processed = outboxPublisher.processMessage(outboxMsg);
        assertThat(processed).isTrue();

        // 5. Verify message updated to SENT in database
        OutboxMessage updatedMsg = outboxRepository.findById(outboxMsg.getId()).orElseThrow();
        assertThat(updatedMsg.getStatus()).isEqualTo(OutboxStatus.SENT);
        assertThat(updatedMsg.getProcessedAt()).isNotNull();
        assertThat(updatedMsg.getLastError()).isNull();
    }

    @Test
    @DisplayName("OutboxPublisher retries and increments retryCount when broker NACKs or fails")
    void testOutboxFailureAndRetry() {
        // Mock rabbitTemplate to simulate broker NACK
        doAnswer(invocation -> {
            CorrelationData correlationData = invocation.getArgument(3);
            if (correlationData != null) {
                correlationData.getFuture().complete(new CorrelationData.Confirm(false, "Simulated broker NACK"));
            }
            return null;
        }).when(rabbitTemplate).send(anyString(), anyString(), any(), any(CorrelationData.class));

        CreateOrderRequest request = CreateOrderRequest.builder()
                .customerId("CUST-OUTBOX-RETRY")
                .customerEmail("retry@adaptiveops.internal")
                .items(List.of(
                        CreateOrderItemRequest.builder()
                                .sku("SKU-OUTBOX-2")
                                .productName("Retry Widget")
                                .unitPrice(new BigDecimal("50.00"))
                                .quantity(1)
                                .build()
                ))
                .build();

        OrderResponse response = orderService.createOrder(request);
        OutboxMessage outboxMsg = outboxRepository.findByAggregateId(response.getId().toString()).get(0);

        boolean processed = outboxPublisher.processMessage(outboxMsg);
        assertThat(processed).isFalse();

        OutboxMessage updatedMsg = outboxRepository.findById(outboxMsg.getId()).orElseThrow();
        assertThat(updatedMsg.getStatus()).isEqualTo(OutboxStatus.PENDING);
        assertThat(updatedMsg.getRetryCount()).isEqualTo(1);
        assertThat(updatedMsg.getLastError()).contains("Simulated broker NACK");
    }
}
