import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

const stagehand = new Stagehand({
  env: "BROWSERBASE",
  apiKey: process.env.BROWSERBASE_API_KEY,
  projectId: process.env.BROWSERBASE_PROJECT_ID,
  model: "deepseek/deepseek-chat",
  verbose: 1,
});

await stagehand.init();

const page = stagehand.context.pages()[0];
console.log("Sesión iniciada:", stagehand.browserbaseSessionURL);

await page.goto("https://registro.pigmea.click/");
console.log("Página cargada:", page.url());

await stagehand.act('Ingresa "001" en el campo de usuario o nombre de usuario');
await stagehand.act('Ingresa "0212" en el campo de contraseña');
await stagehand.act("Haz clic en el botón de iniciar sesión o entrar");

await page.waitForLoadState("networkidle").catch(() => {});
console.log("URL después del login:", page.url());

const resultado = await stagehand.extract(
  "Extrae el título principal o mensaje de bienvenida visible en la página",
  z.object({
    titulo: z.string(),
    usuario: z.string().optional(),
  })
);
console.log("Resultado:", resultado);

await stagehand.close();
