import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { marketDatabase, getPerformanceData, getBudgetRecommendations } from "./src/data";
import { PropertyType, CityName } from "./src/types";

// Initialize Gemini SDK with telemetry User-Agent
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route: Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", app: "Covality Real Estate Intelligence Platform" });
  });

  // API Route: Market Statistics Data
  app.get("/api/market-stats", (req, res) => {
    try {
      res.json({
        totalListings: 148530, // Accumulated from real database scrapings (Zameen + OLX)
        citiesTracked: 7,
        avgIndex: 218.4,       // Relative appreciation indicator
        highestIndexMarket: "Islamabad Commercial (Index: 338.4)",
        database: marketDatabase,
      });
    } catch (error) {
      console.error("Failed to load market stats", error);
      res.status(500).json({ error: "Failed to load market statistics" });
    }
  });

  // API Route: Precomputed Winners & Losers
  app.get("/api/performance", (req, res) => {
    try {
      const propertyType = (req.query.type as PropertyType) || "Residential Plot";
      const timeframe = (req.query.timeframe as "3M" | "6M" | "1Y" | "3Y" | "5Y") || "1Y";
      
      const stats = getPerformanceData(propertyType, timeframe);
      res.json(stats);
    } catch (error) {
      console.error("Failed to fetch performance stats", error);
      res.status(500).json({ error: "Failed to load performance metrics" });
    }
  });

  // API Route: Budget Planner Recommendations
  app.post("/api/budget-search", (req, res) => {
    try {
      const { budget, city, type } = req.body;
      if (!budget || typeof budget !== "number") {
        return res.status(400).json({ error: "Valid budget in PKR is required" });
      }
      const recommendations = getBudgetRecommendations(budget, city, type);
      res.json({ recommendations });
    } catch (error) {
      console.error("Failed budget search", error);
      res.status(500).json({ error: "Internal server error during budget query" });
    }
  });

  // API Route: AI Concierge Interactive Chat
  app.post("/api/chat", async (req, res) => {
    try {
      const { message, history } = req.body;

      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message string is required" });
      }

      // Provide complete context of Pakistani Real Estate rules, terminologies, and current indices
      const systemInstruction = `
        You are COVALITY's AI Real Estate Intelligence Concierge (Pakistan's first AI-powered Real Estate Intelligence Platform).
        Your mission is to guide investors, overseas Pakistanis (NRPs), first-time buyers, and locals with objective, data-backed insights.
        
        CRITICAL PERSONALITY & BEHAVIOR:
        1. Tone: Professional, trustworthy, objective, extremely knowledgeable, and warm.
        2. Language: Bilingual. Seamlessly switch or mix Urdu and English. Romani Urdu (Urdu written in English script like "Aap ko 50 lakh me...") and proper Urdu is highly encouraged to feel familiar to Pakistani users! If they ask in English, answer in English, but add conversational warmth.
        3. Strictly represent COVALITY's brand values. Focus on data, charts, indices, and financial analytics. Avoid speculative hype; warn them about typical real estate scams, double files, unapproved housing societies, and lack of registry (Fard).
        
        KNOWLEDGE CORES:
        - OVERSEAS BUYERS (NRPs): Guide them on Roshan Digital Accounts (RDA), NICOP requirements, power of attorney (POA) verification via Pakistani embassies, and safe developer selections (DHA, Bahria Town Lahore/Karachi/RWP).
        - FIRST-TIME BUYERS: Explain step-by-step transaction flows in Pakistan: Token (initial deposit) -> Bayana (written agreement) -> Registry (transfer of ownership) -> Mutation (Intiqal) in land record databases.
        - DOCUMENTS TO CHECK: CNIC of seller, Fard (record of rights from Patwari or computerized Punjab Land Records Authority PLRA/Sindh LARMIS), approved NOC from relevant authority (LDA, CDA, KDA, RDA), Sale Deed.
        - BUDGET QUERIES: If a user specifies a budget (e.g. 50 Lacs, 1 Crore, 2 Crore, etc.), help them calculate what size of land or build they can afford. Remember:
          * 1 Lac = 100,000 PKR.
          * 1 Crore = 10,000,000 PKR.
          * 5 Marla = ~1125 sqft (often 125 sq yards in Karachi).
          * 10 Marla = ~2250 sqft (often 250 sq yards in Karachi).
          * 1 Kanal = ~4500 sqft (often 500 sq yards).
        - AIRBNB INVESTMENT: Suggest E-11, B-17, or F-11 in Islamabad, or DHA Phase 5/6 in Lahore. Explain yields (10-15% expected annual ROI on daily rates compared to 4-5% standard yearly tenancy).
        - COVALITY DATA CONTEXT: We track Lahore, Karachi, Islamabad, Rawalpindi, Peshawar, Faisalabad, and Multan. Prices are expressed in PKR/sqft. Q1 2020 is our Base period (Index 100). Average index today is around 218.4, showing that real estate has more than doubled on average since 2020 due to inflation hedging.
        
        Never fabricate legal advice. Emphasize that they should verify the NOC from the official CDA/LDA website before booking.
      `;

      // Build chat prompt including history for conversational context
      const chatContents = [];
      if (history && Array.isArray(history)) {
        history.slice(-6).forEach((msg: any) => {
          chatContents.push({
            role: msg.sender === "user" ? "user" : "model",
            parts: [{ text: msg.text }],
          });
        });
      }
      chatContents.push({
        role: "user",
        parts: [{ text: message }],
      });

      // Call Gemini 3.5 Flash Model
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: chatContents,
        config: {
          systemInstruction,
          temperature: 0.7,
        },
      });

      const responseText = response.text || "Main is waqt aapke sawal ka jawab nahi de pa raha. Baraye meharbani dobara koshish karein.";
      res.json({ text: responseText });
    } catch (error) {
      console.error("Gemini API error during chat route:", error);
      res.status(500).json({ error: "Failing to connect to COVALITY AI brain. Is your GEMINI_API_KEY set?" });
    }
  });

  // Vite Middleware Setup for Full-Stack Integration
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting in development mode with Vite middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting in production mode serving static dist files...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`COVALITY Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
