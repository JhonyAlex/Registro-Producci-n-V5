import "dotenv/config";
import { Stagehand, CustomOpenAIClient } from "@browserbasehq/stagehand";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY!,
  baseURL: "https://api.deepseek.com",
});

const stagehand = new Stagehand({
  env: "BROWSERBASE",
  apiKey: process.env.BROWSERBASE_API_KEY!,
  projectId: process.env.BROWSERBASE_PROJECT_ID!,
  verbose: 1,
  model: {
    modelName: "deepseek-chat",
  },
  llmClient: new CustomOpenAIClient({
    modelName: "deepseek-chat",
    client: openai,
  }),
  domSettleTimeoutMs: 5_000,
  disableAPI: true,
});

async function main() {
  await stagehand.init();
  const page = stagehand.context.pages()[0];
  console.log("Session ID:", stagehand.browserbaseSessionID);

  await page.goto("https://registro.pigmea.click/");
  console.log("Page loaded");

  await stagehand.act('Type "001" into the username input');
  console.log("Username entered");

  await stagehand.act('Type "0212" into the password input');
  console.log("Password entered");

  await stagehand.act("Click the login button");
  console.log("Login submitted");

  await new Promise((r) => setTimeout(r, 3000));

  console.log("Current URL:", page.url());
  await stagehand.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
