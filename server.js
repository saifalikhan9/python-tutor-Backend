import express from "express";
import {router} from "./src/routes.js";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());
app.get("/", (req, res) => {
  res.send("Welcome to the Express API!");
});
app.use("/api", router);

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
