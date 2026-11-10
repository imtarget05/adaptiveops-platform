package com.adaptiveops.orderservice.service;

import com.adaptiveops.orderservice.domain.event.DomainEvent;
import com.adaptiveops.orderservice.domain.exception.BusinessValidationException;
import com.adaptiveops.orderservice.domain.exception.OrderNotFoundException;
import com.adaptiveops.orderservice.domain.model.Order;
import com.adaptiveops.orderservice.domain.model.OrderStatus;
import com.adaptiveops.orderservice.outbox.OutboxService;
import com.adaptiveops.orderservice.repository.OrderRepository;
import com.adaptiveops.orderservice.service.dto.CreateOrderItemRequest;
import com.adaptiveops.orderservice.service.dto.CreateOrderRequest;
import com.adaptiveops.orderservice.service.dto.OrderResponse;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.orm.ObjectOptimisticLockingFailureException;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class OrderServiceImplTest {

    @Mock
    private OrderRepository orderRepository;

    @Mock
    private OutboxService outboxService;

    @Mock
    private MeterRegistry meterRegistry;

    @Mock
    private Counter counter;

    private OrderServiceImpl orderService;

    @BeforeEach
    void setUp() {
        when(meterRegistry.counter(anyString(), any(String[].class))).thenReturn(counter);
        orderService = new OrderServiceImpl(orderRepository, outboxService, meterRegistry);
    }

    @Test
    @DisplayName("createOrder validates items, saves entity, records outbox event, and returns response")
    void testCreateOrder() {
        CreateOrderRequest request = CreateOrderRequest.builder()
                .customerId("CUST-100")
                .customerEmail("cust100@adaptiveops.internal")
                .items(List.of(
                        CreateOrderItemRequest.builder()
                                .sku("SKU-01")
                                .productName("Item 1")
                                .unitPrice(new BigDecimal("49.99"))
                                .quantity(2)
                                .build()
                ))
                .build();

        when(orderRepository.save(any(Order.class))).thenAnswer(invocation -> invocation.getArgument(0));

        OrderResponse response = orderService.createOrder(request);

        assertThat(response).isNotNull();
        assertThat(response.getCustomerId()).isEqualTo("CUST-100");
        assertThat(response.getStatus()).isEqualTo(OrderStatus.CREATED);
        assertThat(response.getTotalAmount()).isEqualByComparingTo("99.98");
        assertThat(response.getItems()).hasSize(1);

        verify(orderRepository).save(any(Order.class));
        verify(outboxService).saveEvent(any(DomainEvent.class));
        verify(counter).increment();
    }

    @Test
    @DisplayName("createOrder throws BusinessValidationException when request items list is empty")
    void testCreateOrderEmptyItems() {
        CreateOrderRequest request = CreateOrderRequest.builder()
                .customerId("CUST-100")
                .items(List.of())
                .build();

        assertThatThrownBy(() -> orderService.createOrder(request))
                .isInstanceOf(BusinessValidationException.class)
                .hasMessageContaining("Order must contain at least one item");

        verifyNoInteractions(orderRepository);
        verifyNoInteractions(outboxService);
    }

    @Test
    @DisplayName("getOrderById throws OrderNotFoundException when order does not exist")
    void testGetOrderByIdNotFound() {
        UUID id = UUID.randomUUID();
        when(orderRepository.findById(id)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> orderService.getOrderById(id))
                .isInstanceOf(OrderNotFoundException.class)
                .hasMessageContaining(id.toString());
    }

    @Test
    @DisplayName("updateOrderStatus fails with ObjectOptimisticLockingFailureException when expectedVersion differs")
    void testUpdateOrderStatusOptimisticLockFailure() {
        UUID orderId = UUID.randomUUID();
        Order existingOrder = Order.builder()
                .id(orderId)
                .customerId("CUST-1")
                .customerEmail("c@test.com")
                .status(OrderStatus.CREATED)
                .version(2L)
                .build();

        when(orderRepository.findById(orderId)).thenReturn(Optional.of(existingOrder));

        // Client passed expectedVersion = 1, but db has version = 2
        assertThatThrownBy(() -> orderService.updateOrderStatus(orderId, OrderStatus.PENDING, 1L, null))
                .isInstanceOf(ObjectOptimisticLockingFailureException.class);

        verify(orderRepository, never()).saveAndFlush(any());
        verifyNoInteractions(outboxService);
    }

    @Test
    @DisplayName("updateOrderStatus succeeds when expectedVersion matches and emits status changed event")
    void testUpdateOrderStatusSuccess() {
        UUID orderId = UUID.randomUUID();
        Order existingOrder = Order.builder()
                .id(orderId)
                .orderNumber("ORD-123")
                .customerId("CUST-1")
                .customerEmail("c@test.com")
                .status(OrderStatus.CREATED)
                .version(1L)
                .build();

        when(orderRepository.findById(orderId)).thenReturn(Optional.of(existingOrder));
        when(orderRepository.saveAndFlush(any(Order.class))).thenAnswer(invocation -> invocation.getArgument(0));

        OrderResponse response = orderService.updateOrderStatus(orderId, OrderStatus.PENDING, 1L, "Payment processing");

        assertThat(response.getStatus()).isEqualTo(OrderStatus.PENDING);
        verify(orderRepository).saveAndFlush(existingOrder);

        ArgumentCaptor<DomainEvent> eventCaptor = ArgumentCaptor.forClass(DomainEvent.class);
        verify(outboxService).saveEvent(eventCaptor.capture());
        assertThat(eventCaptor.getValue().eventType()).isEqualTo("ORDER_STATUS_CHANGED");
    }
}
