package com.adaptiveops.orderservice.domain;

import com.adaptiveops.orderservice.domain.exception.InvalidStateTransitionException;
import com.adaptiveops.orderservice.domain.model.OrderStatus;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OrderStatusTransitionTest {

    @ParameterizedTest
    @CsvSource({
            "CREATED, PENDING",
            "CREATED, CANCELLED",
            "PENDING, APPROVED",
            "PENDING, CANCELLED",
            "APPROVED, COMPLETED",
            "APPROVED, CANCELLED"
    })
    @DisplayName("Valid lifecycle state transitions are permitted")
    void validTransitions(OrderStatus from, OrderStatus to) {
        assertThat(from.canTransitionTo(to)).isTrue();
        from.validateTransition(to); // Should not throw
    }

    @ParameterizedTest
    @CsvSource({
            "CREATED, APPROVED",
            "CREATED, COMPLETED",
            "PENDING, COMPLETED",
            "PENDING, CREATED",
            "APPROVED, CREATED",
            "APPROVED, PENDING",
            "COMPLETED, CREATED",
            "COMPLETED, PENDING",
            "COMPLETED, APPROVED",
            "COMPLETED, CANCELLED",
            "CANCELLED, CREATED",
            "CANCELLED, PENDING",
            "CANCELLED, APPROVED",
            "CANCELLED, COMPLETED"
    })
    @DisplayName("Invalid state transitions are strictly rejected with InvalidStateTransitionException")
    void invalidTransitions(OrderStatus from, OrderStatus to) {
        assertThat(from.canTransitionTo(to)).isFalse();
        assertThatThrownBy(() -> from.validateTransition(to))
                .isInstanceOf(InvalidStateTransitionException.class)
                .hasMessageContaining(String.format("Invalid order state transition from %s to %s", from, to));
    }

    @Test
    @DisplayName("Null transition targets are rejected safely")
    void nullTargetTransition() {
        assertThat(OrderStatus.CREATED.canTransitionTo(null)).isFalse();
        assertThatThrownBy(() -> OrderStatus.CREATED.validateTransition(null))
                .isInstanceOf(InvalidStateTransitionException.class);
    }
}
