package com.adaptiveops.orderservice.idempotency;

public enum IdempotencyStatus {
    PROCESSING,
    COMPLETED,
    FAILED
}
