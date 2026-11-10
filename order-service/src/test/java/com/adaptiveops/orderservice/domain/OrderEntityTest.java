package com.adaptiveops.orderservice.domain;

import com.adaptiveops.orderservice.domain.model.Order;
import com.adaptiveops.orderservice.domain.model.OrderItem;
import com.adaptiveops.orderservice.domain.model.OrderStatus;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class OrderEntityTest {

    @Test
    @DisplayName("Adding items recalculates line total and order total amount")
    void testItemCalculations() {
        Order order = Order.builder()
                .customerId("CUST-1")
                .customerEmail("cust@test.com")
                .status(OrderStatus.CREATED)
                .build();

        OrderItem item1 = OrderItem.builder()
                .sku("SKU-1")
                .productName("Widget 1")
                .unitPrice(new BigDecimal("19.99"))
                .quantity(2)
                .build();

        OrderItem item2 = OrderItem.builder()
                .sku("SKU-2")
                .productName("Widget 2")
                .unitPrice(new BigDecimal("9.50"))
                .quantity(1)
                .build();

        order.addItem(item1);
        order.addItem(item2);

        assertThat(item1.getLineTotal()).isEqualByComparingTo("39.98");
        assertThat(item2.getLineTotal()).isEqualByComparingTo("9.50");
        assertThat(order.getTotalAmount()).isEqualByComparingTo("49.48");
        assertThat(order.getItems()).hasSize(2);

        order.removeItem(item2);
        assertThat(order.getTotalAmount()).isEqualByComparingTo("39.98");
        assertThat(order.getItems()).hasSize(1);
    }

    @Test
    @DisplayName("PrePersist initializes default values and orderNumber")
    void testPrePersist() {
        Order order = Order.builder()
                .customerId("CUST-1")
                .customerEmail("cust@test.com")
                .build();

        order.prePersist();

        assertThat(order.getId()).isNotNull();
        assertThat(order.getOrderNumber()).startsWith("ORD-");
        assertThat(order.getStatus()).isEqualTo(OrderStatus.CREATED);
        assertThat(order.getCurrency()).isEqualTo("USD");
        assertThat(order.getCreatedAt()).isNotNull();
        assertThat(order.getUpdatedAt()).isNotNull();
    }
}
