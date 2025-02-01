import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";

import { PythonShell } from "python-shell";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const router = express.Router();

const tempDir = join(__dirname, "temp");
fs.mkdir(tempDir).catch((error) => {
  if (error.code !== "EEXIST") throw error;
});

let userApiKey = null;
const { GENERATIVE_API_KEY } = process.env;

const getGenAIInstance = () => {
  const apiKey = userApiKey || GENERATIVE_API_KEY;
  if (!apiKey) {
    throw new Error("No API key available. Please provide an API key.");
  }
  return new GoogleGenerativeAI(apiKey);
};

// Define routes
router.get("/", (req, res) => {
  res.send("Welcome to the Express API!");
});





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

router.post("/chat", async (req, res) => {
  const { message, code, lessonId, context } = req.body;
  if (!message) {
    return res.status(400).json({ error: "No message provided" });
  }

  try {
    const genAI = getGenAIInstance();
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
      You are a friendly and encouraging Python tutor for children.
      ${context === "playground" ? "You are helping in the playground where children can experiment freely." : `You are helping with lesson ${lessonId}.`}
      Keep explanations simple and use analogies children can understand.
      Current code context: ${code}

      User message: ${message}
    `;

    const result = await model.generateContent(prompt);
    const response = result.response.text();

    res.json({ response });
  } catch (error) {
    console.error("Error getting chat response:", error);
    res.status(500).json({ error: "Failed to get response" });
  }
});

router.post("/set_apikey", async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) {
    return res.status(400).json({ error: "API key is not provided" });
  }
  userApiKey = apiKey;
  return res.json({ message: "API key has been set successfully" });
});

router.delete("/delete_apikey", async (req, res) => {
  userApiKey = null;
  res.json({ message: "API key has been reset successfully" });
});

export {router}
