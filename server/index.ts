import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import { migrate } from "./db";
import oauthRoutes from "./routes/oauth";
import availabilityRoutes from "./routes/availability";
import bookingRoutes from "./routes/bookings";
import webhookRoutes from "./routes/webhooks";

migrate();

const app = express();
app.use(express.json());
app.use(cookieParser());

// The widget is embedded on arbitrary customer domains, so public endpoints need CORS.
app.use("/api", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return void res.sendStatus(204);
  next();
});

app.use("/oauth", oauthRoutes);
app.use("/webhooks", webhookRoutes);
app.use("/api", availabilityRoutes);
app.use("/api", bookingRoutes);
app.use("/designer-extension", express.static(path.join(__dirname, "..", "designer-extension")));
app.use("/widget", express.static(path.join(__dirname, "..", "widget")));

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`booking-scheduler-webflow server listening on :${PORT}`);
});
