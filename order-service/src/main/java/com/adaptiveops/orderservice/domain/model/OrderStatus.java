package com.adaptiveops.orderservice.domain.model;

import com.adaptiveops.orderservice.domain.exception.InvalidStateTransitionException;

import java.util.Map;
import java.util.Set;

public enum OrderStatus {
    CREATED,
    PENDING,
    APPROVED,
    COMPLETED,
    CANCELLED;

    private static final Map<OrderStatus, Set<OrderStatus>> VALID_TRANSITIONS = Map.of(
        CREATED, Set.of(PENDING, CANCELLED),
        PENDING, Set.of(APPROVED, CANCELLED),
        APPROVED, Set.of(COMPLETED, CANCELLED),
        COMPLETED, Set.of(),
        CANCELLED, Set.of()
    );

    public boolean canTransitionTo(OrderStatus target) {
        if (target == null) {
            return false;
        }
        return VALID_TRANSITIONS.getOrDefault(this, Set.of()).contains(target);
    }

    public void validateTransition(OrderStatus target) {
        if (!canTransitionTo(target)) {
            throw new InvalidStateTransitionException(this, target);
        }
    }
}
