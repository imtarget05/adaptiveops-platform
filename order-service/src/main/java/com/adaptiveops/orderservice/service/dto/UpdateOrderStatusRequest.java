package com.adaptiveops.orderservice.service.dto;

import com.adaptiveops.orderservice.domain.model.OrderStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Schema(description = "Order status update request")
public class UpdateOrderStatusRequest {

    @NotNull(message = "Target status is required")
    @Schema(description = "Target status for the order lifecycle transition", example = "PENDING")
    private OrderStatus status;

    @Schema(description = "Expected entity version for optimistic locking verification", example = "0")
    private Long version;

    @Schema(description = "Reason for state update (mandatory if cancelling)", example = "Payment authorized")
    private String reason;
}
