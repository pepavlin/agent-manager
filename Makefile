.PHONY: dev build start test clean docker-up docker-down docker-logs migrate db-studio

# Development
dev:
	npm run dev

build:
	npm run build

start:
	npm run start

test:
	npm run test

typecheck:
	npm run typecheck

# Database
migrate:
	npx prisma migrate dev

migrate-deploy:
	npx prisma migrate deploy

db-push:
	npx prisma db push

db-studio:
	npx prisma studio

db-generate:
	npx prisma generate

# Docker
docker-up:
	docker compose up -d

docker-up-local:
	docker compose --profile local up -d

docker-up-dev:
	docker compose --profile dev up -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

docker-build:
	docker compose build

docker-restart:
	docker compose down && docker compose up -d

# Clean
clean:
	rm -rf node_modules dist coverage .nyc_output

# Full setup
setup:
	npm install
	npx prisma generate
	docker compose up -d postgres qdrant
	sleep 5
	npx prisma migrate dev
	@echo "Setup complete! Run 'make dev' to start development server."

# Production deploy
deploy:
	docker compose pull
	docker compose up -d --build
	docker compose exec agent-api npx prisma migrate deploy

# Ollama setup
ollama-pull:
	docker compose exec ollama ollama pull nomic-embed-text

# Health check
health:
	curl -s http://localhost:3000/healthz | jq .

# Example requests
example-create-project:
	@echo "Creating test project..."
	curl -X POST http://localhost:3000/projects \
		-H "Content-Type: application/json" \
		-H "X-AGENT-KEY: $${AGENT_API_KEY}" \
		-d '{"name": "Test Project", "roleStatement": "You are a project manager for a test project."}' | jq .

example-list-projects:
	curl -s http://localhost:3000/projects \
		-H "X-AGENT-KEY: $${AGENT_API_KEY}" | jq .

example-chat:
	@echo "Sending chat message..."
	curl -X POST http://localhost:3000/chat \
		-H "Content-Type: application/json" \
		-H "X-AGENT-KEY: $${AGENT_API_KEY}" \
		-d '{"project_id": "$(PROJECT_ID)", "user_id": "test-user", "message": "$(MESSAGE)"}' | jq .
