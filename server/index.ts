import express from "express";
import helmet from "helmet";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { createServer } from "http";
import { pool } from "./db";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic } from "./vite";
import type { UserRole } from "@shared/schema";

declare module "express-session" {
  interface SessionData {
    userId: string;
    username: string;
    role: UserRole;
    nome: string;
  }
}

process.on("uncaughtException", (err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

const app = express();
const httpServer = createServer(app);

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false }));

const PgStore = connectPgSimple(session);
app.use(
  session({
    store: new PgStore({
      pool,
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || "emanua-dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  }),
);

(async () => {
  await registerRoutes(app);

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ message: err.message || "Erro interno" });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    await setupVite(app, httpServer);
  }

  const port = Number(process.env.PORT || 3002);
  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`[emanua] http://localhost:${port}`);
  });
})();
