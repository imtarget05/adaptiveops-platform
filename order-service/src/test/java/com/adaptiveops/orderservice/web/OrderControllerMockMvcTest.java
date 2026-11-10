package com.adaptiveops.orderservice.web;

import com.adaptiveops.orderservice.domain.exception.OrderNotFoundException;
import com.adaptiveops.orderservice.domain.model.Order;
import com.adaptiveops.orderservice.domain.model.OrderStatus;
import com.adaptiveops.orderservice.service.OrderService;
import com.adaptiveops.orderservice.service.dto.CreateOrderItemRequest;
import com.adaptiveops.orderservice.service.dto.CreateOrderRequest;
import com.adaptiveops.orderservice.service.dto.OrderItemResponse;
import com.adaptiveops.orderservice.service.dto.OrderResponse;
import com.adaptiveops.orderservice.service.dto.UpdateOrderStatusRequest;
import com.adaptiveops.orderservice.web.error.GlobalExceptionHandler;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(controllers = OrderController.class)
@AutoConfigureMockMvc(addFilters = false)
@Import(GlobalExceptionHandler.class)
@org.springframework.test.context.ActiveProfiles("test")
class OrderControllerMockMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private OrderService orderService;

    @MockBean
    private com.adaptiveops.orderservice.idempotency.IdempotencyRepository idempotencyRepository;

    @Test
    @DisplayName("POST /api/v1/orders returns 201 Created on valid order creation")
    void testCreateOrderSuccess() throws Exception {
        UUID orderId = UUID.randomUUID();
        CreateOrderRequest request = CreateOrderRequest.builder()
                .customerId("cust-01")
                .customerEmail("cust01@adaptiveops.internal")
                .items(List.of(
                        CreateOrderItemRequest.builder()
                                .sku("SKU-01")
                                .productName("Item 1")
                                .unitPrice(new BigDecimal("49.99"))
                                .quantity(2)
                                .build()
                ))
                .totalAmount(new BigDecimal("99.98"))
                .build();

        OrderResponse expectedResponse = OrderResponse.builder()
                .id(orderId)
                .orderNumber("ORD-TEST-001")
                .customerId("cust-01")
                .customerEmail("cust01@adaptiveops.internal")
                .status(OrderStatus.CREATED)
                .totalAmount(new BigDecimal("99.98"))
                .currency("USD")
                .version(0L)
                .createdAt(Instant.now())
                .updatedAt(Instant.now())
                .items(List.of(
                        OrderItemResponse.builder()
                                .id(UUID.randomUUID())
                                .sku("SKU-01")
                                .productName("Item 1")
                                .unitPrice(new BigDecimal("49.99"))
                                .quantity(2)
                                .lineTotal(new BigDecimal("99.98"))
                                .build()
                ))
                .build();

        when(orderService.createOrder(any(CreateOrderRequest.class))).thenReturn(expectedResponse);

        mockMvc.perform(post("/api/v1/orders")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value(orderId.toString()))
                .andExpect(jsonPath("$.orderNumber").value("ORD-TEST-001"))
                .andExpect(jsonPath("$.status").value("CREATED"))
                .andExpect(jsonPath("$.totalAmount").value(99.98))
                .andExpect(jsonPath("$.items[0].sku").value("SKU-01"));
    }

    @Test
    @DisplayName("POST /api/v1/orders returns 400 Bad Request when customerId is blank")
    void testCreateOrderValidationFailure() throws Exception {
        CreateOrderRequest invalidRequest = CreateOrderRequest.builder()
                .customerId("") // Blank
                .items(List.of(
                        CreateOrderItemRequest.builder()
                                .sku("SKU-01")
                                .unitPrice(new BigDecimal("10.00"))
                                .quantity(1)
                                .build()
                ))
                .build();

        mockMvc.perform(post("/api/v1/orders")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(invalidRequest)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.title").value("Validation Failed"));
    }

    @Test
    @DisplayName("GET /api/v1/orders/{id} returns 404 Not Found Problem Details when missing")
    void testGetOrderNotFound() throws Exception {
        UUID orderId = UUID.randomUUID();
        when(orderService.getOrderById(orderId)).thenThrow(new OrderNotFoundException(orderId));

        mockMvc.perform(get("/api/v1/orders/{id}", orderId))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.title").value("Order Not Found"))
                .andExpect(jsonPath("$.status").value(404));
    }

    @Test
    @DisplayName("PUT /api/v1/orders/{id}/status returns 409 Conflict Problem Details on optimistic locking failure")
    void testUpdateOrderStatusOptimisticLockConflict() throws Exception {
        UUID orderId = UUID.randomUUID();
        UpdateOrderStatusRequest request = UpdateOrderStatusRequest.builder()
                .status(OrderStatus.PENDING)
                .version(1L)
                .build();

        when(orderService.updateOrderStatus(eq(orderId), eq(OrderStatus.PENDING), eq(1L), any()))
                .thenThrow(new ObjectOptimisticLockingFailureException(Order.class, orderId));

        mockMvc.perform(put("/api/v1/orders/{id}/status", orderId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.title").value("Concurrent Modification Conflict"))
                .andExpect(jsonPath("$.status").value(409))
                .andExpect(jsonPath("$.type").value("https://adaptiveops.internal/errors/concurrent-modification"));
    }
}
