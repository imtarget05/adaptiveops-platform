package com.adaptiveops.orderservice.service;

import com.adaptiveops.orderservice.domain.event.DomainEvent;
import com.adaptiveops.orderservice.domain.event.OrderCancelledEvent;
import com.adaptiveops.orderservice.domain.event.OrderCreatedEvent;
import com.adaptiveops.orderservice.domain.event.OrderStatusChangedEvent;
import com.adaptiveops.orderservice.domain.exception.BusinessValidationException;
import com.adaptiveops.orderservice.domain.exception.OrderNotFoundException;
import com.adaptiveops.orderservice.domain.model.Order;
import com.adaptiveops.orderservice.domain.model.OrderItem;
import com.adaptiveops.orderservice.domain.model.OrderStatus;
import com.adaptiveops.orderservice.outbox.OutboxService;
import com.adaptiveops.orderservice.repository.OrderRepository;
import com.adaptiveops.orderservice.service.dto.CreateOrderItemRequest;
import com.adaptiveops.orderservice.service.dto.CreateOrderRequest;
import com.adaptiveops.orderservice.service.dto.OrderResponse;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
@Slf4j
public class OrderServiceImpl implements OrderService {

    private final OrderRepository orderRepository;
    private final OutboxService outboxService;
    private final MeterRegistry meterRegistry;
    private final Counter orderCreatedCounter;

    public OrderServiceImpl(OrderRepository orderRepository,
                            OutboxService outboxService,
                            MeterRegistry meterRegistry) {
        this.orderRepository = orderRepository;
        this.outboxService = outboxService;
        this.meterRegistry = meterRegistry;
        this.orderCreatedCounter = meterRegistry.counter("orders.created.total", "status", "SUCCESS");
    }

    @Override
    @Transactional(
            isolation = Isolation.READ_COMMITTED,
            propagation = Propagation.REQUIRED,
            rollbackFor = Exception.class
    )
    public OrderResponse createOrder(CreateOrderRequest request) {
        if (request == null) {
            throw new BusinessValidationException("CreateOrderRequest cannot be null");
        }
        if (request.getItems() == null || request.getItems().isEmpty()) {
            throw new BusinessValidationException("Order must contain at least one item");
        }

        String email = request.getCustomerEmail();
        if (email == null || email.isBlank()) {
            email = request.getCustomerId() + "@adaptiveops.internal";
        }

        Order order = Order.builder()
                .id(UUID.randomUUID())
                .customerId(request.getCustomerId())
                .customerEmail(email)
                .status(OrderStatus.CREATED)
                .currency(request.getCurrency() != null && !request.getCurrency().isBlank() ? request.getCurrency() : "USD")
                .shippingAddress(request.getShippingAddress())
                .createdAt(Instant.now())
                .updatedAt(Instant.now())
                .version(0L)
                .build();

        for (CreateOrderItemRequest itemDto : request.getItems()) {
            String prodName = itemDto.getProductName();
            if (prodName == null || prodName.isBlank()) {
                prodName = "Product " + itemDto.getSku();
            }
            OrderItem item = OrderItem.builder()
                    .id(UUID.randomUUID())
                    .sku(itemDto.getSku())
                    .productName(prodName)
                    .unitPrice(itemDto.getUnitPrice())
                    .quantity(itemDto.getQuantity())
                    .build();
            order.addItem(item);
        }

        if (request.getTotalAmount() != null) {
            order.setTotalAmount(request.getTotalAmount());
        } else {
            order.recalculateTotal();
        }

        Order savedOrder = orderRepository.save(order);

        // Atomic outbox persistence inside the same transaction
        DomainEvent createdEvent = new OrderCreatedEvent(
                savedOrder.getId(),
                savedOrder.getOrderNumber(),
                savedOrder.getCustomerId(),
                savedOrder.getCustomerEmail(),
                savedOrder.getStatus(),
                savedOrder.getTotalAmount(),
                savedOrder.getCurrency()
        );
        outboxService.saveEvent(createdEvent);

        orderCreatedCounter.increment();
        log.info("Order created successfully with id={}, orderNumber={}", savedOrder.getId(), savedOrder.getOrderNumber());

        return OrderResponse.fromEntity(savedOrder);
    }

    @Override
    @Transactional(readOnly = true)
    public OrderResponse getOrderById(UUID id) {
        Order order = orderRepository.findById(id)
                .orElseThrow(() -> new OrderNotFoundException(id));
        return OrderResponse.fromEntity(order);
    }

    @Override
    @Transactional(readOnly = true)
    public OrderResponse getOrderByOrderNumber(String orderNumber) {
        Order order = orderRepository.findByOrderNumber(orderNumber)
                .orElseThrow(() -> new OrderNotFoundException(orderNumber));
        return OrderResponse.fromEntity(order);
    }

    @Override
    @Transactional(readOnly = true)
    public List<OrderResponse> getOrdersByCustomerId(String customerId) {
        return orderRepository.findByCustomerId(customerId).stream()
                .map(OrderResponse::fromEntity)
                .toList();
    }

    @Override
    @Transactional(
            isolation = Isolation.READ_COMMITTED,
            propagation = Propagation.REQUIRED,
            rollbackFor = Exception.class
    )
    public OrderResponse updateOrderStatus(UUID id, OrderStatus newStatus, Long expectedVersion, String reason) {
        Order order = orderRepository.findById(id)
                .orElseThrow(() -> new OrderNotFoundException(id));

        // Optimistic locking manual guard if expectedVersion passed
        if (expectedVersion != null && !expectedVersion.equals(order.getVersion())) {
            log.warn("Optimistic locking conflict on order id={}: expected version={}, actual version={}",
                    id, expectedVersion, order.getVersion());
            throw new ObjectOptimisticLockingFailureException(Order.class, id);
        }

        OrderStatus previousStatus = order.getStatus();
        order.transitionTo(newStatus);
        Order updatedOrder = orderRepository.saveAndFlush(order);

        // Record metrics
        meterRegistry.counter("orders.transition.total",
                "from", previousStatus.name(),
                "to", newStatus.name()).increment();

        // Atomic outbox persistence
        DomainEvent event;
        if (newStatus == OrderStatus.CANCELLED) {
            event = new OrderCancelledEvent(
                    updatedOrder.getId(),
                    updatedOrder.getOrderNumber(),
                    reason != null ? reason : "Cancelled by user request",
                    updatedOrder.getVersion()
            );
        } else {
            event = new OrderStatusChangedEvent(
                    updatedOrder.getId(),
                    updatedOrder.getOrderNumber(),
                    previousStatus,
                    newStatus,
                    updatedOrder.getVersion()
            );
        }
        outboxService.saveEvent(event);

        log.info("Order id={} transitioned from {} to {}", id, previousStatus, newStatus);
        return OrderResponse.fromEntity(updatedOrder);
    }
}
