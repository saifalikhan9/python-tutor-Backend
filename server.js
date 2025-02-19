import express from "express";
import cookieParser from "cookie-parser";
import {router} from "./src/routes.js";
import cors from "cors";
import 'dotenv/config';


const app = express();
app.use(cookieParser());

const PORT = process.env.PORT || 3000;


// Middleware
const whitelist = [process.env.Frontend_Url];
app.use(cors({
  origin: (origin, callback) => {
    if (whitelist.indexOf(origin) !== -1 || !origin) {
      // Allow the request if the origin is in the whitelist
      callback(null, true);
    } else {
      // Deny the request if the origin is not in the whitelist
      callback(new Error("Not allowed by CORS"));
    }
  }, 
  methods: ["GET", "POST", "DELETE", "PUT"],
  allowedHeaders: ['Content-Type', 'Authorization', "token"],
  credentials: true
}));
app.use(express.json());
app.get("/", (req, res) => {
  res.send("Welcome to the Express API!");
});
app.use("/api", router);

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
