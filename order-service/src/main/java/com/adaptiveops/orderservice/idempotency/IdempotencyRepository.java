package com.adaptiveops.orderservice.idempotency;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.Optional;

@Repository
public interface IdempotencyRepository extends JpaRepository<IdempotencyRecord, String> {

    @Modifying
    @Query("UPDATE IdempotencyRecord r SET r.status = :status, r.responseStatusCode = :code, r.responseBody = :body WHERE r.idempotencyKey = :key")
    int markCompleted(@Param("key") String key, @Param("status") IdempotencyStatus status, @Param("code") int code, @Param("body") String body);

    @Modifying
    @Query("DELETE FROM IdempotencyRecord r WHERE r.lockedUntil < :now AND r.status = 'PROCESSING'")
    int cleanExpiredProcessingRecords(@Param("now") Instant now);
}
