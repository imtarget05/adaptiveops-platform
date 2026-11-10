package com.adaptiveops.orderservice.web;

import com.adaptiveops.orderservice.domain.model.OrderStatus;
import com.adaptiveops.orderservice.service.OrderService;
import com.adaptiveops.orderservice.service.dto.CreateOrderRequest;
import com.adaptiveops.orderservice.service.dto.OrderResponse;
import com.adaptiveops.orderservice.service.dto.UpdateOrderStatusRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.enums.ParameterIn;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/orders")
@RequiredArgsConstructor
@Slf4j
@Tag(name = "Orders", description = "Order Lifecycle Management APIs")
public class OrderController {

    private final OrderService orderService;

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            summary = "Create a new Order",
            description = "Creates a new order in CREATED state. Supports idempotent execution via Idempotency-Key header.",
            parameters = {
                    @Parameter(
                            name = "Idempotency-Key",
                            in = ParameterIn.HEADER,
                            required = false,
                            description = "Unique client transaction identifier (UUID) to guarantee idempotent execution"
                    )
            }
    )
    @ApiResponses({
            @ApiResponse(responseCode = "201", description = "Order created successfully",
                    content = @Content(schema = @Schema(implementation = OrderResponse.class))),
            @ApiResponse(responseCode = "400", description = "Invalid request payload",
                    content = @Content(schema = @Schema(implementation = ProblemDetail.class))),
            @ApiResponse(responseCode = "409", description = "Concurrent request in-flight for idempotency key",
                    content = @Content(schema = @Schema(implementation = ProblemDetail.class))),
            @ApiResponse(responseCode = "422", description = "Idempotency key payload mismatch",
                    content = @Content(schema = @Schema(implementation = ProblemDetail.class)))
    })
    public ResponseEntity<OrderResponse> createOrder(
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @Valid @RequestBody CreateOrderRequest request) {

        log.info("Received createOrder request for customerId={}", request.getCustomerId());
        OrderResponse response = orderService.createOrder(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @GetMapping(value = "/{id}", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Get Order by ID", description = "Retrieves an order by its unique UUID")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Order found",
                    content = @Content(schema = @Schema(implementation = OrderResponse.class))),
            @ApiResponse(responseCode = "404", description = "Order not found",
                    content = @Content(schema = @Schema(implementation = ProblemDetail.class)))
    })
    public ResponseEntity<OrderResponse> getOrderById(@PathVariable("id") UUID id) {
        log.debug("Fetching order id={}", id);
        OrderResponse response = orderService.getOrderById(id);
        return ResponseEntity.ok(response);
    }

    @GetMapping(value = "/by-number/{orderNumber}", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Get Order by Order Number", description = "Retrieves an order by its business order number")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Order found",
                    content = @Content(schema = @Schema(implementation = OrderResponse.class))),
            @ApiResponse(responseCode = "404", description = "Order not found",
                    content = @Content(schema = @Schema(implementation = ProblemDetail.class)))
    })
    public ResponseEntity<OrderResponse> getOrderByOrderNumber(@PathVariable("orderNumber") String orderNumber) {
        log.debug("Fetching order by number={}", orderNumber);
        OrderResponse response = orderService.getOrderByOrderNumber(orderNumber);
        return ResponseEntity.ok(response);
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "List Orders by Customer ID", description = "Retrieves all orders placed by a specific customer")
    @ApiResponse(responseCode = "200", description = "List of customer orders")
    public ResponseEntity<List<OrderResponse>> getOrdersByCustomer(@RequestParam("customerId") String customerId) {
        log.debug("Fetching orders for customerId={}", customerId);
        List<OrderResponse> orders = orderService.getOrdersByCustomerId(customerId);
        return ResponseEntity.ok(orders);
    }

    @PutMapping(value = "/{id}/status", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            summary = "Update Order Lifecycle Status",
            description = "Transitions an order to a new lifecycle status with optimistic locking conflict protection."
    )
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Order status updated",
                    content = @Content(schema = @Schema(implementation = OrderResponse.class))),
            @ApiResponse(responseCode = "400", description = "Invalid transition or payload",
                    content = @Content(schema = @Schema(implementation = ProblemDetail.class))),
            @ApiResponse(responseCode = "404", description = "Order not found",
                    content = @Content(schema = @Schema(implementation = ProblemDetail.class))),
            @ApiResponse(responseCode = "409", description = "Optimistic locking collision detected",
                    content = @Content(schema = @Schema(implementation = ProblemDetail.class))),
            @ApiResponse(responseCode = "422", description = "Invalid state transition attempted",
                    content = @Content(schema = @Schema(implementation = ProblemDetail.class)))
    })
    public ResponseEntity<OrderResponse> updateOrderStatus(
            @PathVariable("id") UUID id,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @Valid @RequestBody UpdateOrderStatusRequest request) {

        Long expectedVersion = request.getVersion();
        if (ifMatch != null && !ifMatch.isBlank()) {
            try {
                String cleanHeader = ifMatch.replace("\"", "").trim();
                expectedVersion = Long.parseLong(cleanHeader);
            } catch (NumberFormatException e) {
                log.warn("Invalid If-Match header value: {}", ifMatch);
            }
        }

        log.info("Updating status for order id={} to {} with expectedVersion={}", id, request.getStatus(), expectedVersion);
        OrderResponse response = orderService.updateOrderStatus(id, request.getStatus(), expectedVersion, request.getReason());
        return ResponseEntity.ok(response);
    }
}
