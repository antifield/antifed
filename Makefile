.PHONY: help dev dev-noinf dev-infra dev-infra-stop dev-wait check test db-push db-generate db-migrate db-studio

DC = docker compose -f docker-compose.dev.yml

help:
	@echo "Targets:"
	@echo "  make dev              Start infra + bot + drizzle studio + docker logs (cleans on exit)"
	@echo "  make dev-noinf        Run bot with hot reload, no infra"
	@echo "  make dev-infra        Start docker infra"
	@echo "  make dev-infra-stop   Stop docker infra"
	@echo "  make check            Lint + format check (CI-safe)"
	@echo "  make format           Apply lint --fix + write formatting"
	@echo "  make test             Run tests"
	@echo "  make db-push          Push drizzle schema"
	@echo "  make db-generate      Generate drizzle migration"
	@echo "  make db-migrate       Apply drizzle migrations"
	@echo "  make db-studio        Open drizzle studio"

dev: dev-infra dev-wait db-push
	bun run --hot src/index.ts & \
	bun x drizzle-kit studio & \
	$(DC) logs -f; \
	wait; \
	$(MAKE) dev-infra-stop

dev-noinf:
	bun run --hot src/index.ts

dev-infra:
	-docker rm -f $$(docker ps -aq --filter name=antifed-) 2>/dev/null
	$(DC) up -d --force-recreate

dev-infra-stop:
	$(DC) down

dev-wait:
	bun scripts/wait-for-services.ts

check:
	bun run check

format:
	bun run format

test:
	bun test

db-push:
	bun run db:push

db-generate:
	bun run db:generate

db-migrate:
	bun run db:migrate

db-studio:
	bun run db:studio
