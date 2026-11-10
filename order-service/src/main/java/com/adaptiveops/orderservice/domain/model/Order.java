package com.adaptiveops.orderservice.domain.model;

import com.adaptiveops.orderservice.domain.exception.BusinessValidationException;
import jakarta.persistence.*;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.*;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "orders")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@EqualsAndHashCode(of = "id")
public class Order {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @NotBlank
    @Column(name = "order_number", nullable = false, unique = true, length = 64)
    private String orderNumber;

    @NotBlank
    @Column(name = "customer_id", nullable = false, length = 64)
    private String customerId;

    @NotBlank
    @Column(name = "customer_email", nullable = false)
    private String customerEmail;

    @NotNull
    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 32)
    private OrderStatus status;

    @NotNull
    @DecimalMin("0.00")
    @Column(name = "total_amount", nullable = false, precision = 14, scale = 2)
    private BigDecimal totalAmount;

    @NotBlank
    @Column(name = "currency", nullable = false, length = 3)
    @Builder.Default
    private String currency = "USD";

    @Column(name = "shipping_address")
    private String shippingAddress;

    @Version
    @Column(name = "version", nullable = false)
    @Builder.Default
    private Long version = 0L;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    @Builder.Default
    private List<OrderItem> items = new ArrayList<>();

    @PrePersist
    public void prePersist() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        if (orderNumber == null || orderNumber.isBlank()) {
            orderNumber = generateOrderNumber();
        }
        if (status == null) {
            status = OrderStatus.CREATED;
        }
        if (currency == null) {
            currency = "USD";
        }
        if (createdAt == null) {
            createdAt = Instant.now();
        }
        updatedAt = Instant.now();
        recalculateTotal();
    }

    @PreUpdate
    public void preUpdate() {
        updatedAt = Instant.now();
    }

    public void addItem(OrderItem item) {
        if (item == null) {
            throw new BusinessValidationException("Order item cannot be null");
        }
        if (item.getId() == null) {
            item.setId(UUID.randomUUID());
        }
        item.setOrder(this);
        if (this.items == null) {
            this.items = new ArrayList<>();
        }
        this.items.add(item);
        item.recalculateLineTotal();
        recalculateTotal();
    }

    public void removeItem(OrderItem item) {
        if (item != null && this.items != null) {
            this.items.remove(item);
            item.setOrder(null);
            recalculateTotal();
        }
    }

    public void recalculateTotal() {
        if (items == null || items.isEmpty()) {
            if (totalAmount == null) {
                totalAmount = BigDecimal.ZERO.setScale(2, RoundingMode.HALF_UP);
            }
            return;
        }
        BigDecimal sum = BigDecimal.ZERO;
        for (OrderItem item : items) {
            item.recalculateLineTotal();
            if (item.getLineTotal() != null) {
                sum = sum.add(item.getLineTotal());
            }
        }
        this.totalAmount = sum.setScale(2, RoundingMode.HALF_UP);
    }

    public void transitionTo(OrderStatus nextStatus) {
        if (nextStatus == null) {
            throw new BusinessValidationException("Target order status cannot be null");
        }
        this.status.validateTransition(nextStatus);
        this.status = nextStatus;
        this.updatedAt = Instant.now();
    }

    private String generateOrderNumber() {
        return "ORD-" + System.currentTimeMillis() + "-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    }
}
