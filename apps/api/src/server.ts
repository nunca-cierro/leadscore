import Fastify from "fastify";

export function createApp() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ ok: true }));

  return app;
}

// bloque de arranque — los tests NO pasan por aquí
if (process.env.NODE_ENV !== "test") {
  const app = createApp();
  app.listen({ port: 8080, host: "localhost" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
