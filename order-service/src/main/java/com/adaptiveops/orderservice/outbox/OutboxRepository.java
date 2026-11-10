package com.adaptiveops.orderservice.outbox;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface OutboxRepository extends JpaRepository<OutboxMessage, UUID> {

    @Query(value = "SELECT * FROM outbox_messages WHERE status = 'PENDING' AND retry_count < :maxRetries ORDER BY created_at ASC LIMIT :batchSize FOR UPDATE SKIP LOCKED", nativeQuery = true)
    List<OutboxMessage> findPendingMessagesWithLock(@Param("maxRetries") int maxRetries, @Param("batchSize") int batchSize);

    List<OutboxMessage> findTop50ByStatusAndRetryCountLessThanOrderByCreatedAtAsc(OutboxStatus status, int maxRetries);

    List<OutboxMessage> findByAggregateId(String aggregateId);

    long countByStatus(OutboxStatus status);
}
