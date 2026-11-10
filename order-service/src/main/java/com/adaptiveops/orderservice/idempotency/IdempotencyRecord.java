package com.adaptiveops.orderservice.idempotency;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;

@Entity
@Table(name = "idempotency_records")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@EqualsAndHashCode(of = "idempotencyKey")
public class IdempotencyRecord {

    @Id
    @Column(name = "idempotency_key", length = 128, nullable = false)
    private String idempotencyKey;

    @Column(name = "request_hash", length = 64, nullable = false)
    private String requestHash;

    @Column(name = "request_path", length = 255, nullable = false)
    private String requestPath;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 32, nullable = false)
    private IdempotencyStatus status;

    @Column(name = "response_status_code")
    private Integer responseStatusCode;

    @Column(name = "response_body", columnDefinition = "TEXT")
    private String responseBody;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "locked_until", nullable = false)
    private Instant lockedUntil;

    @PrePersist
    public void prePersist() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
        if (lockedUntil == null) {
            lockedUntil = createdAt.plusSeconds(60);
        }
    }
}
