require("dotenv").config();

const readline = require("readline");
const axios = require("axios");
const fs = require("fs");
const { exec } = require("child_process");
const path = require("path");

// 🔐 Load Gemini API key
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY is missing in your .env file.");
  process.exit(1);
}

// 🛠️ CLI Tools
const tools = {
  list_files: {
    description: "List all files and folders in the current directory.",
    func: () => fs.readdirSync(".").join("\n"),
  },

  read_file: {
    description: "Read and return the content of a file using its path.",
    func: ({ path }) => fs.readFileSync(path, "utf-8"),
  },

  edit_file: {
    description:
      "Find and replace all instances of a specific string in a file. You must provide: the file path, the exact string to replace (oldStr), and the new string to use (newStr).",
    func: ({ path, oldStr, newStr }) => {
      if (!path || typeof oldStr !== "string" || typeof newStr !== "string") {
        throw new Error(
          `Missing or invalid arguments. Got: path=${path}, oldStr=${oldStr}, newStr=${newStr}`
        );
      }

      let content = fs.readFileSync(path, "utf-8");
      content = content.replace(new RegExp(oldStr, "g"), newStr);
      fs.writeFileSync(path, content);
      return `✏️ Successfully edited '${path}'`;
    },
  },

  create_file: {
    description: "Create a new file with the specified content.",
    func: ({ path, content }) => {
      fs.mkdirSync(require("path").dirname(path), { recursive: true });
      fs.writeFileSync(path, content);
      return `📁 Created ${path}`;
    },
  },

  exec: {
    description: "Execute a terminal or shell command.",
    func: ({ command }) => {
      return new Promise((resolve, reject) => {
        exec(command, (err, stdout, stderr) => {
          if (err) reject(stderr || err.message);
          else resolve(stdout);
        });
      });
    },
  },
};

// 🧠 Gemini system instructions
const systemPrompt = `
You are a CLI coding agent. Your job is to assist the user by analyzing their input and using the right tools.

Available tools:
${Object.entries(tools)
  .map(([name, t]) => `- ${name}: ${t.description}`)
  .join("\n")}

When the user says something related to:
- listing files, reading or writing content,
- editing text in a file,
- or executing a shell/terminal command,

Respond ONLY with this JSON structure:
{
  "tool": "<tool_name>",
  "args": { ...arguments }
}

When the user asks to edit a file (e.g. “Replace 'hello' with 'hi' in app.js”), use the "edit_file" tool.

Return a JSON like:
{
  "tool": "edit_file",
  "args": {
    "path": "app.js",
    "oldStr": "hello",
    "newStr": "hi"
  }
}


No need for extra explanation or code. If the user message isn’t actionable, just reply normally as a chatbot.
`.trim();

const conversation = [{ role: "assistant", content: systemPrompt }];

// 🔁 Communicate with Gemini
async function chatWithGemini() {
  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  const body = {
    contents: conversation.map((m) => ({
      role: m.role,
      parts: [{ text: m.content }],
    })),
  };

  try {
    const res = await axios.post(url, body, {
      headers: { "Content-Type": "application/json" },
    });
    return res.data.candidates[0].content.parts[0].text.trim();
  } catch (error) {
    console.error(`❌ Gemini API Error: ${error.message}`);
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Details:", error.response.data);
    }
    throw error;
  }
}

// 🧠 Handle user messages
async function handleInput(input) {
  conversation.push({ role: "user", content: input });

  const reply = await chatWithGemini();
  console.log("\n🤖 Gemini:", reply, "\n");

  try {
    const jsonReply = reply.replace(/```json/, "").replace(/```/, "");
    const payload = JSON.parse(jsonReply);
    if (payload.tool && payload.args) {
      const { tool, args } = payload;
      if (tools[tool]) {
        console.log(`🛠 Running tool "${tool}" with args:`, args);
        try {
          const result = await tools[tool].func(args);
          console.log(`✅ Tool "${tool}" result:\n${result}\n`);
          conversation.push({ role: "tool", name: tool, content: result });
        } catch (err) {
          console.error(`💥 Tool "${tool}" error:`, err);
          conversation.push({
            role: "tool",
            name: tool,
            content: `Error: ${err}`,
          });
        }
      } else {
        console.log(`❓ Unknown tool: ${tool}`);
      }
    } else if (reply.startsWith("Gemini API Error:")) {
      console.error(reply);
    } else {
      // Not a tool call, just a message
      conversation.push({ role: "model", content: reply });
    }
  } catch (err) {
    console.error(`Error parsing reply: ${err}`);
  }
}

// function formatError(err) {
//   if (!err) return "Unknown error 😵‍💫";
//   return err.message || String(err);
// }


// ⌨️ Terminal interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function promptLoop() {
  rl.question("\n🧑 You: ", async (input) => {
    if (input.trim().toLowerCase() === "exit") {
      rl.close();
      return;
    }
    await handleInput(input);
    promptLoop();
  });
}

console.log("🚀 Welcome to the CLI Coding Agent! Type 'exit' to quit.");
promptLoop();
