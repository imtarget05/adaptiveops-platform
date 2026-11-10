package com.adaptiveops.orderservice.domain.exception;

public class InvalidStateTransitionException extends BusinessValidationException {
    public InvalidStateTransitionException(String message) {
        super(message);
    }

    public InvalidStateTransitionException(Enum<?> from, Enum<?> to) {
        super(String.format("Invalid order state transition from %s to %s", from, to));
    }
}
