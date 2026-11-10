# Safety check preventing unapproved chargeable infrastructure provisioning
check "cost_guard_safety" {
  assert {
    condition     = var.plan_only == true && var.chargeable == false && var.enable_chargeable_resources == false
    error_message = "Cost guard violation: Any action provisioning chargeable cloud resources without authorization is strictly prohibited. plan_only must be true and chargeable must be false."
  }
}

locals {
  is_provisionable = var.chargeable && !var.plan_only && var.enable_chargeable_resources
}

resource "aws_security_group" "alb" {
  count       = local.is_provisionable ? 1 : 0
  name        = "adaptiveops-alb-sg-${var.environment}"
  description = "Security group for AdaptiveOps ALB"
  vpc_id      = var.vpc_id != "" ? var.vpc_id : null

  ingress {
    description = "HTTP ingress"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "ecs" {
  count       = local.is_provisionable ? 1 : 0
  name        = "adaptiveops-ecs-sg-${var.environment}"
  description = "Security group for AdaptiveOps ECS Tasks"
  vpc_id      = var.vpc_id != "" ? var.vpc_id : null

  ingress {
    description     = "Allow traffic from ALB"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb[0].id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_lb" "main" {
  count              = local.is_provisionable ? 1 : 0
  name               = "adaptiveops-alb-${var.environment}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb[0].id]
  subnets            = var.subnets
}

resource "aws_lb_target_group" "order_service" {
  count       = local.is_provisionable ? 1 : 0
  name        = "order-service-tg-${var.environment}"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = var.vpc_id != "" ? var.vpc_id : null
  target_type = "ip"

  health_check {
    path                = "/actuator/health"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  count             = local.is_provisionable ? 1 : 0
  load_balancer_arn = aws_lb.main[0].arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.order_service[0].arn
  }
}

resource "aws_ecs_cluster" "platform" {
  count = local.is_provisionable ? 1 : 0
  name  = "adaptiveops-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

resource "aws_ecs_task_definition" "order_service" {
  count                    = local.is_provisionable ? 1 : 0
  family                   = "order-service-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"

  container_definitions = jsonencode([
    {
      name      = "order-service"
      image     = "adaptiveops/order-service:${var.app_version}"
      essential = true
      user      = "10001:10001"
      portMappings = [
        {
          containerPort = 8080
          hostPort      = 8080
        }
      ]
      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:8080/actuator/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
      environment = [
        { name = "SPRING_PROFILES_ACTIVE", value = "aws" }
      ]
    }
  ])
}

resource "aws_ecs_service" "order_service" {
  count           = local.is_provisionable ? 1 : 0
  name            = "order-service"
  cluster         = aws_ecs_cluster.platform[0].id
  task_definition = aws_ecs_task_definition.order_service[0].arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnets
    security_groups  = [aws_security_group.ecs[0].id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.order_service[0].arn
    container_name   = "order-service"
    container_port   = 8080
  }
}
