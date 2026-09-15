# ==============================================================================
# API Gateway - Go Backend Makefile
# ==============================================================================
#
# Prerequisites:
# - Go 1.21+
# - sqlc: go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
# - swag: go install github.com/swaggo/swag/cmd/swag@latest
# - goose: go install github.com/pressly/goose/v3/cmd/goose@latest
#
# Environment Variables:
# - DATABASE_URL (required): PostgreSQL connection string
# - PORT (optional, default 8080): Server port
# - ENV (optional, default development): Environment
# - FRONTEND_URL (optional): CORS origin
#
# ==============================================================================

# Colors for output
RED = \033[0;31m
GREEN = \033[0;32m
YELLOW = \033[1;33m
BLUE = \033[0;34m
CYAN = \033[0;36m
NC = \033[0m # No Color

# Default environment
ENV ?= development
PORT ?= 8080

# Database configuration
GOOSE_DRIVER=postgres
GOOSE_MIGRATION_DIR=./internal/db/migrations

# Build configuration
BINARY_NAME=api-gateway
BUILD_DIR=./bin

# ==============================================================================
# Help
# ==============================================================================

help:
	@echo ""
	@echo -e "${BLUE}API Gateway - Available Commands${NC}"
	@echo ""
	@echo -e "${GREEN}Development${NC}"
	@echo "  make run              Run in development mode"
	@echo "  make dev              Run with live reload (requires air)"
	@echo ""
	@echo -e "${GREEN}Building${NC}"
	@echo "  make build            Build binary to $(BUILD_DIR)/$(BINARY_NAME)"
	@echo "  make build-docker     Build Docker image"
	@echo ""
	@echo -e "${GREEN}Running${NC}"
	@echo "  make start            Run built binary"
	@echo "  make run-background   Run in background"
	@echo ""
	@echo -e "${GREEN}Database Migrations${NC}"
	@echo "  make migrate-up       Run migrations"
	@echo "  make migrate-down     Rollback last migration"
	@echo "  make migrate-redo     Rollback and re-run last migration"
	@echo "  make migrate-status   Show migration status"
	@echo "  make migrate-create   Create new migration"
	@echo "  make migrate-baseline Baseline existing database"
	@echo "  make migrate-fix      Fix migration ordering issues"
	@echo ""
	@echo -e "${GREEN}Code Generation${NC}"
	@echo "  make sqlc             Generate Go code from SQL"
	@echo "  make sqlc-check       Check SQL generation (dry-run)"
	@echo "  make swagger          Generate Swagger documentation"
	@echo "  make generate         Run all code generation"
	@echo ""
	@echo -e "${GREEN}Testing${NC}"
	@echo "  make test             Run all tests"
	@echo "  make test-unit        Run unit tests"
	@echo "  make test-integration Run integration tests"
	@echo "  make test-coverage    Run tests with coverage"
	@echo "  make watch-test      Run tests with live reload"
	@echo ""
	@echo -e "${GREEN}Code Quality${NC}"
	@echo "  make lint             Run linter (golangci-lint)"
	@echo "  make fmt              Format code"
	@echo "  make vet              Run go vet"
	@echo "  make staticcheck      Run static analysis"
	@echo "  make check            Run all checks (fmt, vet, lint)"
	@echo ""
	@echo -e "${GREEN}Dependencies${NC}"
	@echo "  make install          Download dependencies"
	@echo "  make tidy             Clean up go.mod/go.sum"
	@echo "  make mod-download     Download modules"
	@echo "  make mod-verify       Verify modules"
	@echo ""
	@echo -e "${GREEN}Cleanup${NC}"
	@echo "  make clean            Remove build artifacts"
	@echo "  make prune            Clean up modules"
	@echo ""
	@echo -e "${GREEN}Docker${NC}"
	@echo "  make docker-build     Build Docker image"
	@echo "  make docker-run       Run in Docker"
	@echo "  make docker-compose   Run with docker-compose"
	@echo ""
	@echo -e "${GREEN}API Testing${NC}"
	@echo "  make api-health       Check API health"
	@echo "  make api-services     List services"
	@echo "  make api-categories   List budget categories"
	@echo "  make api-tags         List budget tags"
	@echo "  make api-expenses     List expenses"
	@echo ""
	@echo -e "${GREEN}Environment${NC}"
	@echo "  ENV=$(ENV)"
	@echo "  PORT=$(PORT)"
	@echo "  DATABASE_URL=$(shell echo $(DATABASE_URL) | cut -c1-50)..."
	@echo ""

# ==============================================================================
# Development
# ==============================================================================

run:
	@echo -e "${YELLOW}Starting API Gateway in development mode...${NC}"
	@ENV=$(ENV) PORT=$(PORT) go run ./cmd/server

dev:
	@echo -e "${YELLOW}Starting API Gateway with live reload...${NC}"
	@if command -v air >/dev/null 2>&1; then \
		ENV=$(ENV) PORT=$(PORT) air; \
	else \
		echo -e "${RED}air not found. Run: go install github.com/air-verse/air@latest${NC}"; \
		ENV=$(ENV) PORT=$(PORT) go run ./cmd/server; \
	fi

# ==============================================================================
# Building
# ==============================================================================

build:
	@echo -e "${YELLOW}Building API Gateway...${NC}"
	@mkdir -p $(BUILD_DIR)
	@go build -o $(BUILD_DIR)/$(BINARY_NAME) -ldflags="-s -w" ./cmd/server
	@echo -e "${GREEN}Built successfully: $(BUILD_DIR)/$(BINARY_NAME)${NC}"

build-docker:
	@echo -e "${YELLOW}Building Docker image...${NC}"
	@docker build -t api-gateway:latest .

# ==============================================================================
# Running
# ==============================================================================

start:
	@echo -e "${YELLOW}Starting API Gateway...${NC}"
	@ENV=$(ENV) PORT=$(PORT) ./$(BUILD_DIR)/$(BINARY_NAME)

run-background:
	@echo -e "${YELLOW}Starting API Gateway in background...${NC}"
	@nohup ENV=$(ENV) PORT=$(PORT) ./$(BUILD_DIR)/$(BINARY_NAME) > api.log 2>&1 &
	@echo -e "${GREEN}API Gateway started in background (PID: $$!)${NC}"

# ==============================================================================
# Database Migrations (Goose)
# ==============================================================================

migrate-up:
	@echo -e "${YELLOW}Running database migrations...${NC}"
	@goose -dir $(GOOSE_MIGRATION_DIR) $(GOOSE_DRIVER) "$(DATABASE_URL)" up

migrate-down:
	@echo -e "${YELLOW}Rolling back last migration...${NC}"
	@goose -dir $(GOOSE_MIGRATION_DIR) $(GOOSE_DRIVER) "$(DATABASE_URL)" down

migrate-redo:
	@echo -e "${YELLOW}Redo last migration...${NC}"
	@goose -dir $(GOOSE_MIGRATION_DIR) $(GOOSE_DRIVER) "$(DATABASE_URL)" redo

migrate-status:
	@echo -e "${YELLOW}Checking migration status...${NC}"
	@goose -dir $(GOOSE_MIGRATION_DIR) $(GOOSE_DRIVER) "$(DATABASE_URL)" status

migrate-create:
	@echo -e "${YELLOW}Creating new migration...${NC}"
	@if [ -z "$(name)" ]; then \
		read -p "Enter migration name: " name; \
	fi; \
	goose -dir $(GOOSE_MIGRATION_DIR) create $$name sql

migrate-baseline:
	@echo -e "${YELLOW}Baselining existing database...${NC}"
	@goose -dir $(GOOSE_MIGRATION_DIR) $(GOOSE_DRIVER) "$(DATABASE_URL)" version
	@echo -e "${YELLOW}Please manually mark migrations as applied if needed${NC}"

migrate-fix:
	@echo -e "${YELLOW}Fixing migration issues...${NC}"
	@echo -e "${YELLOW}Current version:${NC}"
	@goose -dir $(GOOSE_MIGRATION_DIR) $(GOOSE_DRIVER) "$(DATABASE_URL)" version

# ==============================================================================
# Code Generation
# ==============================================================================

sqlc:
	@echo -e "${YELLOW}Generating Go code from SQL...${NC}"
	@sqlc generate
	@echo -e "${GREEN}SQL code generation complete${NC}"

sqlc-check:
	@echo -e "${YELLOW}Checking SQL code generation...${NC}"
	@sqlc generate --diff

swagger:
	@echo -e "${YELLOW}Generating Swagger documentation...${NC}"
	@swag init -g cmd/server/main.go -o docs --parseDependency --parseInternal
	@echo -e "${GREEN}Swagger docs generated in docs/${NC}"

generate: sqlc swagger
	@echo -e "${GREEN}All code generation complete${NC}"

# ==============================================================================
# Testing
# ==============================================================================

test:
	@echo -e "${YELLOW}Running all tests...${NC}"
	@go test ./... -v

test-unit:
	@echo -e "${YELLOW}Running unit tests...${NC}"
	@go test ./... -v -run "TestUnit|Test.*Unit" -short

test-integration:
	@echo -e "${YELLOW}Running integration tests...${NC}"
	@go test ./... -v -run "TestIntegration|Test.*Integration" -timeout 5m

test-coverage:
	@echo -e "${YELLOW}Running tests with coverage...${NC}"
	@go test ./... -coverprofile=coverage.out
	@go tool cover -html=coverage.out -o coverage.html
	@echo -e "${GREEN}Coverage report: coverage.html${NC}"
	@open coverage.html 2>/dev/null || echo -e "${YELLOW}Coverage report generated: coverage.html${NC}"

watch-test:
	@echo -e "${YELLOW}Running tests with live reload...${NC}"
	@if command -v gotestsum >/dev/null 2>&1; then \
		gotestsum --watch ./...; \
	else \
		echo -e "${RED}gotestsum not found. Run: go install gotest.tools/gotestsum@latest${NC}"; \
	fi

# ==============================================================================
# Code Quality
# ==============================================================================

lint:
	@echo -e "${YELLOW}Running linter...${NC}"
	@if command -v golangci-lint >/dev/null 2>&1; then \
		golangci-lint run ./...; \
	else \
		echo -e "${RED}golangci-lint not found. Run: curl -sSf https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b $(shell go env GOPATH)/bin v1.54${NC}"; \
	fi

fmt:
	@echo -e "${YELLOW}Formatting code...${NC}"
	@gofumpt -w .
	@gofmt -w .

vet:
	@echo -e "${YELLOW}Running go vet...${NC}"
	@go vet ./...

staticcheck:
	@echo -e "${YELLOW}Running static analysis...${NC}"
	@if command -v staticcheck >/dev/null 2>&1; then \
		staticcheck ./...; \
	else \
		echo -e "${RED}staticcheck not found. Run: go install honnef.co/go/tools/cmd/staticcheck@latest${NC}"; \
	fi

check: fmt vet lint staticcheck
	@echo -e "${GREEN}All checks passed!${NC}"

# ==============================================================================
# Dependencies
# ==============================================================================

install:
	@echo -e "${YELLOW}Installing dependencies...${NC}"
	@go mod download

tidy:
	@echo -e "${YELLOW}Cleaning up go.mod/go.sum...${NC}"
	@go mod tidy

mod-download:
	@echo -e "${YELLOW}Downloading modules...${NC}"
	@go mod download

mod-verify:
	@echo -e "${YELLOW}Verifying modules...${NC}"
	@go mod verify

# ==============================================================================
# Cleanup
# ==============================================================================

clean:
	@echo -e "${YELLOW}Cleaning build artifacts...${NC}"
	@rm -rf $(BUILD_DIR)/
	@rm -f coverage.out coverage.html
	@go clean -cache -testcache
	@echo -e "${GREEN}Cleaned successfully${NC}"

prune:
	@echo -e "${YELLOW}Pruning modules...${NC}"
	@go mod tidy
	@go clean -modcache
	@echo -e "${GREEN}Pruned successfully${NC}"

# ==============================================================================
# Docker
# ==============================================================================

docker-build:
	@echo -e "${YELLOW}Building Docker image...${NC}"
	@docker build -t $(BINARY_NAME):latest .

docker-run:
	@echo -e "${YELLOW}Running API Gateway in Docker...${NC}"
	@docker run -p $(PORT):$(PORT) \
		-e DATABASE_URL="$(DATABASE_URL)" \
		-e ENV="$(ENV)" \
		-e PORT=$(PORT) \
		$(BINARY_NAME):latest

docker-compose:
	@echo -e "${YELLOW}Running with docker-compose...${NC}"
	@cd ../ && docker compose up api-gateway

# ==============================================================================
# API Testing
# ==============================================================================

api-health:
	@echo -e "${YELLOW}Checking API health...${NC}"
	@curl -s http://localhost:$(PORT)/health | head -c 500

api-services:
	@echo -e "${YELLOW}Listing services...${NC}"
	@curl -s http://localhost:$(PORT)/api/services/list | head -c 1000

api-categories:
	@echo -e "${YELLOW}Listing budget categories...${NC}"
	@curl -s http://localhost:$(PORT)/api/budget/categories | head -c 1000

api-tags:
	@echo -e "${YELLOW}Listing budget tags...${NC}"
	@curl -s http://localhost:$(PORT)/api/budget/tags | head -c 1000

api-expenses:
	@echo -e "${YELLOW}Listing expenses...${NC}"
	@curl -s http://localhost:$(PORT)/api/budget/expenses | head -c 1000

api-all: api-health api-services api-categories api-tags api-expenses

# ==============================================================================
# Documentation
# ==============================================================================

docs-open:
	@echo -e "${YELLOW}Opening Swagger documentation...${NC}"
	@open http://localhost:$(PORT)/swagger/index.html 2>/dev/null || \
		echo -e "${YELLOW}Swagger UI at: http://localhost:$(PORT)/swagger/index.html${NC}"

# ==============================================================================
# Profiling
# ==============================================================================

profile-cpu:
	@echo -e "${YELLOW}CPU profiling...${NC}"
	@go test -cpuprofile=cpu.prof -timeout 30s ./...
	@echo -e "${YELLOW}Profile saved to cpu.prof${NC}"

profile-memory:
	@echo -e "${YELLOW}Memory profiling...${NC}"
	@go test -memprofile=mem.prof -timeout 30s ./...
	@echo -e "${YELLOW}Profile saved to mem.prof${NC}"

# ==============================================================================
# Environment
# ==============================================================================

env-check:
	@echo -e "${YELLOW}Environment configuration:${NC}"
	@echo "ENV=$(ENV)"
	@echo "PORT=$(PORT)"
	@echo "DATABASE_URL=$(shell echo $(DATABASE_URL) | cut -c1-50)..."
	@echo "GOPATH=$(shell go env GOPATH)"
	@echo "GOVERSION=$(shell go version)"

# Phony targets
.PHONY: help run dev build build-docker start run-background \
        migrate-up migrate-down migrate-redo migrate-status \
        migrate-create migrate-baseline migrate-fix \
        sqlc sqlc-check swagger generate \
        test test-unit test-integration test-coverage watch-test \
        lint fmt vet staticcheck check \
        install tidy mod-download mod-verify \
        clean prune \
        docker-build docker-run docker-compose \
        api-health api-services api-categories api-tags api-expenses api-all \
        docs-open profile-cpu profile-memory env-check
