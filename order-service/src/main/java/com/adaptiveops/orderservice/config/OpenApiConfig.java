package com.adaptiveops.orderservice.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import io.swagger.v3.oas.models.parameters.HeaderParameter;
import io.swagger.v3.oas.models.servers.Server;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI orderOpenAPI() {
        return new OpenAPI()
                .info(new Info()
                        .title("AdaptiveOps Order Service API")
                        .version("1.0.0")
                        .description("High-reliability backend workload service demonstrating DDD order lifecycle, " +
                                "optimistic locking, idempotent requests, and transactional outbox event publishing.")
                        .contact(new Contact()
                                .name("AdaptiveOps Engineering")
                                .email("devops@adaptiveops.internal"))
                        .license(new License().name("Apache 2.0").url("https://www.apache.org/licenses/LICENSE-2.0")))
                .servers(List.of(
                        new Server().url("/").description("Current Environment Server")
                ))
                .components(new Components()
                        .addParameters("Idempotency-Key", new HeaderParameter()
                                .name("Idempotency-Key")
                                .description("Unique client-supplied idempotency key (UUID) to guard against duplicate mutations")
                                .required(false)));
    }
}
