#!/usr/bin/env bun

interface Service {
  name: string;
  check: () => Promise<boolean>;
}

function httpCheck(url: string): () => Promise<boolean> {
  return async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  };
}

const services: Service[] = [{ name: "libsql", check: httpCheck("http://localhost:9120/health") }];

const MAX_RETRIES = 30;
const RETRY_DELAY_MS = 1000;

async function waitFor(service: Service): Promise<boolean> {
  // Sequential awaits are required: we're polling a service until it's ready.
  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      if (await service.check()) {
        console.log(`  ${service.name} ready`);
        return true;
      }
    } catch {}

    if (i < MAX_RETRIES - 1) {
      process.stdout.write(`  Waiting for ${service.name}... (${i + 1}/${MAX_RETRIES})\r`);
      await Bun.sleep(RETRY_DELAY_MS);
    }
  }
  /* eslint-enable no-await-in-loop */

  console.log(`  ${service.name} failed after ${MAX_RETRIES} attempts`);
  return false;
}

async function main() {
  console.log("Waiting for Docker services...\n");

  const results = await Promise.all(services.map(waitFor));
  const allHealthy = results.every(Boolean);

  if (allHealthy) {
    console.log("\nAll services ready.\n");
    process.exit(0);
  } else {
    console.log("\nSome services failed. Run: docker compose -f docker-compose.dev.yml logs\n");
    process.exit(1);
  }
}

main();
