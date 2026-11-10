package com.adaptiveops.orderservice;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
class OrderServiceApplicationTests {

    @Test
    @DisplayName("Spring application context loads successfully")
    void contextLoads() {
        assertThat(true).isTrue();
    }
}
