import { initLogger, log } from "evlog";
import { env } from "~/env";

initLogger({
  env: {
    service: "antifed",
    environment: env.NODE_ENV,
  },
});

export { log };
