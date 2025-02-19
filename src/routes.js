import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import { PythonShell } from "python-shell";
import { verifyToken } from "./middlewares.js";
import bcrypt from "bcryptjs";
import prompt from "./constant/prompt.js";


const prisma = new PrismaClient();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const router = express.Router();

const tempDir = join(__dirname, "temp");
fs.mkdir(tempDir).catch((error) => {
  if (error.code !== "EEXIST") throw error;
});

// Modified API key handling
const getApiKey = (req) => {
  // Check Authorization header first
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.split(" ")[1];
  }

  // Fallback to cookie if needed (less secure)
  if (req.cookies.apiKey) {
    return req.cookies.apiKey;
  }

  throw new Error(
    "No API key provided. Please add Authorization header with Bearer token"
  );
};

// Modified GenAI instance creation
const getGenAIInstance = async (req) => {
  try {
    // Fetch the user's API key from the database
    const user = await prisma.user.findUnique({
      where: { username: req.user.username },
      select: { apiKey: true },
    });

    if (!user?.apiKey) {
      throw new Error("No API key found. Please set your API key first.");
    }

    // Initialize GoogleGenerativeAI with the user's API key
    const genAI = new GoogleGenerativeAI(user.apiKey);
    return genAI;
  } catch (error) {
    console.error("Error fetching API key:", error);
    throw error;
  }
};

router.post("/signup", async (req, res) => {
  try {
    const { username, password } = req.body;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists." });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Save the user in the database
    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
      },
    });

    res.status(201).json({ message: "User created successfully.", user });
  } catch (error) {
    console.error("Error in signup:", error);
    res
      .status(500)
      .json({ message: "Something went wrong.", error: error.message });
  }
});

// Login route
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    // Find the user
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      return res.status(400).json({ message: "Invalid username or password." });
    }

    // Compare passwords
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: "Invalid username or password." });
    }

    // Generate JWT token
    const token = jwt.sign(
      { username: user.username },
      process.env.SECRET_KEY,
      { expiresIn: "15m" } // Short-lived access token
    );

    // Generate Refresh Token
    const refreshToken = jwt.sign(
      { username: user.username },
      process.env.REFRESH_SECRET_KEY,
      { expiresIn: "7d" } // Long-lived refresh token
    );

    // Store the refresh token in the database
    await prisma.user.update({
      where: { username: user.username },
      data: { refreshToken },
    });

    // Set the tokens in cookies
    res.cookie("token", token, {
      httpOnly: true,
      maxAge: 900000, // 15 minutes
      secure: true,
    });
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      maxAge: 604800000, // 7 days
      secure: true,
    });

    return res
      .status(200)
      .json({ message: "Login successful", token, refreshToken,apiKey:user.apiKey });
  } catch (error) {
    console.error("Error in login:", error);
    res
      .status(500)
      .json({ message: "Something went wrong.", error: error.message });
  }
});

// Refresh token route
router.post("/refresh-token", async (req, res) => {
  const { refreshToken } = req.cookies;
  console.log("refreshToken", refreshToken);

  if (!refreshToken) {
    return res.status(401).json({ message: "No refresh token provided." });
  }

  try {
    // Verify the refresh token
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_SECRET_KEY);
    console.log("decoded", decoded.username, "username");

    // Find the user
    const user = await prisma.user.findUnique({
      where: { username: decoded.username },
    });
    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({ message: "Invalid refresh token." });
    }

    // Generate a new access token
    const newToken = jwt.sign(
      { username: user.username },
      process.env.SECRET_KEY,
      { expiresIn: "15m" }
    );

    // Set the new access token in a cookie
    res.cookie("token", newToken, {
      httpOnly: true,
      maxAge: 900000, 
      secure: true,
    });

    return res.status(200).json({ token: newToken });
  } catch (error) {
    console.error("Error in refresh-token:", error);
    res.status(401).json({ message: "Invalid refresh token." });
  }
});

// Protected route (requires authentication)
router.get("/token", verifyToken, (req, res) => {
  const token = req.cookies.token;
  return res.json({ token });
});

// Logout route
router.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.status(200).json({ message: "Logout successful." });
});

// Modified execute route with API key handling

router.post("/execute", async (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: "Code not found" });
  }

  try {
    const timestamp = Date.now();
    const filename = `script_${timestamp}.py`;
    const filepath = join(tempDir, filename);
    await fs.writeFile(filepath, code);

    const options = {
      mode: "text",
      pythonPath: "python3",
      pythonOptions: ["-u"],
      scriptPath: tempDir,
      args: [],
    };

    let output;
    try {
      const results = await PythonShell.run(filename, options);
      output = results.join("\n");
    } catch (error) {
      output = error.message;
    }

    await fs.unlink(filepath);
    res.json({ output });
  } catch (error) {
    console.error("Error executing Python code:", error);
    res.status(500).json({ error: "Failed to execute code" });
  }
});

// Modified chat route
router.post("/chat", verifyToken, async (req, res) => {
  const { message, code, lessonId, context } = req.body;
  if (!message) {
    return res.status(400).json({ error: "No message provided" });
  }

  try {
    // Get the GoogleGenerativeAI instance
    const genAI = await getGenAIInstance(req);

    // Ensure genAI is a valid instance
    if (!genAI || typeof genAI.getGenerativeModel !== "function") {
      throw new Error("Invalid GoogleGenerativeAI instance");
    }

    // Get the generative model
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Prompt for chat messages
    const prompt1 = prompt(code, context, lessonId, message);

    // Generate contentz  
    const result = await model.generateContent(prompt1);
    const response = result.response.text();
    res.json({ response });
  } catch (error) {
    console.error("Error getting chat response:", error);
    res.status(500).json({ error: error.message });
  }
});

// Modified API key management endpoints
router.post("/set_apikey", verifyToken, async (req, res) => {
  const { apiKey } = req.body;

  if (!apiKey) {
    return res.status(400).json({ error: "API key is not provided" });
  }

  try {
    // Store API key in the database
    await prisma.user.update({
      where: { username: req.user.username }, // req.user is set by verifyToken middleware
      data: { apiKey },
    });

    res.json({ message: "API key stored successfully" });
  } catch (error) {
    console.error("Error storing API key:", error);
    res.status(500).json({ error: "Failed to store API key" });
  }
});

router.delete("/delete_apikey", verifyToken, async (req, res) => {
  try {
    // Remove API key from the database
    await prisma.user.update({
      where: { username: req.user.username },
      data: { apiKey: null }, // Set apiKey to null
    });

    res.json({ message: "API key removed successfully" });
  } catch (error) {
    console.error("Error removing API key:", error);
    res.status(500).json({ error: "Failed to remove API key" });
  }
});

export { router };
