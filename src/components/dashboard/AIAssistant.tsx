import { useState } from "react";
import { motion } from "framer-motion";

const MOCK_RESPONSES = [
  { role: "user" as const, content: "What is the current threat level in the Strait of Hormuz?" },
  {
    role: "assistant" as const,
    content:
      "Based on multi-source analysis: The Strait of Hormuz threat level is ELEVATED (34% closure probability). Key indicators:\n\n• IRGCN fast patrol boat deployments up 200% vs baseline\n• RC-135V ISR sorties doubled in 12hrs (anomalous)\n• 3 VLCCs diverted from transit corridor\n• OSINT sentiment score: -0.63 (hostile)\n\nRecommendation: Maintain WATCHCON 2. Monitor IRGCN FPB movements for swarming patterns.",
  },
];

const AIAssistant = () => {
  const [messages] = useState(MOCK_RESPONSES);
  const [input, setInput] = useState("");

  return (
    <div className="panel-tactical flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border bg-panel-header">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-primary animate-pulse-glow" />
          <span className="text-[11px] font-mono uppercase tracking-wider text-primary">
            AI Intel Assistant
          </span>
        </div>
        <span className="text-[10px] text-primary/50 font-mono">LLM</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((msg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.2 }}
            className={`${
              msg.role === "user"
                ? "bg-primary/5 border-primary/20"
                : "bg-secondary/30 border-panel-border"
            } border rounded-sm p-2.5`}
          >
            <p className="text-[9px] text-muted-foreground font-mono uppercase mb-1">
              {msg.role === "user" ? "▸ ANALYST QUERY" : "▸ AI RESPONSE"}
            </p>
            <p className="text-[11px] text-foreground/80 leading-relaxed whitespace-pre-line">
              {msg.content}
            </p>
          </motion.div>
        ))}
      </div>

      <div className="p-2 border-t border-panel-border">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Query intelligence database..."
            className="flex-1 bg-secondary/30 border border-panel-border rounded-sm px-3 py-1.5 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
          />
          <button className="bg-primary/10 border border-primary/30 text-primary text-[10px] font-mono px-3 py-1.5 rounded-sm hover:bg-primary/20 transition-colors">
            SEND
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIAssistant;
