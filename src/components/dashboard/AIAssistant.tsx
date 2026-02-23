import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";

type Message = { role: "user" | "assistant"; content: string };

const CHAT_URL = `${import.meta.env.VITE_API_BASE_URL || "https://meridian-api.dieter-meier82.workers.dev"}/intel-chat`;

interface LiveIntelData {
  items: { priority: string; content: string; source: string; entities: string[]; sentiment: number; threat_tag?: string }[];
  flashReport?: string | null;
  metadata: { articleCount: number; milTrackCount: number; averageSentiment: number; timestamp: string; dominantCategory?: string };
}

interface MarketsData {
  markets: { question: string; yesPrice: number | null; volume: number }[];
  timestamp: string;
}

interface BriefingData {
  tensionIndex: number;
  watchcon: string;
  flashReport: string;
  narrative: string;
  keyDrivers: string[];
  agentsCovered: number;
  updatedAt: string;
  doughcon: string | null;
  pizzaIndex: number | null;
}

interface ThinkTankData {
  dissentScore: number;
  overallAssessment: string;
  alternativeScenarios: { scenario: string; probability: number; reasoning: string }[];
  blindSpots: string[];
  redFlags: string[];
}

interface ScenarioResult {
  scenario: string;
  probability: number;
  timeframe: string;
  cascadingEffects: { domain: string; impact: string; severity: number; timeframe: string }[];
  secondOrderEffects: string[];
  historicalAnalogs: { event: string; year: number; similarity: string }[];
  recommendations: string[];
  adjustedThreatLevels: { tensionIndex: number; hormuzClosure: number; cyberAttack: number; proxyEscalation: number; directConfrontation: number };
}

const SCENARIO_PRESETS = [
  { label: "HORMUZ CLOSURE", scenario: "Iran closes the Strait of Hormuz using naval mines and IRGC fast boats, blocking all oil tanker traffic", color: "crimson" },
  { label: "CYBER STRIKE", scenario: "Major Iranian cyber attack targeting US critical infrastructure (power grid, financial systems) in retaliation for sanctions", color: "primary" },
  { label: "PROXY ESCALATION", scenario: "Coordinated multi-front proxy attack: Hezbollah rockets from Lebanon, Houthi anti-ship missiles in Red Sea, PMF strikes on US bases in Iraq", color: "amber" },
  { label: "US STRIKE", scenario: "US conducts limited precision strike on Iranian nuclear facility at Fordow using B-2 bombers from Diego Garcia", color: "crimson" },
  { label: "DIPLOMATIC", scenario: "Surprise diplomatic breakthrough: Iran agrees to nuclear inspections in exchange for partial sanctions relief, US carrier group withdraws", color: "tactical-green" },
  { label: "TANKER SEIZURE", scenario: "IRGC Navy seizes a US-flagged oil tanker in the Strait of Hormuz, takes crew hostage", color: "amber" },
];

const SEVERITY_COLORS = ["", "bg-tactical-green", "bg-amber/80", "bg-amber", "bg-crimson/80", "bg-crimson"];
const SEVERITY_LABELS = ["", "MINIMAL", "NOTABLE", "SIGNIFICANT", "SEVERE", "CRITICAL"];

type PanelMode = "briefing" | "chat" | "scenario";

const DOUGHCON_COLORS: Record<string, string> = {
  "DOUGHCON 1": "bg-crimson text-white border-crimson",
  "DOUGHCON 2": "bg-amber/80 text-background border-amber",
  "DOUGHCON 3": "bg-yellow-500/70 text-background border-yellow-500",
  "DOUGHCON 4": "bg-tactical-green/70 text-background border-tactical-green",
  "DOUGHCON 5": "bg-primary/50 text-background border-primary",
};

const QUICK_QUERIES = [
  { label: "SITREP", prompt: "Generate a comprehensive SITUATION REPORT (SITREP) based on all available intelligence. Structure: 1. SITUATION 2. THREAT ASSESSMENT 3. KEY INDICATORS 4. PREDICTION MARKETS 5. RECOMMENDED ACTIONS. Be specific, use live data.", color: "amber" },
  { label: "HORMUZ", prompt: "What is the current threat level in the Strait of Hormuz? Include naval movements, ADS-B data, and relevant prediction market signals.", color: "crimson" },
  { label: "CYBER", prompt: "Summarize active cyber threats targeting critical infrastructure in the Gulf region. Include any APT activity and recent GDELT cyber intelligence.", color: "primary" },
  { label: "DOUGHCON", prompt: "What is the current Pentagon activity level? Analyze the DOUGHCON indicator, late-night DC military flights, and any unusual command aircraft movements.", color: "amber" },
];

