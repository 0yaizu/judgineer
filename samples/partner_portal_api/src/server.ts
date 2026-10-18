import cors from "cors";
import express from "express";
import { config } from "./config";
import { files } from "./routes/files";
import { memberRoutes } from "./routes/members";
import { preview } from "./routes/safe-preview";
import { webhooks } from "./routes/webhooks";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(files, memberRoutes, preview, webhooks);
app.listen(config.port, "127.0.0.1");
