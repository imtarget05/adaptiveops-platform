package com.adaptiveops.orderservice.integration;

import com.adaptiveops.orderservice.idempotency.IdempotencyRepository;
import com.adaptiveops.orderservice.repository.OrderRepository;
import com.adaptiveops.orderservice.service.dto.CreateOrderItemRequest;
import com.adaptiveops.orderservice.service.dto.CreateOrderRequest;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class IdempotencyIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private IdempotencyRepository idempotencyRepository;

    @BeforeEach
    void setUp() {
        orderRepository.deleteAll();
        idempotencyRepository.deleteAll();
    }

    @Test
    @DisplayName("Duplicate request with same Idempotency-Key returns cached response without duplicate DB order")
    void whenDuplicateRequestWithSameKey_thenSecondRequestReturnsCachedResponse() throws Exception {
        String idempotencyKey = UUID.randomUUID().toString();
        CreateOrderRequest request = CreateOrderRequest.builder()
                .customerId("CUST-IDEM-01")
                .customerEmail("idem@adaptiveops.internal")
                .items(List.of(
                        CreateOrderItemRequest.builder()
                                .sku("SKU-IDEM-1")
                                .productName("Idempotency Item")
                                .unitPrice(new BigDecimal("99.99"))
                                .quantity(1)
                                .build()
                ))
                .build();

        String payload = objectMapper.writeValueAsString(request);

        // First request: Should execute order creation and return 201 Created
        MvcResult firstResult = mockMvc.perform(post("/api/v1/orders")
                        .header("Idempotency-Key", idempotencyKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload))
                .andExpect(status().isCreated())
                .andReturn();

        long orderCountAfterFirst = orderRepository.count();
        assertThat(orderCountAfterFirst).isEqualTo(1);

        // Second request: Same key, same payload -> returns cached response (201 Created)
        MvcResult secondResult = mockMvc.perform(post("/api/v1/orders")
                        .header("Idempotency-Key", idempotencyKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload))
                .andExpect(status().isCreated())
                .andExpect(header().string("X-Cache-Lookup", "HIT-IDEMPOTENT"))
                .andReturn();

        long orderCountAfterSecond = orderRepository.count();
        // Assert: Database count remains exactly 1!
        assertThat(orderCountAfterSecond).isEqualTo(1);

        // Assert: Responses have identical body contents
        assertThat(secondResult.getResponse().getContentAsString())
                .isEqualTo(firstResult.getResponse().getContentAsString());
    }

    @Test
    @DisplayName("Reusing an Idempotency-Key with conflicting payload is rejected with 422 Unprocessable Entity")
    void whenReusingKeyWithConflictingPayload_thenRejectedWith422() throws Exception {
        String idempotencyKey = UUID.randomUUID().toString();
        CreateOrderRequest request1 = CreateOrderRequest.builder()
                .customerId("CUST-ORIGINAL")
                .customerEmail("orig@adaptiveops.internal")
                .items(List.of(
                        CreateOrderItemRequest.builder()
                                .sku("SKU-ORIG")
                                .unitPrice(new BigDecimal("10.00"))
                                .quantity(1)
                                .build()
                ))
                .build();

        // First request: succeeds
        mockMvc.perform(post("/api/v1/orders")
                        .header("Idempotency-Key", idempotencyKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request1)))
                .andExpect(status().isCreated());

        // Conflicting request reusing the same key with different payload
        CreateOrderRequest request2 = CreateOrderRequest.builder()
                .customerId("CUST-DIFFERENT")
                .customerEmail("different@adaptiveops.internal")
                .items(List.of(
                        CreateOrderItemRequest.builder()
                                .sku("SKU-DIFF")
                                .unitPrice(new BigDecimal("20.00"))
                                .quantity(2)
                                .build()
                ))
                .build();

        mockMvc.perform(post("/api/v1/orders")
                        .header("Idempotency-Key", idempotencyKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request2)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.title").value("Idempotency Conflict"))
                .andExpect(jsonPath("$.detail").value("Idempotency-Key reuse with conflicting request payload"));

        // Only 1 order exists in database
        assertThat(orderRepository.count()).isEqualTo(1);
    }
}
