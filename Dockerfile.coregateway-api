FROM golang:1.27-alpine AS builder
WORKDIR /app
RUN apk add --no-cache git
# to use docker cache
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /server ./cmd/coregateway

FROM alpine:latest AS runner
WORKDIR /app
RUN apk --no-cache add ca-certificates
COPY --from=builder /server .
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
EXPOSE 8080

CMD ["./server"]
