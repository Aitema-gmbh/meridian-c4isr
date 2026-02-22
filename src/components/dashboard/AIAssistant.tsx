import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";

type Message = { role: "user" | "assistant"; content: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/intel-chat`;

interface LiveIntelData {
  items: { priority: string; content: string; source: string; entities: string[]; sentiment: number; threat_tag?: string }[];
  flashReport?: string | null;
  metadata: { articleCount: number; milTrackCount: number; averageSentiment: number; timestamp: string; dominantCategory?: string };
}

interface MarketsData {
  markets: { question: string; yesPrice: number | null; volume: number }[];
  timestamp: string;
}

const AIAssistant = ({ liveData, marketsData }: { liveData: LiveIntelData | null; marketsData?: MarketsData | null }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

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
    return ctx;
  };

  const sendMessage = async (text: string) => {
    if (!text || isLoading) return;
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
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
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

  const generateSitrep = () => {
    const sitrepPrompt = `Generate a comprehensive SITUATION REPORT (SITREP) based on all available intelligence. Structure it with these sections:

1. SITUATION — Current operational picture
2. THREAT ASSESSMENT — Key threats with probability estimates
3. KEY INDICATORS — Critical data points driving the assessment
4. PREDICTION MARKET SIGNALS — What betting markets indicate
5. RECOMMENDED ACTIONS — Priority actions for decision makers

Be specific, use data from the live intelligence feed and prediction markets. Format with clear section headers.`;
    sendMessage(sitrepPrompt);
  };

  return (
    <div className="panel-tactical flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border bg-panel-header">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${isLoading ? "bg-amber animate-pulse-glow" : "bg-primary animate-pulse-glow"}`} />
          <span className="text-[11px] font-mono uppercase tracking-wider text-primary">
            AI Intel Assistant
          </span>
        </div>
        <span className="text-[9px] text-primary/50 font-mono">
          {isLoading ? "PROCESSING..." : liveData ? "LIVE CONTEXT" : "LIVE AI"}
        </span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-2">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-center">
            <div>
              <p className="text-[11px] text-muted-foreground font-mono mb-2">MERIDIAN AI READY</p>
              <p className="text-[9px] text-muted-foreground/60 font-mono">
                Query intelligence or generate a SITREP.
              </p>
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`${
              msg.role === "user" ? "bg-primary/5 border-primary/20" : "bg-secondary/30 border-panel-border"
            } border rounded-sm p-2`}
          >
            <p className="text-[8px] text-muted-foreground font-mono uppercase mb-0.5">
              {msg.role === "user" ? "▸ ANALYST" : "▸ MERIDIAN AI"}
            </p>
            <p className="text-[10px] text-foreground/80 leading-relaxed whitespace-pre-line">
              {msg.content}
              {isLoading && msg.role === "assistant" && i === messages.length - 1 && (
                <span className="inline-block w-1.5 h-3 bg-primary/70 ml-0.5 animate-pulse-glow" />
              )}
            </p>
          </motion.div>
        ))}
      </div>

      <div className="p-2 border-t border-panel-border space-y-1.5">
        {/* Quick actions */}
        <div className="flex gap-1">
          <button
            onClick={generateSitrep}
            disabled={isLoading}
            className="text-[8px] font-mono px-2 py-1 rounded-sm border border-amber/30 text-amber bg-amber/5 hover:bg-amber/10 transition-colors disabled:opacity-30"
          >
            ⚡ SITREP
          </button>
          <button
            onClick={() => sendMessage("What is the current threat level in the Strait of Hormuz?")}
            disabled={isLoading}
            className="text-[8px] font-mono px-2 py-1 rounded-sm border border-panel-border text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors disabled:opacity-30"
          >
            HORMUZ
          </button>
          <button
            onClick={() => sendMessage("Summarize active cyber threats targeting critical infrastructure.")}
            disabled={isLoading}
            className="text-[8px] font-mono px-2 py-1 rounded-sm border border-panel-border text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors disabled:opacity-30"
          >
            CYBER
          </button>
        </div>

        <div className="flex gap-1.5">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage(input.trim())}
            placeholder="Query intelligence..."
            disabled={isLoading}
            className="flex-1 bg-secondary/30 border border-panel-border rounded-sm px-2 py-1 text-[10px] font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 disabled:opacity-50"
          />
          <button
            onClick={() => sendMessage(input.trim())}
            disabled={isLoading || !input.trim()}
            className="bg-primary/10 border border-primary/30 text-primary text-[9px] font-mono px-2 py-1 rounded-sm hover:bg-primary/20 transition-colors disabled:opacity-30"
          >
            SEND
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIAssistant;
