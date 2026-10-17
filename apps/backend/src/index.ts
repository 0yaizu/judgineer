import app from "./app";

export default {
  port: Number(process.env.PORT ?? 3001),
  hostname: "127.0.0.1",
  fetch: app.fetch,
};
