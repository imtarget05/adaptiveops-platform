package com.adaptiveops.orderservice.service;

import com.adaptiveops.orderservice.domain.model.OrderStatus;
import com.adaptiveops.orderservice.service.dto.CreateOrderRequest;
import com.adaptiveops.orderservice.service.dto.OrderResponse;

import java.util.List;
import java.util.UUID;

public interface OrderService {
    OrderResponse createOrder(CreateOrderRequest request);
    OrderResponse getOrderById(UUID id);
    OrderResponse getOrderByOrderNumber(String orderNumber);
    List<OrderResponse> getOrdersByCustomerId(String customerId);
    OrderResponse updateOrderStatus(UUID id, OrderStatus newStatus, Long expectedVersion, String reason);
}
