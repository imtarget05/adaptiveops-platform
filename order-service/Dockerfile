# -------------------------------------------------------------
# Stage 1: Build Application with JDK 21
# -------------------------------------------------------------
FROM eclipse-temurin:21-jdk-alpine AS builder

WORKDIR /build

# Copy Maven wrapper and descriptor to leverage Docker caching
COPY pom.xml mvnw ./
COPY .mvn .mvn

RUN chmod +x mvnw && ./mvnw dependency:go-offline -B

# Copy source code and package executable fat JAR
COPY src src
RUN ./mvnw clean package -DskipTests -B

# -------------------------------------------------------------
# Stage 2: Hardened Secure Runtime with JRE 21 (Non-Root)
# -------------------------------------------------------------
FROM eclipse-temurin:21-jre-alpine AS runtime

# Install wget and ca-certificates for health checks
RUN apk add --no-cache wget ca-certificates

# Security: Create unprivileged user (UID 10001, GID 10001)
ENV APP_USER=appuser
ENV APP_UID=10001
ENV APP_GID=10001

RUN addgroup -g ${APP_GID} ${APP_USER} && \
    adduser -u ${APP_UID} -G ${APP_USER} -s /sbin/nologin -D ${APP_USER}

WORKDIR /app

# Copy packaged JAR from builder stage with proper ownership
COPY --from=builder --chown=appuser:appuser /build/target/*.jar app.jar

# Run container as non-root user
USER 10001:10001

# Container-aware JVM memory and garbage collection flags
ENV JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0 -XX:InitialRAMPercentage=50.0 -XX:+ExitOnOutOfMemoryError -Djava.security.egd=file:/dev/./urandom"

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --retries=3 --start-period=20s \
  CMD wget -q -O - http://localhost:8080/actuator/health/liveness || exit 1

ENTRYPOINT ["/bin/sh", "-c", "if [ $# -gt 0 ]; then exec \"$@\"; else exec java $JAVA_OPTS -jar /app/app.jar; fi", "--"]
