package com.adaptiveops.orderservice.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.core.*;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@Slf4j
public class RabbitMQConfig {

    @Value("${adaptiveops.rabbitmq.exchange:orders.topic.exchange}")
    private String exchangeName;

    @Value("${adaptiveops.rabbitmq.dead-letter-exchange:orders.dlx}")
    private String deadLetterExchangeName;

    @Value("${adaptiveops.rabbitmq.dead-letter-queue:orders.dead-letter.queue}")
    private String deadLetterQueueName;

    @Bean
    public TopicExchange ordersTopicExchange() {
        return ExchangeBuilder.topicExchange(exchangeName)
                .durable(true)
                .build();
    }

    @Bean
    public DirectExchange deadLetterExchange() {
        return ExchangeBuilder.directExchange(deadLetterExchangeName)
                .durable(true)
                .build();
    }

    @Bean
    public Queue deadLetterQueue() {
        return QueueBuilder.durable(deadLetterQueueName).build();
    }

    @Bean
    public Binding deadLetterBinding(Queue deadLetterQueue, DirectExchange deadLetterExchange) {
        return BindingBuilder.bind(deadLetterQueue)
                .to(deadLetterExchange)
                .with("order.dead-letter");
    }

    @Bean
    public Queue ordersEventQueue() {
        return QueueBuilder.durable("orders.events.queue")
                .withArgument("x-dead-letter-exchange", deadLetterExchangeName)
                .withArgument("x-dead-letter-routing-key", "order.dead-letter")
                .build();
    }

    @Bean
    public Binding ordersEventBinding(Queue ordersEventQueue, TopicExchange ordersTopicExchange) {
        return BindingBuilder.bind(ordersEventQueue)
                .to(ordersTopicExchange)
                .with("order.event.#");
    }

    @Bean
    public MessageConverter jsonMessageConverter(ObjectMapper objectMapper) {
        return new Jackson2JsonMessageConverter(objectMapper);
    }

    @Bean
    public RabbitTemplate rabbitTemplate(ConnectionFactory connectionFactory, MessageConverter messageConverter) {
        RabbitTemplate template = new RabbitTemplate(connectionFactory);
        template.setMessageConverter(messageConverter);
        template.setMandatory(true);

        template.setReturnsCallback(returned -> {
            log.error("RabbitMQ returned message: replyCode={}, replyText={}, exchange={}, routingKey={}",
                    returned.getReplyCode(), returned.getReplyText(), returned.getExchange(), returned.getRoutingKey());
        });

        template.setConfirmCallback((correlationData, ack, cause) -> {
            if (ack) {
                log.debug("RabbitMQ message ACK received for correlation: {}", correlationData != null ? correlationData.getId() : "null");
            } else {
                log.error("RabbitMQ message NACK received for correlation: {}, cause: {}", correlationData != null ? correlationData.getId() : "null", cause);
            }
        });

        return template;
    }
}
