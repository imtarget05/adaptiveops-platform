package com.adaptiveops.orderservice.integration;

import com.adaptiveops.orderservice.domain.exception.ConcurrentModificationException;
import com.adaptiveops.orderservice.domain.model.Order;
import com.adaptiveops.orderservice.domain.model.OrderStatus;
import com.adaptiveops.orderservice.repository.OrderRepository;
import com.adaptiveops.orderservice.service.OrderService;
import com.adaptiveops.orderservice.service.dto.CreateOrderItemRequest;
import com.adaptiveops.orderservice.service.dto.CreateOrderRequest;
import com.adaptiveops.orderservice.service.dto.OrderResponse;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.test.context.ActiveProfiles;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
class OrderConcurrencyIntegrationTest {

    @Autowired
    private OrderService orderService;

    @Autowired
    private OrderRepository orderRepository;

    @Test
    @DisplayName("Concurrent status updates on the same order produce an optimistic locking collision")
    void whenConcurrentUpdatesOnSameOrder_thenOptimisticLockFailureOccurs() throws Exception {
        // Arrange: Create and persist an order
        CreateOrderRequest createRequest = CreateOrderRequest.builder()
                .customerId("CUST-CONCURRENT")
                .customerEmail("concurrent@adaptiveops.internal")
                .items(List.of(
                        CreateOrderItemRequest.builder()
                                .sku("SKU-CONC-1")
                                .productName("Concurrent Item")
                                .unitPrice(new BigDecimal("25.00"))
                                .quantity(1)
                                .build()
                ))
                .build();

        OrderResponse created = orderService.createOrder(createRequest);
        UUID orderId = created.getId();
        Long initialVersion = created.getVersion();

        // Act: Concurrently attempt two conflicting status transitions using initialVersion
        int threadCount = 2;
        ExecutorService executor = Executors.newFixedThreadPool(threadCount);
        CountDownLatch readyLatch = new CountDownLatch(threadCount);
        CountDownLatch startLatch = new CountDownLatch(1);

        AtomicInteger successCount = new AtomicInteger(0);
        AtomicInteger conflictCount = new AtomicInteger(0);

        Callable<Void> task1 = () -> {
            readyLatch.countDown();
            readyLatch.await(5, TimeUnit.SECONDS);
            startLatch.await(5, TimeUnit.SECONDS);
            try {
                orderService.updateOrderStatus(orderId, OrderStatus.PENDING, initialVersion, "Approving payment");
                successCount.incrementAndGet();
            } catch (ObjectOptimisticLockingFailureException | ConcurrentModificationException ex) {
                conflictCount.incrementAndGet();
            }
            return null;
        };

        Callable<Void> task2 = () -> {
            readyLatch.countDown();
            readyLatch.await(5, TimeUnit.SECONDS);
            startLatch.await(5, TimeUnit.SECONDS);
            try {
                orderService.updateOrderStatus(orderId, OrderStatus.CANCELLED, initialVersion, "Cancelling payment");
                successCount.incrementAndGet();
            } catch (ObjectOptimisticLockingFailureException | ConcurrentModificationException ex) {
                conflictCount.incrementAndGet();
            }
            return null;
        };

        Future<Void> future1 = executor.submit(task1);
        Future<Void> future2 = executor.submit(task2);

        // Wait until both threads are primed and ready
        boolean ready = readyLatch.await(5, TimeUnit.SECONDS);
        assertThat(ready).isTrue();

        // Release both simultaneously
        startLatch.countDown();

        future1.get(10, TimeUnit.SECONDS);
        future2.get(10, TimeUnit.SECONDS);
        executor.shutdown();

        // Assert: Exactly one update succeeded, and exactly one hit optimistic locking conflict
        assertThat(successCount.get()).isEqualTo(1);
        assertThat(conflictCount.get()).isEqualTo(1);

        // Confirm DB state has version incremented to initialVersion + 1
        Order finalOrder = orderRepository.findById(orderId).orElseThrow();
        assertThat(finalOrder.getVersion()).isEqualTo(initialVersion + 1L);
        assertThat(finalOrder.getStatus()).isIn(OrderStatus.PENDING, OrderStatus.CANCELLED);
    }
}
