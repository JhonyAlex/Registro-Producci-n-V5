import { GoogleGenAI } from "@google/genai";
import { ProductionRecord } from "../types";

// Initialize Gemini Client
// Note: In a real production environment, ensure API keys are not exposed to the client directly if possible,
// or use a proxy. For this demo, we rely on the injected process.env.API_KEY.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const analyzeShiftData = async (records: ProductionRecord[]): Promise<string> => {
  try {
    // Limit to last 20 records to avoid token limits in this demo
    const recentRecords = records.slice(0, 20);
    
    const dataSummary = recentRecords.map(r => 
      `- ${r.date} (${r.shift}): ${r.machine} produjo ${r.meters}m con ${r.changesCount} cambios ("${r.changesComment}")`
    ).join('\n');

    const prompt = `
      Actúa como un analista experto en producción industrial para la empresa "Pigmea".
      Analiza los siguientes registros de producción recientes:
      
      ${dataSummary}
      
      Proporciona un resumen ejecutivo breve (máximo 150 palabras) en español.
      1. Identifica la máquina con mejor rendimiento.
      2. Detecta patrones negativos en los comentarios de cambios (ej. muchas roturas).
      3. Sugiere una acción de mejora rápida.
      Usa un tono profesional y directivo.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });

    return response.text || "No se pudo generar el análisis.";
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return "Error al conectar con el servicio de análisis inteligente. Verifique su conexión o clave API.";
  }
};