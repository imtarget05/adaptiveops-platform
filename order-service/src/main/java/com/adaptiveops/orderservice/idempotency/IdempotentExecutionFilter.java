package com.adaptiveops.orderservice.idempotency;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ContentCachingResponseWrapper;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Optional;
import java.util.Set;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
@RequiredArgsConstructor
@Slf4j
public class IdempotentExecutionFilter extends OncePerRequestFilter {

    public static final String IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
    private static final Set<String> MUTATING_METHODS = Set.of("POST", "PUT", "PATCH");

    private final IdempotencyRepository idempotencyRepository;
    private final ObjectMapper objectMapper;

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        if (path.startsWith("/actuator") || path.startsWith("/swagger-ui") || path.startsWith("/v3/api-docs")) {
            return true;
        }
        return !MUTATING_METHODS.contains(request.getMethod());
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {

        String idempotencyKey = request.getHeader(IDEMPOTENCY_KEY_HEADER);
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            filterChain.doFilter(request, response);
            return;
        }

        CachedBodyHttpServletRequest cachedRequest = new CachedBodyHttpServletRequest(request);
        String requestHash = computePayloadHash(cachedRequest);
        String requestPath = request.getRequestURI();

        Optional<IdempotencyRecord> existingOpt = idempotencyRepository.findById(idempotencyKey);
        if (existingOpt.isPresent()) {
            IdempotencyRecord existing = existingOpt.get();

            // Guard against conflicting payloads using the same key
            if (!existing.getRequestHash().equals(requestHash)) {
                log.warn("Idempotency conflict for key {}: payload hash mismatch", idempotencyKey);
                writeProblemDetail(response, HttpStatus.UNPROCESSABLE_ENTITY,
                        "Idempotency Conflict",
                        "Idempotency-Key reuse with conflicting request payload",
                        URI.create("https://adaptiveops.internal/errors/idempotency-conflict"));
                return;
            }

            if (existing.getStatus() == IdempotencyStatus.COMPLETED) {
                log.info("Returning cached response for idempotency key: {}", idempotencyKey);
                response.setStatus(existing.getResponseStatusCode() != null ? existing.getResponseStatusCode() : 200);
                response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                response.setHeader("X-Cache-Lookup", "HIT-IDEMPOTENT");
                if (existing.getResponseBody() != null) {
                    response.getOutputStream().write(existing.getResponseBody().getBytes(StandardCharsets.UTF_8));
                }
                return;
            }

            if (existing.getStatus() == IdempotencyStatus.PROCESSING) {
                if (existing.getLockedUntil() != null && existing.getLockedUntil().isAfter(Instant.now())) {
                    log.warn("In-flight request detected for idempotency key: {}", idempotencyKey);
                    writeProblemDetail(response, HttpStatus.CONFLICT,
                            "Concurrent Request",
                            "A request with this Idempotency-Key is currently being processed",
                            URI.create("https://adaptiveops.internal/errors/concurrent-idempotent-request"));
                    return;
                }
            }
        }

        // Register in-progress record
        IdempotencyRecord inProgressRecord = IdempotencyRecord.builder()
                .idempotencyKey(idempotencyKey)
                .requestHash(requestHash)
                .requestPath(requestPath)
                .status(IdempotencyStatus.PROCESSING)
                .createdAt(Instant.now())
                .lockedUntil(Instant.now().plusSeconds(60))
                .build();
        idempotencyRepository.saveAndFlush(inProgressRecord);

        ContentCachingResponseWrapper wrappedResponse = new ContentCachingResponseWrapper(response);
        try {
            filterChain.doFilter(cachedRequest, wrappedResponse);

            int status = wrappedResponse.getStatus();
            byte[] responseBytes = wrappedResponse.getContentAsByteArray();
            String responseBody = new String(responseBytes, StandardCharsets.UTF_8);

            if (status >= 200 && status < 400) {
                inProgressRecord.setStatus(IdempotencyStatus.COMPLETED);
                inProgressRecord.setResponseStatusCode(status);
                inProgressRecord.setResponseBody(responseBody);
                idempotencyRepository.save(inProgressRecord);
            } else {
                // Delete failed attempt to allow client retry
                idempotencyRepository.deleteById(idempotencyKey);
            }
        } catch (Exception ex) {
            log.error("Exception occurred during idempotent request execution for key {}", idempotencyKey, ex);
            idempotencyRepository.deleteById(idempotencyKey);
            throw ex;
        } finally {
            wrappedResponse.copyBodyToResponse();
        }
    }

    private String computePayloadHash(CachedBodyHttpServletRequest request) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(request.getMethod().getBytes(StandardCharsets.UTF_8));
            digest.update((byte) ':');
            digest.update(request.getRequestURI().getBytes(StandardCharsets.UTF_8));
            digest.update((byte) ':');
            digest.update(request.getCachedBody());
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 algorithm not available", e);
        }
    }

    private void writeProblemDetail(HttpServletResponse response,
                                    HttpStatus status,
                                    String title,
                                    String detail,
                                    URI type) throws IOException {
        ProblemDetail problemDetail = ProblemDetail.forStatusAndDetail(status, detail);
        problemDetail.setTitle(title);
        problemDetail.setType(type);
        problemDetail.setProperty("timestamp", Instant.now().toString());

        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.getOutputStream().write(objectMapper.writeValueAsBytes(problemDetail));
    }
}