const AIAssistant = ({ liveData, marketsData }: { liveData: LiveIntelData | null; marketsData?: MarketsData | null }) => {
  const [mode, setMode] = useState<PanelMode>("briefing");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(true);
  const [scenarioResult, setScenarioResult] = useState<ScenarioResult | null>(null);
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [scenarioInput, setScenarioInput] = useState("");
  const [thinkTank, setThinkTank] = useState<ThinkTankData | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Load latest briefing from D1 (head-analyst + pizza agent)
  const loadBriefing = useCallback(async () => {
    setBriefingLoading(true);
    try {
      const [assessRes, reportsRes] = await Promise.allSettled([
        apiFetch<{ assessments: Record<string, unknown>[] }>("/api/threat-assessments", { limit: "1" }),
        apiFetch<{ reports: Record<string, unknown>[] }>("/api/agent-reports", { hours: "6" }),
      ]);

      let bd: Partial<BriefingData> = {};

      if (assessRes.status === "fulfilled" && assessRes.value.assessments?.[0]) {
        const a = assessRes.value.assessments[0];
        const raw = (a.raw_indicators as Record<string, unknown>) || {};
        bd.tensionIndex = Number(a.tension_index) || 0;
        bd.watchcon = String(a.watchcon || "?");
        bd.narrative = String(a.analysis_narrative || "");
        bd.keyDrivers = (raw.keyDrivers as string[]) || [];
        bd.agentsCovered = (raw.agentsCovered as string[])?.length || 0;
        bd.updatedAt = String(a.created_at || "");
      }

      if (reportsRes.status === "fulfilled" && reportsRes.value.reports) {
        const reports = reportsRes.value.reports;
        // Get head-analyst flash report
        const headReport = reports.find((r: Record<string, unknown>) => r.agent_name === "head-analyst");
        if (headReport) {
          const headData = headReport.data as Record<string, unknown> | undefined;
          bd.flashReport = String(headReport.summary || headData?.flashReport || "");
          if (!bd.updatedAt) bd.updatedAt = String(headReport.created_at || "");
        }

        // Get pizza/DOUGHCON data
        const pizzaReport = reports.find((r: Record<string, unknown>) => r.agent_name === "pizza");
        if (pizzaReport) {
          const pData = pizzaReport.data as Record<string, unknown> | undefined;
          bd.doughcon = String(pData?.doughcon || "") || null;
          bd.pizzaIndex = Number(pData?.pizzaIndex) || null;
        }

        // Get ThinkTank Red Team data
        const ttReport = reports.find((r: Record<string, unknown>) => r.agent_name === "thinktank");
        if (ttReport) {
          const ttData = ttReport.data as Record<string, unknown> | undefined;
          if (ttData) {
            setThinkTank({
              dissentScore: Number(ttData.dissentScore) || 0,
              overallAssessment: String(ttData.overallAssessment || ""),
              alternativeScenarios: (ttData.alternativeScenarios as ThinkTankData["alternativeScenarios"]) || [],
              blindSpots: (ttData.blindSpots as string[]) || [],
              redFlags: (ttData.redFlags as string[]) || [],
            });
          }
        }
      }

      if (bd.tensionIndex !== undefined || bd.flashReport) {
        setBriefing(bd as BriefingData);
      }
    } catch (e) {
      console.error("Briefing load error:", e);
    } finally {
      setBriefingLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBriefing();
    const interval = setInterval(loadBriefing, 120000);
    return () => clearInterval(interval);
  }, [loadBriefing]);

  const buildContext = () => {
    let ctx = "";
    if (liveData) {
      const m = liveData.metadata;
      const topItems = liveData.items.slice(0, 8).map((it, i) => `${i + 1}. [${it.priority}] [${it.threat_tag || "?"}] ${it.content}`).join("\n");
      ctx += `\n\nCURRENT LIVE INTELLIGENCE (${m.timestamp}):\n- Mil aircraft Gulf AOR: ${m.milTrackCount}\n- GDELT articles (3 streams): ${m.articleCount}\n- Dominant threat: ${m.dominantCategory || "?"}\n- Avg sentiment: ${(m.averageSentiment ?? 0).toFixed(2)}\n`;
      if (liveData.flashReport) ctx += `\nFLASH REPORT: ${liveData.flashReport}\n`;
      ctx += `\nTop Intel:\n${topItems}`;
    }
    if (marketsData?.markets?.length) {
      ctx += `\n\nPREDICTION MARKET SIGNALS:\n`;
      ctx += marketsData.markets.slice(0, 5).map(m => `- "${m.question}": ${m.yesPrice ?? '?'}% YES (vol: $${Math.round(m.volume).toLocaleString()})`).join("\n");
    }
    if (briefing) {
      ctx += `\n\nHEAD ANALYST ASSESSMENT:\n- Tension Index: ${briefing.tensionIndex}/100\n- WATCHCON: ${briefing.watchcon}`;
      if (briefing.doughcon) ctx += `\n- DOUGHCON: ${briefing.doughcon} (Pizza Index: ${briefing.pizzaIndex})`;
      if (briefing.keyDrivers?.length) ctx += `\n- Key Drivers: ${briefing.keyDrivers.join("; ")}`;
    }
    return ctx;
  };

  const runScenario = async (scenarioText: string) => {
    if (!scenarioText || scenarioLoading) return;
    setScenarioLoading(true);
    setScenarioResult(null);
    try {
      const API_BASE = import.meta.env.VITE_API_BASE_URL || "https://meridian-api.dieter-meier82.workers.dev";
      const resp = await fetch(`${API_BASE}/scenario-sim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: scenarioText }),
      });
      if (!resp.ok) throw new Error(`Scenario API returned ${resp.status}`);
      const data = await resp.json() as ScenarioResult;
      setScenarioResult(data);
    } catch (e) {
      console.error("Scenario error:", e);
      toast.error("Scenario simulation failed");
    } finally {
      setScenarioLoading(false);
    }
  };

  const sendMessage = async (text: string) => {
    if (!text || isLoading) return;
    if (mode === "briefing") setMode("chat");
    const userMsg: Message = { role: "user", content: text };
    const allMessages = [...messages, userMsg];
    setMessages(allMessages);
    setInput("");
    setIsLoading(true);

    let assistantSoFar = "";
    const upsertAssistant = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m);
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    try {
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || ""}`,
        },
        body: JSON.stringify({ messages: allMessages, liveContext: buildContext() }),
      });

      if (resp.status === 429) { toast.error("Rate limit exceeded."); setIsLoading(false); return; }
      if (resp.status === 402) { toast.error("AI credits exhausted."); setIsLoading(false); return; }
      if (!resp.ok || !resp.body) throw new Error("Failed to start stream");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") { streamDone = true; break; }
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) upsertAssistant(content);
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      if (textBuffer.trim()) {
        for (let raw of textBuffer.split("\n")) {
          if (!raw) continue;
          if (raw.endsWith("\r")) raw = raw.slice(0, -1);
          if (raw.startsWith(":") || raw.trim() === "") continue;
          if (!raw.startsWith("data: ")) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) upsertAssistant(content);
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      console.error("Chat error:", e);
      toast.error("Failed to connect to AI assistant.");
    } finally {
      setIsLoading(false);
    }
  };

  const minutesAgo = briefing?.updatedAt
    ? Math.round((Date.now() - new Date(briefing.updatedAt).getTime()) / 60000)
    : null;

  return (
    <div className="panel-tactical flex flex-col h-full">
      {/* Header with mode tabs */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-panel-border bg-panel-header shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMode("briefing")}
            className={`text-[9px] font-mono px-2 py-0.5 rounded-sm border transition-colors ${
              mode === "briefing"
                ? "border-amber/50 text-amber bg-amber/10"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            BRIEFING
          </button>
          <button
            onClick={() => setMode("chat")}
            className={`text-[9px] font-mono px-2 py-0.5 rounded-sm border transition-colors ${
              mode === "chat"
                ? "border-primary/50 text-primary bg-primary/10"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            AI QUERY
          </button>
          <button
            onClick={() => setMode("scenario")}
            className={`text-[9px] font-mono px-2 py-0.5 rounded-sm border transition-colors ${
              mode === "scenario"
                ? "border-crimson/50 text-crimson bg-crimson/10"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            WHAT-IF
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`h-1.5 w-1.5 rounded-full ${(isLoading || scenarioLoading) ? "bg-amber animate-pulse" : briefing ? "bg-tactical-green" : "bg-muted-foreground/30"}`} />
          <span className="text-[8px] font-mono text-muted-foreground/60">
            {scenarioLoading ? "SIMULATING" : isLoading ? "PROCESSING" : minutesAgo !== null ? `${minutesAgo}m AGO` : "AWAITING"}
          </span>
        </div>
      </div>

      {/* Content area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {mode === "briefing" ? (
            <motion.div
              key="briefing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-2 space-y-2"
            >
              {briefingLoading && !briefing && (
                <div className="flex items-center justify-center py-6">
                  <div className="text-center">
                    <div className="h-6 w-6 border border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-[9px] text-muted-foreground font-mono">LOADING BRIEFING...</p>
                  </div>
                </div>
              )}

              {briefing && (
                <>
                  {/* Status badges row — always visible at top */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border text-[9px] font-mono font-bold ${
                      briefing.tensionIndex > 70 ? "border-crimson/50 text-crimson bg-crimson/10" :
                      briefing.tensionIndex > 40 ? "border-amber/50 text-amber bg-amber/10" :
                      "border-tactical-green/50 text-tactical-green bg-tactical-green/10"
                    }`}>
                      TI: {briefing.tensionIndex}
                    </div>
                    <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border text-[9px] font-mono font-bold ${
                      parseInt(briefing.watchcon) <= 2 ? "border-crimson/50 text-crimson bg-crimson/10" :
                      parseInt(briefing.watchcon) <= 3 ? "border-amber/50 text-amber bg-amber/10" :
                      "border-tactical-green/50 text-tactical-green bg-tactical-green/10"
                    }`}>
                      WC-{briefing.watchcon}
                    </div>
                    {briefing.doughcon && (
                      <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border text-[9px] font-mono font-bold ${
                        DOUGHCON_COLORS[briefing.doughcon] || "border-primary/50 text-primary bg-primary/10"
                      }`}>
                        {briefing.doughcon}
                      </div>
                    )}
                    {briefing.agentsCovered > 0 && (
                      <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-panel-border text-[8px] font-mono text-muted-foreground">
                        {briefing.agentsCovered} AGENTS
                      </div>
                    )}
                  </div>

                  {/* Live data metrics — compact row */}
                  {liveData && (
                    <div className="grid grid-cols-3 gap-1">
                      <div className="text-center bg-secondary/20 rounded-sm py-1">
                        <p className="text-[12px] font-mono font-bold text-primary">{liveData.metadata.milTrackCount}</p>
                        <p className="text-[7px] font-mono text-muted-foreground/50">MIL TRACKS</p>
                      </div>
                      <div className="text-center bg-secondary/20 rounded-sm py-1">
                        <p className="text-[12px] font-mono font-bold text-amber">{liveData.metadata.articleCount}</p>
                        <p className="text-[7px] font-mono text-muted-foreground/50">ARTICLES</p>
                      </div>
                      <div className="text-center bg-secondary/20 rounded-sm py-1">
                        <p className={`text-[12px] font-mono font-bold ${
                          liveData.metadata.averageSentiment < -0.5 ? "text-crimson" : "text-amber"
                        }`}>
                          {(liveData.metadata.averageSentiment ?? 0).toFixed(2)}
                        </p>
                        <p className="text-[7px] font-mono text-muted-foreground/50">SENTIMENT</p>
                      </div>
                    </div>
                  )}

                  {/* Flash Report — truncated with expand */}
                  {briefing.flashReport && (
                    <div className="bg-crimson/5 border border-crimson/20 rounded-sm p-1.5">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <div className="h-1.5 w-1.5 rounded-full bg-crimson animate-pulse" />
                        <span className="text-[7px] font-mono font-bold text-crimson tracking-wider">FLASH REPORT</span>
                      </div>
                      <p className="text-[9px] text-foreground/70 leading-snug line-clamp-4">{briefing.flashReport}</p>
                    </div>
                  )}

                  {/* Key Drivers */}
                  {briefing.keyDrivers?.length > 0 && (
                    <div className="space-y-0.5">
                      <p className="text-[7px] font-mono text-muted-foreground/60 uppercase tracking-wider">Key Drivers</p>
                      {briefing.keyDrivers.slice(0, 3).map((d, i) => (
                        <div key={i} className="flex items-start gap-1">
                          <span className="text-[7px] text-amber mt-0.5 shrink-0">▸</span>
                          <p className="text-[8px] text-foreground/60 leading-snug">{d}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Red Team / ThinkTank Analysis */}
                  {thinkTank && thinkTank.dissentScore > 0 && (
                    <div className={`rounded-sm border p-1.5 ${
                      thinkTank.dissentScore > 60 ? "border-purple-400/30 bg-purple-400/5" :
                      thinkTank.dissentScore > 30 ? "border-amber/20 bg-amber/5" :
                      "border-panel-border bg-secondary/10"
                    }`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1">
                          <span className="text-[7px] font-mono font-bold text-purple-400 uppercase tracking-wider">RED TEAM</span>
                          <span className={`text-[8px] font-mono font-bold ${
                            thinkTank.dissentScore > 60 ? "text-crimson" :
                            thinkTank.dissentScore > 30 ? "text-amber" :
                            "text-tactical-green"
                          }`}>DISSENT: {thinkTank.dissentScore}</span>
                        </div>
                      </div>
                      {thinkTank.overallAssessment && (
                        <p className="text-[8px] text-foreground/60 leading-snug mb-1 line-clamp-3">{thinkTank.overallAssessment}</p>
                      )}
                      {thinkTank.redFlags.length > 0 && (
                        <div className="space-y-0.5">
                          <p className="text-[6px] font-mono text-crimson/60 uppercase">Red Flags</p>
                          {thinkTank.redFlags.slice(0, 2).map((f, i) => (
                            <div key={i} className="flex items-start gap-1">
                              <span className="text-[7px] text-crimson mt-0.5 shrink-0">!</span>
                              <p className="text-[7px] text-foreground/50 leading-snug line-clamp-2">{f}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      {thinkTank.blindSpots.length > 0 && (
                        <div className="space-y-0.5 mt-0.5">
                          <p className="text-[6px] font-mono text-purple-400/60 uppercase">Blind Spots</p>
                          {thinkTank.blindSpots.slice(0, 2).map((b, i) => (
                            <div key={i} className="flex items-start gap-1">
                              <span className="text-[7px] text-purple-400 mt-0.5 shrink-0">?</span>
                              <p className="text-[7px] text-foreground/50 leading-snug line-clamp-2">{b}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {!briefing && !briefingLoading && (
                <div className="flex items-center justify-center py-6 text-center">
                  <div>
                    <p className="text-[10px] text-muted-foreground font-mono mb-1">NO BRIEFING AVAILABLE</p>
                    <p className="text-[8px] text-muted-foreground/50 font-mono">Run agents to generate assessment</p>
                  </div>
                </div>
              )}
            </motion.div>
          ) : mode === "chat" ? (
            <motion.div
              key="chat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-2 space-y-1.5"
            >
              {messages.length === 0 && (
                <div className="flex items-center justify-center py-4 text-center">
                  <div>
                    <p className="text-[10px] text-muted-foreground font-mono mb-1">MERIDIAN AI READY</p>
                    <p className="text-[8px] text-muted-foreground/50 font-mono">
                      Query intelligence with live context
                    </p>
                  </div>
                </div>
              )}
              {messages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`rounded-sm p-2 ${
                    msg.role === "user"
                      ? "bg-primary/5 border border-primary/15"
                      : "bg-secondary/20 border border-panel-border"
                  }`}
                >
                  <p className="text-[7px] text-muted-foreground/60 font-mono uppercase mb-0.5 tracking-wider">
                    {msg.role === "user" ? "ANALYST" : "MERIDIAN AI"}
                  </p>
                  <p className="text-[10px] text-foreground/80 leading-relaxed whitespace-pre-line">
                    {msg.content}
                    {isLoading && msg.role === "assistant" && i === messages.length - 1 && (
                      <span className="inline-block w-1 h-3 bg-primary/60 ml-0.5 animate-pulse" />
                    )}
                  </p>
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="scenario"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-2 space-y-2"
            >
              {/* Scenario presets */}
              <div className="grid grid-cols-3 gap-1">
                {SCENARIO_PRESETS.map(s => (
                  <button
                    key={s.label}
                    onClick={() => { setScenarioInput(s.scenario); runScenario(s.scenario); }}
                    disabled={scenarioLoading}
                    className={`text-[7px] font-mono px-1 py-1.5 rounded-sm border transition-colors disabled:opacity-30 text-left leading-tight ${
                      s.color === "crimson" ? "border-crimson/30 text-crimson/80 hover:bg-crimson/10" :
                      s.color === "amber" ? "border-amber/30 text-amber/80 hover:bg-amber/10" :
                      s.color === "tactical-green" ? "border-tactical-green/30 text-tactical-green/80 hover:bg-tactical-green/10" :
                      "border-primary/30 text-primary/80 hover:bg-primary/10"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* Custom scenario input */}
              <div className="flex gap-1">
                <input
                  type="text"
                  value={scenarioInput}
                  onChange={(e) => setScenarioInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runScenario(scenarioInput.trim())}
                  placeholder="Custom scenario..."
                  disabled={scenarioLoading}
                  className="flex-1 bg-secondary/20 border border-panel-border rounded-sm px-2 py-1 text-[9px] font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-crimson/40 disabled:opacity-50"
                />
                <button
                  onClick={() => runScenario(scenarioInput.trim())}
                  disabled={scenarioLoading || !scenarioInput.trim()}
                  className="bg-crimson/10 border border-crimson/30 text-crimson text-[8px] font-mono px-2 py-1 rounded-sm hover:bg-crimson/20 transition-colors disabled:opacity-30"
                >
                  SIM
                </button>
              </div>

              {/* Loading */}
              {scenarioLoading && (
                <div className="flex items-center justify-center py-6">
                  <div className="text-center">
                    <div className="h-6 w-6 border border-crimson/30 border-t-crimson rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-[9px] text-muted-foreground font-mono">SIMULATING SCENARIO...</p>
                    <p className="text-[7px] text-muted-foreground/50 font-mono mt-0.5">Analyzing cascading effects</p>
                  </div>
                </div>
              )}

              {/* Results */}
              {scenarioResult && !scenarioLoading && (
                <div className="space-y-2">
                  {/* Probability + Timeframe header */}
                  <div className="flex items-center gap-2">
                    <div className={`px-2 py-1 rounded-sm border text-center ${
                      scenarioResult.probability > 50 ? "border-crimson/50 bg-crimson/10" :
                      scenarioResult.probability > 20 ? "border-amber/50 bg-amber/10" :
                      "border-tactical-green/50 bg-tactical-green/10"
                    }`}>
                      <p className={`text-lg font-mono font-bold ${
                        scenarioResult.probability > 50 ? "text-crimson" :
                        scenarioResult.probability > 20 ? "text-amber" :
                        "text-tactical-green"
                      }`}>{scenarioResult.probability}%</p>
                      <p className="text-[6px] font-mono text-muted-foreground uppercase">PROBABILITY</p>
                    </div>
                    <div className="flex-1">
                      <p className="text-[8px] font-mono text-muted-foreground uppercase">TIMEFRAME</p>
                      <p className="text-[10px] font-mono text-foreground/80">{scenarioResult.timeframe}</p>
                    </div>
                  </div>

                  {/* Adjusted Threat Levels comparison */}
                  <div className="bg-secondary/20 rounded-sm p-1.5 border border-panel-border">
                    <p className="text-[7px] font-mono text-muted-foreground/60 uppercase tracking-wider mb-1">Adjusted Threat Levels</p>
                    <div className="grid grid-cols-5 gap-1">
                      {(["tensionIndex", "hormuzClosure", "cyberAttack", "proxyEscalation", "directConfrontation"] as const).map(key => {
                        const val = scenarioResult.adjustedThreatLevels[key];
                        const labels: Record<string, string> = { tensionIndex: "TI", hormuzClosure: "HRMZ", cyberAttack: "CYBR", proxyEscalation: "PRXY", directConfrontation: "DRCT" };
                        return (
                          <div key={key} className="text-center">
                            <p className={`text-[11px] font-mono font-bold ${val > 70 ? "text-crimson" : val > 40 ? "text-amber" : "text-tactical-green"}`}>{val}</p>
                            <p className="text-[6px] font-mono text-muted-foreground/50">{labels[key]}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Cascading Effects */}
                  {scenarioResult.cascadingEffects.length > 0 && (
                    <div className="space-y-0.5">
                      <p className="text-[7px] font-mono text-muted-foreground/60 uppercase tracking-wider">Cascading Effects</p>
                      {scenarioResult.cascadingEffects.slice(0, 6).map((effect, i) => (
                        <div key={i} className="flex items-start gap-1.5 bg-secondary/10 rounded-sm p-1 border border-panel-border/50">
                          <div className={`h-1.5 w-1.5 rounded-full mt-1 shrink-0 ${SEVERITY_COLORS[effect.severity] || "bg-muted-foreground"}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1">
                              <span className="text-[7px] font-mono font-bold text-foreground/60 uppercase">{effect.domain}</span>
                              <span className={`text-[6px] font-mono px-1 rounded-sm ${SEVERITY_COLORS[effect.severity]}/20 ${
                                effect.severity >= 4 ? "text-crimson" : effect.severity >= 3 ? "text-amber" : "text-tactical-green"
                              }`}>{SEVERITY_LABELS[effect.severity]}</span>
                            </div>
                            <p className="text-[8px] text-foreground/60 leading-snug line-clamp-2">{effect.impact}</p>
                            <p className="text-[6px] text-muted-foreground/40 font-mono">{effect.timeframe}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Historical Analogs */}
                  {scenarioResult.historicalAnalogs.length > 0 && (
                    <div className="space-y-0.5">
                      <p className="text-[7px] font-mono text-muted-foreground/60 uppercase tracking-wider">Historical Analogs</p>
                      {scenarioResult.historicalAnalogs.map((analog, i) => (
                        <div key={i} className="flex items-start gap-1 bg-primary/5 rounded-sm p-1 border border-primary/10">
                          <span className="text-[8px] font-mono text-primary font-bold shrink-0">{analog.year}</span>
                          <div>
                            <p className="text-[8px] font-mono text-foreground/70 font-bold">{analog.event}</p>
                            <p className="text-[7px] text-foreground/50 leading-snug line-clamp-2">{analog.similarity}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Second Order Effects */}
                  {scenarioResult.secondOrderEffects.length > 0 && (
                    <div className="space-y-0.5">
                      <p className="text-[7px] font-mono text-muted-foreground/60 uppercase tracking-wider">Second-Order Effects</p>
                      {scenarioResult.secondOrderEffects.slice(0, 4).map((effect, i) => (
                        <div key={i} className="flex items-start gap-1">
                          <span className="text-[7px] text-amber mt-0.5 shrink-0">▸</span>
                          <p className="text-[8px] text-foreground/60 leading-snug">{effect}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Empty state */}
              {!scenarioResult && !scenarioLoading && (
                <div className="flex items-center justify-center py-4 text-center">
                  <div>
                    <p className="text-[10px] text-muted-foreground font-mono mb-1">SCENARIO SIMULATOR</p>
                    <p className="text-[8px] text-muted-foreground/50 font-mono">
                      Select a preset or enter a custom scenario
                    </p>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Input area — only for briefing and chat modes */}
      {mode !== "scenario" && (
        <div className="p-2 border-t border-panel-border space-y-1.5 shrink-0">
          {/* Quick actions */}
          <div className="flex gap-1 flex-wrap">
            {QUICK_QUERIES.map(q => (
              <button
                key={q.label}
                onClick={() => sendMessage(q.prompt)}
                disabled={isLoading}
                className={`text-[8px] font-mono px-1.5 py-0.5 rounded-sm border transition-colors disabled:opacity-30 ${
                  q.color === "amber" ? "border-amber/30 text-amber hover:bg-amber/10" :
                  q.color === "crimson" ? "border-crimson/30 text-crimson hover:bg-crimson/10" :
                  "border-primary/30 text-primary hover:bg-primary/10"
                }`}
              >
                {q.label}
              </button>
            ))}
          </div>

          <div className="flex gap-1">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage(input.trim())}
              placeholder="Query intelligence..."
              disabled={isLoading}
              className="flex-1 bg-secondary/20 border border-panel-border rounded-sm px-2 py-1 text-[10px] font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 disabled:opacity-50"
            />
            <button
              onClick={() => sendMessage(input.trim())}
              disabled={isLoading || !input.trim()}
              className="bg-primary/10 border border-primary/30 text-primary text-[8px] font-mono px-2 py-1 rounded-sm hover:bg-primary/20 transition-colors disabled:opacity-30"
            >
              SEND
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AIAssistant;
