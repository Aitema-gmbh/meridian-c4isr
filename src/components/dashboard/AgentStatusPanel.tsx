import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { apiFetch } from "@/lib/api";

interface AgentStatus {
  name: string;
  label: string;
  threatLevel: number;
  lastRun: string | null;
  itemsCount: number;
  confidence: string;
  minutesAgo: number | null;
  fresh: boolean;
  history: number[]; // threat levels over time for sparkline
}

interface AgentDetail {
  summary: string;
  data: Record<string, unknown>;
  threatLevel: number;
  confidence: string;
  itemsCount: number;
  createdAt: string;
}

const AGENT_CONFIG: { name: string; label: string; description: string; sources: string }[] = [
  { name: "flights", label: "ADS-B", description: "Military aircraft tracking via ADS-B Exchange", sources: "ADS-B.lol API (military aircraft)" },
  { name: "naval", label: "NAVAL", description: "Maritime patrol aircraft near strategic waters", sources: "ADS-B maritime patrol + GDELT naval" },
  { name: "ais", label: "AIS", description: "Chokepoint monitoring: Hormuz, Bab el-Mandeb, Suez", sources: "ADS-B patrol aircraft + GDELT maritime/tanker" },
  { name: "osint", label: "OSINT", description: "Open-source intelligence from global news (EN/AR/FA)", sources: "GDELT news (4 streams) + AI analysis" },
  { name: "telegram", label: "TGRAM", description: "Public Telegram channel monitoring (8 channels)", sources: "t.me/s/ HTML scraping + keyword scoring" },
  { name: "acled", label: "ACLED", description: "Armed conflict tracking across 7 focus countries", sources: "UCDP API + Google News RSS + GDELT conflict" },
  { name: "reddit", label: "REDDIT", description: "Social media intelligence from 4 geopolitical subreddits", sources: "Reddit RSS (geopolitics, worldnews, OSINT, iran)" },
  { name: "pentagon", label: "PENT", description: "US Department of Defense press releases", sources: "DoD press RSS feed" },
  { name: "cyber", label: "CYBER", description: "Cyber threat monitoring (state-sponsored, critical infrastructure)", sources: "GDELT cyber-specific queries" },
  { name: "markets", label: "MKTS", description: "Prediction market event probabilities", sources: "Polymarket events API" },
  { name: "wiki", label: "WIKI", description: "Wikipedia crisis page traffic spikes", sources: "Wikimedia pageviews API" },
  { name: "macro", label: "MACRO", description: "Macroeconomic risk signals (oil, gold, sanctions)", sources: "GDELT oil/gold/sanctions queries" },
  { name: "fires", label: "FIRES", description: "Satellite thermal anomaly detection (explosions, fires)", sources: "NASA FIRMS satellite + GDELT" },
  { name: "pizza", label: "PIZZA", description: "DOUGHCON: DC-area activity indicator", sources: "ADS-B DC-area + GDELT crisis activity" },
  { name: "head-analyst", label: "HEAD", description: "AI synthesis of all agent reports into unified threat assessment", sources: "All 14 collection agents via Claude AI" },
  { name: "thinktank", label: "THINK", description: "Red Team / Devil's Advocate contrarian analysis", sources: "All agents + threat assessment via Claude AI" },
];

const threatColor = (level: number) => {
  if (level > 70) return "text-crimson";
  if (level > 40) return "text-amber";
  return "text-tactical-green";
};

const threatBg = (level: number) => {
  if (level > 70) return "bg-crimson/15 border-crimson/30";
  if (level > 40) return "bg-amber/10 border-amber/30";
  return "bg-tactical-green/10 border-tactical-green/30";
};

const threatStroke = (level: number) => {
  if (level > 70) return "hsl(0 85% 55%)";
  if (level > 40) return "hsl(38 90% 55%)";
  return "hsl(185 80% 50%)";
};

const freshnessIcon = (fresh: boolean, minutesAgo: number | null) => {
  if (minutesAgo === null) return <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" title="No data" />;
  if (fresh) return <div className="h-1.5 w-1.5 rounded-full bg-tactical-green animate-pulse" title={`${minutesAgo}m ago`} />;
  return <div className="h-1.5 w-1.5 rounded-full bg-amber" title={`${minutesAgo}m ago — stale`} />;
};

// Mini SVG sparkline — 30x12px
const Sparkline = ({ data, color }: { data: number[]; color: string }) => {
  if (data.length < 2) return null;
  const w = 30, h = 12;
  const max = Math.max(...data, 1);
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (v / max) * h;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} className="opacity-60">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
};

// Larger sparkline for detail panel
const SparklineLarge = ({ data, color }: { data: number[]; color: string }) => {
  if (data.length < 2) return null;
  const w = 200, h = 50;
  const max = Math.max(...data, 1);
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (v / max) * h;
    return `${x},${y}`;
  }).join(" ");
  const fillPoints = `0,${h} ${points} ${w},${h}`;
  return (
    <svg width={w} height={h} className="w-full">
      <polygon points={fillPoints} fill={color} opacity="0.15" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
};

// Trend arrow
const TrendArrow = ({ history }: { history: number[] }) => {
  if (history.length < 2) return null;
  const latest = history[history.length - 1];
  const prev = history[history.length - 2];
  const diff = latest - prev;
  if (Math.abs(diff) < 3) return <span className="text-[7px] text-muted-foreground">&rarr;</span>;
  if (diff > 0) return <span className="text-[7px] text-crimson">&uarr;{Math.round(diff)}</span>;
  return <span className="text-[7px] text-tactical-green">&darr;{Math.abs(Math.round(diff))}</span>;
};

// Extract key items from agent data for display — agent-specific deep extraction
function extractAgentItems(name: string, data: Record<string, unknown>): string[] {
  const items: string[] = [];

  if (name === "head-analyst") {
    if (data.flashReport) items.push(`FLASH: ${String(data.flashReport).slice(0, 300)}`);
    if (data.analysisNarrative) items.push(String(data.analysisNarrative).slice(0, 300));
    const drivers = (data.keyDrivers || []) as string[];
    drivers.slice(0, 3).forEach(d => items.push(`KEY DRIVER: ${String(d).slice(0, 150)}`));
    const conflicts = (data.agentConflicts || []) as string[];
    conflicts.slice(0, 2).forEach(c => items.push(`CONFLICT: ${String(c).slice(0, 150)}`));
    const divs = (data.marketDivergences || []) as string[];
    divs.slice(0, 2).forEach(d => items.push(`MKT DIV: ${String(d).slice(0, 150)}`));
    return items;
  }

  if (name === "thinktank") {
    if (data.overallAssessment) items.push(`DISSENT: ${String(data.overallAssessment).slice(0, 250)}`);
    const scenarios = (data.alternativeScenarios || []) as Array<{ scenario?: string; probability?: number; reasoning?: string }>;
    scenarios.slice(0, 3).forEach(s => {
      const sc = typeof s === "string" ? s : s;
      const text = typeof sc === "string" ? sc : `${sc.scenario || "?"} (${sc.probability || "?"}%) — ${(sc.reasoning || "").slice(0, 100)}`;
      items.push(`SCENARIO: ${String(text).slice(0, 200)}`);
    });
    const blindSpots = (data.blindSpots || []) as string[];
    blindSpots.slice(0, 3).forEach(b => items.push(`BLIND SPOT: ${String(b).slice(0, 150)}`));
    const redFlags = (data.redFlags || []) as string[];
    redFlags.slice(0, 3).forEach(r => items.push(`RED FLAG: ${String(r).slice(0, 150)}`));
    const analogies = (data.historicalAnalogies || []) as Array<{ event?: string; year?: number; relevance?: string }>;
    analogies.slice(0, 2).forEach(a => {
      const text = typeof a === "string" ? a : `${a.event || "?"} (${a.year || "?"}) — ${(a.relevance || "").slice(0, 100)}`;
      items.push(`ANALOGY: ${String(text).slice(0, 180)}`);
    });
    const contrary = (data.contraryIndicators || []) as string[];
    contrary.slice(0, 2).forEach(c => items.push(`CONTRARY: ${String(c).slice(0, 150)}`));
    return items;
  }

  if (name === "telegram") {
    const posts = (data.posts || []) as Array<{ text?: string; channel?: string; relevanceScore?: number }>;
    items.push(`Channels active: ${data.channelsActive || "?"}/${data.channelsScraped || "?"} | Relevant: ${data.totalRelevant || "?"} | High-rel: ${data.highRelevance || "?"}`);
    const topKw = (data.topKeywords || []) as Array<{ keyword?: string; count?: number }>;
    if (topKw.length > 0) items.push(`Top keywords: ${topKw.slice(0, 5).map(k => `${k.keyword}(${k.count})`).join(", ")}`);
    posts.slice(0, 6).forEach(p => items.push(`[${p.channel || "?"}] (rel:${p.relevanceScore ?? "?"}) ${(p.text || "").slice(0, 140)}`));
    return items;
  }

  if (name === "markets") {
    const markets = (data.markets || data.events || data.questions || []) as Array<{ title?: string; probability?: number; yes_price?: number }>;
    markets.slice(0, 8).forEach(e => {
      const prob = e.probability ?? e.yes_price ?? 0;
      items.push(`${(prob * 100).toFixed(1)}% — ${(e.title || "?").slice(0, 120)}`);
    });
    const moves = (data.significantMoves || []) as string[];
    moves.slice(0, 3).forEach(m => items.push(`MOVE: ${String(m).slice(0, 150)}`));
    return items;
  }

  if (name === "flights") {
    items.push(`Regional: ${data.totalRegional || 0} | Global: ${data.totalGlobal || 0}`);
    const counts = data.counts as Record<string, number> | undefined;
    if (counts) {
      const countStr = Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(" | ");
      items.push(`Breakdown: ${countStr}`);
    }
    const orbits = (data.activeIsrOrbits || []) as Array<{ callsign?: string; type?: string }>;
    if (orbits.length > 0) items.push(`ISR Orbits: ${orbits.map(o => `${o.callsign}(${o.type})`).join(", ")}`);
    const tracked = (data.topAircraft || data.trackedAircraft || []) as Array<{ callsign?: string; type?: string; alt?: number; category?: string }>;
    tracked.slice(0, 6).forEach(a => items.push(`${a.callsign || "?"} | ${a.type || "?"} | ${a.alt || "?"}ft | ${a.category || ""}`));
    return items;
  }

  if (name === "naval") {
    const patrol = (data.patrolAircraft || []) as Array<{ callsign?: string; type?: string; region?: string }>;
    const regions = data.patrolRegions as Record<string, number> | undefined;
    if (regions) items.push(`Patrol regions: ${Object.entries(regions).map(([k, v]) => `${k}:${v}`).join(", ")}`);
    items.push(`Articles: ${data.navalArticleCount || 0}`);
    patrol.slice(0, 4).forEach(p => items.push(`PATROL: ${p.callsign || "?"} (${p.type || "?"}) — ${p.region || "?"}`));
    const articles = (data.articles || []) as Array<{ title?: string }>;
    articles.slice(0, 4).forEach(a => items.push(String(a.title || "").slice(0, 150)));
    return items;
  }

  if (name === "ais") {
    const alerts = (data.chokepointAlerts || []) as Array<{ name?: string; patrolCount?: number; articleCount?: number; riskScore?: number }>;
    alerts.forEach(a => items.push(`CHOKEPOINT: ${a.name || "?"} — Patrols: ${a.patrolCount || 0} | Articles: ${a.articleCount || 0} | Risk: ${a.riskScore || 0}`));
    items.push(`Incident articles: ${data.incidentArticles || 0}`);
    const tagged = (data.taggedArticles || data.articles || []) as Array<{ title?: string; tag?: string }>;
    tagged.slice(0, 5).forEach(a => items.push(`[${(a as any).tag || "AIS"}] ${String(a.title || "").slice(0, 140)}`));
    return items;
  }

  if (name === "acled") {
    const bd = data.countryBreakdown as Record<string, { events?: number; fatalities?: number }> | undefined;
    if (bd) {
      items.push(`Country breakdown:`);
      Object.entries(bd).slice(0, 7).forEach(([country, info]) => {
        items.push(`  ${country}: ${(info as any).events || 0} events, ${(info as any).fatalities || 0} fatalities`);
      });
    }
    items.push(`Total fatalities: ${data.totalFatalities || 0} | UCDP events: ${data.totalUcdpEvents || 0}`);
    const headlines = (data.rssHeadlines || []) as Array<{ title?: string }>;
    headlines.slice(0, 5).forEach(h => items.push(String(h.title || h).slice(0, 150)));
    return items;
  }

  if (name === "pentagon") {
    items.push(`Activity: ${data.activityIndex || 0} | Nighttime: ${data.nighttimeFlag ? "YES" : "NO"}`);
    const contracts = (data.contractAnomalies || []) as string[];
    contracts.slice(0, 3).forEach(c => items.push(`CONTRACT: ${String(c).slice(0, 150)}`));
    const relevant = (data.relevantItems || []) as Array<{ title?: string }>;
    relevant.slice(0, 5).forEach(r => items.push(String(r.title || r).slice(0, 150)));
    return items;
  }

  if (name === "cyber") {
    const apts = (data.activeAPTs || []) as string[];
    if (apts.length > 0) items.push(`Active APTs: ${apts.join(", ")}`);
    const articles = (data.articles || []) as Array<{ title?: string }>;
    articles.slice(0, 6).forEach(a => items.push(String(a.title || "").slice(0, 150)));
    return items;
  }

  if (name === "wiki") {
    const spikes = (data.topSpikes || []) as Array<{ article?: string; views?: number; ratio?: number; zScore?: number }>;
    spikes.slice(0, 8).forEach(s => items.push(`${s.article || "?"}: ${s.views || 0} views (z=${(s.zScore || 0).toFixed(1)}, ratio=${(s.ratio || 0).toFixed(1)}x)`));
    return items;
  }

  if (name === "macro") {
    items.push(`Oil articles: ${data.oilArticles || 0} | Gold: ${data.goldArticles || 0} | Sanctions: ${data.sanctionArticles || 0}`);
    const articles = (data.articles || []) as Array<{ title?: string }>;
    articles.slice(0, 5).forEach(a => items.push(String(a.title || "").slice(0, 150)));
    return items;
  }

  if (name === "fires") {
    items.push(`FIRMS fires: ${data.firmsFireCount || 0} | OSINT articles: ${data.osintArticles || 0}`);
    const alerts = (data.siteAlerts || []) as Array<{ site?: string; articleCount?: number }>;
    alerts.forEach(a => items.push(`ALERT: ${a.site || "?"} — ${a.articleCount || 0} articles`));
    const nearFires = (data.nearSiteFires || []) as Array<{ site?: string; distKm?: number }>;
    nearFires.slice(0, 4).forEach(f => items.push(`NEAR: ${f.site || "?"} — ${f.distKm || "?"}km`));
    const articles = (data.articles || []) as Array<{ title?: string }>;
    articles.slice(0, 3).forEach(a => items.push(String(a.title || "").slice(0, 150)));
    return items;
  }

  if (name === "pizza") {
    items.push(`DOUGHCON: ${data.doughcon || "?"} | Hour: ${data.estHour || "?"}ET | Late night: ${data.isLateNight ? "YES" : "NO"}`);
    const signals = data.signals as Record<string, unknown> | undefined;
    if (signals) {
      items.push(`Signals: VIP=${signals.vipCount || 0} CMD=${signals.commandCount || 0} LOG=${signals.logisticsCount || 0}`);
    }
    items.push(`Crisis articles: ${data.crisisArticles || 0} | Pentagon: ${data.pentagonArticles || 0}`);
    const dc = (data.dcAircraft || []) as Array<{ callsign?: string; type?: string; facility?: string; alt?: number }>;
    dc.slice(0, 5).forEach(a => items.push(`DC: ${a.callsign || "?"} (${a.type || "?"}) — ${a.facility || "?"} ${a.alt || "?"}ft`));
    return items;
  }

  // Generic fallback
  const articles = (data.articles || data.items || data.posts || data.reports || data.relevantItems || data.rssHeadlines || []) as Array<{ title?: string; text?: string }>;
  if (Array.isArray(articles)) {
    return articles.slice(0, 6).map(a => String(a.title || a.text || "").slice(0, 150));
  }
  return items;
}

// Extract key metrics from agent data — agent-specific deep extraction
function extractMetrics(name: string, data: Record<string, unknown>): Array<{ label: string; value: string | number }> {
  const metrics: Array<{ label: string; value: string | number }> = [];
  const num = (v: unknown) => typeof v === "number" ? Math.round(v * 100) / 100 : 0;

  // Agent-specific metrics
  if (name === "head-analyst") {
    if (data.tensionIndex != null) metrics.push({ label: "Tension Index", value: num(data.tensionIndex) });
    if (data.watchcon) metrics.push({ label: "WATCHCON", value: String(data.watchcon) });
    if (data.hormuzClosure != null) metrics.push({ label: "Hormuz Close %", value: num(data.hormuzClosure) });
    if (data.cyberAttack != null) metrics.push({ label: "Cyber Attack %", value: num(data.cyberAttack) });
    if (data.proxyEscalation != null) metrics.push({ label: "Proxy Escal %", value: num(data.proxyEscalation) });
    if (data.directConfrontation != null) metrics.push({ label: "Direct Conf %", value: num(data.directConfrontation) });
    if (data.sentimentScore != null) metrics.push({ label: "Sentiment", value: num(data.sentimentScore) });
    return metrics.slice(0, 8);
  }
  if (name === "thinktank") {
    if (data.dissentScore != null) metrics.push({ label: "Dissent Score", value: num(data.dissentScore) });
    if (data.confidenceInDissent != null) metrics.push({ label: "Confidence", value: num(data.confidenceInDissent) });
    return metrics;
  }
  if (name === "flights") {
    if (data.anomalyIndex != null) metrics.push({ label: "Anomaly Index", value: num(data.anomalyIndex) });
    if (data.totalRegional != null) metrics.push({ label: "Regional AC", value: num(data.totalRegional) });
    if (data.totalGlobal != null) metrics.push({ label: "Global AC", value: num(data.totalGlobal) });
    return metrics;
  }
  if (name === "ais") {
    if (data.maritimeThreatIndex != null) metrics.push({ label: "Maritime Threat", value: num(data.maritimeThreatIndex) });
    if (data.incidentArticles != null) metrics.push({ label: "Incidents", value: num(data.incidentArticles) });
    const alerts = (data.chokepointAlerts || []) as Array<{ name?: string; riskScore?: number }>;
    alerts.forEach(a => metrics.push({ label: String(a.name || "?").slice(0, 12), value: num(a.riskScore) }));
    return metrics.slice(0, 6);
  }
  if (name === "naval") {
    if (data.maritimeAnomalyIndex != null) metrics.push({ label: "Maritime Anomaly", value: num(data.maritimeAnomalyIndex) });
    if (data.navalArticleCount != null) metrics.push({ label: "Articles", value: num(data.navalArticleCount) });
    const patrol = (data.patrolAircraft || []) as unknown[];
    metrics.push({ label: "Patrol AC", value: patrol.length });
    return metrics;
  }
  if (name === "telegram") {
    if (data.telegramSignalIndex != null) metrics.push({ label: "Signal Index", value: num(data.telegramSignalIndex) });
    if (data.totalRelevant != null) metrics.push({ label: "Relevant Posts", value: num(data.totalRelevant) });
    if (data.highRelevance != null) metrics.push({ label: "High Relevance", value: num(data.highRelevance) });
    if (data.channelsActive != null) metrics.push({ label: "Active Ch.", value: num(data.channelsActive) });
    return metrics;
  }
  if (name === "acled") {
    if (data.conflictIntensityIndex != null) metrics.push({ label: "Conflict Intens.", value: num(data.conflictIntensityIndex) });
    if (data.totalFatalities != null) metrics.push({ label: "Fatalities", value: num(data.totalFatalities) });
    if (data.totalUcdpEvents != null) metrics.push({ label: "UCDP Events", value: num(data.totalUcdpEvents) });
    if (data.stateViolence != null) metrics.push({ label: "State Violence", value: num(data.stateViolence) });
    return metrics;
  }
  if (name === "macro") {
    if (data.macroRiskIndex != null) metrics.push({ label: "Macro Risk", value: num(data.macroRiskIndex) });
    if (data.oilScore != null) metrics.push({ label: "Oil Score", value: num(data.oilScore) });
    if (data.safeHavenScore != null) metrics.push({ label: "Safe Haven", value: num(data.safeHavenScore) });
    if (data.sanctionScore != null) metrics.push({ label: "Sanctions", value: num(data.sanctionScore) });
    return metrics;
  }
  if (name === "pizza") {
    if (data.pizzaIndex != null) metrics.push({ label: "DOUGHCON Index", value: num(data.pizzaIndex) });
    if (data.doughcon) metrics.push({ label: "DOUGHCON Level", value: String(data.doughcon) });
    if (data.vipCount != null) metrics.push({ label: "VIP Flights", value: num(data.vipCount) });
    if (data.commandCount != null) metrics.push({ label: "Command AC", value: num(data.commandCount) });
    return metrics;
  }
  if (name === "fires") {
    if (data.geoThermalIndex != null) metrics.push({ label: "Thermal Index", value: num(data.geoThermalIndex) });
    if (data.firmsFireCount != null) metrics.push({ label: "FIRMS Fires", value: num(data.firmsFireCount) });
    if (data.osintArticles != null) metrics.push({ label: "OSINT Articles", value: num(data.osintArticles) });
    return metrics;
  }

  // Generic fallback
  const metricKeys: Record<string, string> = {
    threatLevel: "Threat Level", sentimentScore: "Sentiment", maritimeAnomalyIndex: "Maritime Anomaly",
    maritimeThreatIndex: "Maritime Threat", flightAnomalyIndex: "Flight Anomaly", telegramSignalIndex: "Signal Index",
    conflictIntensityIndex: "Conflict Intensity", signalStrength: "Signal Strength", activityIndex: "Activity",
    cyberThreatLevel: "Cyber Threat", wikiCrisisIndex: "Wiki Crisis", macroRiskIndex: "Macro Risk",
    geoThermalIndex: "Thermal Index", pizzaIndex: "DOUGHCON Index", tensionIndex: "Tension Index",
    dissentScore: "Dissent Score",
  };
  for (const [key, label] of Object.entries(metricKeys)) {
    if (data[key] !== undefined && data[key] !== null) {
      metrics.push({ label, value: num(data[key]) });
    }
  }
  return metrics.slice(0, 6);
}

const AgentStatusPanel = () => {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [convergenceLevel, setConvergenceLevel] = useState(0);
  const [convergenceAgents, setConvergenceAgents] = useState<string[]>([]);
  const [cycleRunning, setCycleRunning] = useState(false);
  const [lastCycle, setLastCycle] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [agentDetail, setAgentDetail] = useState<AgentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [allReports, setAllReports] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    const load = async () => {
      // Fetch agent reports and timeline in parallel
      const [reportsData, timelineData] = await Promise.all([
        apiFetch<{ reports: Record<string, unknown>[] }>("/api/agent-reports", { hours: "6" }),
        apiFetch<{ timeline: Record<string, unknown>[] }>("/api/signal-timeline", { hours: "24" }).catch(() => ({ timeline: [] })),
      ]);

      const reports = reportsData?.reports;
      if (!reports) return;
      setAllReports(reports);

      // Get latest per agent
      const latest: Record<string, any> = {};
      for (const r of reports) {
        if (!latest[r.agent_name]) latest[r.agent_name] = r;
      }

      // Build history per agent from timeline
      const historyMap: Record<string, number[]> = {};
      const timeline = timelineData?.timeline || [];
      for (const entry of timeline) {
        const name = entry.agent_name as string;
        if (!historyMap[name]) historyMap[name] = [];
        historyMap[name].push(Number(entry.threat_level) || 0);
      }
      // Reverse so oldest first (timeline comes newest-first)
      for (const name of Object.keys(historyMap)) {
        historyMap[name].reverse();
      }

      const statuses: AgentStatus[] = AGENT_CONFIG.map(cfg => {
        const r = latest[cfg.name];
        const minutesAgo = r ? Math.round((Date.now() - new Date(r.created_at).getTime()) / 60000) : null;
        return {
          name: cfg.name,
          label: cfg.label,
          threatLevel: r ? Number(r.threat_level) || 0 : 0,
          lastRun: r?.created_at || null,
          itemsCount: r?.items_count || 0,
          confidence: r?.confidence || "\u2014",
          minutesAgo,
          fresh: minutesAgo !== null && minutesAgo < 60,
          history: historyMap[cfg.name] || [],
        };
      });

      setAgents(statuses);

      // Convergence detection: 3+ agents with threat > 50
      const elevated = statuses.filter(s => s.threatLevel > 50 && s.name !== "head-analyst" && s.fresh);
      setConvergenceLevel(elevated.length);
      setConvergenceAgents(elevated.map(s => s.label));
    };

    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleAgentClick = useCallback((agentName: string) => {
    if (selectedAgent === agentName) {
      setSelectedAgent(null);
      setAgentDetail(null);
      return;
    }
    setSelectedAgent(agentName);
    setDetailLoading(true);

    // Find latest report for this agent from already-loaded data
    const report = allReports.find(r => r.agent_name === agentName);
    if (report) {
      setAgentDetail({
        summary: String(report.summary || "No summary available"),
        data: (report.data || {}) as Record<string, unknown>,
        threatLevel: Number(report.threat_level) || 0,
        confidence: String(report.confidence || "\u2014"),
        itemsCount: Number(report.items_count) || 0,
        createdAt: String(report.created_at || ""),
      });
    } else {
      setAgentDetail(null);
    }
    setDetailLoading(false);
  }, [selectedAgent, allReports]);

  const runCycle = async () => {
    if (cycleRunning) return;
    setCycleRunning(true);
    try {
      const API_BASE = import.meta.env.VITE_API_BASE_URL || "https://meridian-api.dieter-meier82.workers.dev";
      // Phase 1: Collection agents
      const resp = await fetch(`${API_BASE}/api/run-cycle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      let totalOk = 0, totalAgents = 0, totalMs = 0;
      if (resp.ok) {
        const data = await resp.json() as { successCount: number; totalAgents: number; totalMs: number };
        totalOk = data.successCount;
        totalAgents = data.totalAgents;
        totalMs = data.totalMs;
      }
      // Phase 2: Synthesis agents (separate request to avoid subrequest limit)
      const synResp = await fetch(`${API_BASE}/api/run-synthesis`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (synResp.ok) {
        const synData = await synResp.json() as { successCount: number; totalAgents: number; totalMs: number };
        totalOk += synData.successCount;
        totalAgents += synData.totalAgents;
        totalMs += synData.totalMs;
      }
      setLastCycle(`${totalOk}/${totalAgents} OK (${Math.round(totalMs / 1000)}s)`);
    } catch (e) {
      console.error("Cycle error:", e);
    } finally {
      setCycleRunning(false);
    }
  };

  const selectedConfig = selectedAgent ? AGENT_CONFIG.find(c => c.name === selectedAgent) : null;
  const selectedStatus = selectedAgent ? agents.find(a => a.name === selectedAgent) : null;

  return (
    <div className="flex flex-col h-full relative">
      {/* Header with Run Cycle button */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-panel-border bg-panel-header shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Agent Status</span>
          {lastCycle && <span className="text-[7px] font-mono text-tactical-green">{lastCycle}</span>}
        </div>
        <button
          onClick={runCycle}
          disabled={cycleRunning}
          className={`text-[8px] font-mono px-2 py-0.5 rounded-sm border transition-colors ${
            cycleRunning
              ? "border-amber/30 text-amber bg-amber/10 animate-pulse"
              : "border-primary/30 text-primary hover:bg-primary/10"
          }`}
        >
          {cycleRunning ? "RUNNING CYCLE..." : "\u21BB RUN ALL"}
        </button>
      </div>

      {/* Convergence Alert */}
      {convergenceLevel >= 3 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-2 mt-2 px-2 py-1.5 rounded-sm border border-crimson/50 bg-crimson/10"
        >
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-crimson animate-pulse" />
            <span className="text-[9px] font-mono text-crimson font-bold">CONVERGENCE ALERT</span>
          </div>
          <p className="text-[8px] font-mono text-crimson/80 mt-0.5">
            {convergenceLevel} agents elevated: {convergenceAgents.join(", ")}
          </p>
        </motion.div>
      )}

      {/* Agent grid */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="grid grid-cols-4 gap-1 auto-rows-min">
          {agents.map(agent => (
            <motion.div
              key={agent.name}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={() => handleAgentClick(agent.name)}
              className={`border rounded-sm p-1.5 cursor-pointer transition-all hover:brightness-125 ${threatBg(agent.threatLevel)} ${selectedAgent === agent.name ? "ring-1 ring-primary" : ""}`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[8px] font-mono font-bold text-foreground/80">{agent.label}</span>
                {freshnessIcon(agent.fresh, agent.minutesAgo)}
              </div>
              <div className="flex items-center justify-between">
                <p className={`text-sm font-mono font-bold ${threatColor(agent.threatLevel)}`}>
                  {agent.threatLevel}
                </p>
                <Sparkline data={agent.history} color={threatStroke(agent.threatLevel)} />
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[7px] font-mono text-muted-foreground">{agent.itemsCount} items</span>
                <TrendArrow history={agent.history} />
              </div>
            </motion.div>
          ))}
        </div>

        {/* Agent Detail Panel (inline below grid) */}
        <AnimatePresence>
          {selectedAgent && selectedConfig && selectedStatus && (
            <motion.div
              key={selectedAgent}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="mt-2 overflow-hidden"
            >
              <div className={`border rounded-sm p-3 ${threatBg(selectedStatus.threatLevel)}`}>
                {/* Detail Header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold text-foreground">{selectedConfig.label}</span>
                    <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded-sm ${
                      selectedStatus.fresh ? "bg-tactical-green/20 text-tactical-green" : "bg-amber/20 text-amber"
                    }`}>
                      {selectedStatus.fresh ? "LIVE" : "STALE"}
                    </span>
                    <span className="text-[8px] font-mono text-muted-foreground">
                      {selectedStatus.confidence}
                    </span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectedAgent(null); setAgentDetail(null); }}
                    className="text-[9px] font-mono text-muted-foreground hover:text-foreground"
                  >
                    [X]
                  </button>
                </div>

                {/* Description */}
                <p className="text-[9px] font-mono text-foreground/70 mb-2">{selectedConfig.description}</p>
                <p className="text-[8px] font-mono text-muted-foreground mb-2">Sources: {selectedConfig.sources}</p>

                {/* Threat Level + Large Sparkline */}
                <div className="flex items-center gap-3 mb-2">
                  <div className="text-center">
                    <p className={`text-2xl font-mono font-bold ${threatColor(selectedStatus.threatLevel)}`}>
                      {selectedStatus.threatLevel}
                    </p>
                    <p className="text-[7px] font-mono text-muted-foreground">THREAT</p>
                  </div>
                  <div className="flex-1">
                    <SparklineLarge data={selectedStatus.history} color={threatStroke(selectedStatus.threatLevel)} />
                    <p className="text-[7px] font-mono text-muted-foreground text-right">24h history</p>
                  </div>
                </div>

                {/* Metrics */}
                {agentDetail && (
                  <>
                    {extractMetrics(selectedAgent, agentDetail.data).length > 0 && (
                      <div className="grid grid-cols-3 gap-1 mb-2">
                        {extractMetrics(selectedAgent, agentDetail.data).map((m, i) => (
                          <div key={i} className="bg-background/30 rounded-sm px-1.5 py-1 text-center">
                            <p className="text-[10px] font-mono font-bold text-foreground">{m.value}</p>
                            <p className="text-[7px] font-mono text-muted-foreground">{m.label}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Summary */}
                    {agentDetail.summary && agentDetail.summary !== "No summary available" && (
                      <div className="mb-2">
                        <p className="text-[8px] font-mono text-muted-foreground uppercase mb-0.5">Summary</p>
                        <p className="text-[9px] font-mono text-foreground/80 leading-relaxed">
                          {agentDetail.summary.slice(0, 500)}
                        </p>
                      </div>
                    )}

                    {/* Items */}
                    {extractAgentItems(selectedAgent, agentDetail.data).length > 0 && (
                      <div>
                        <p className="text-[8px] font-mono text-muted-foreground uppercase mb-0.5">Latest Items</p>
                        <div className="space-y-0.5">
                          {extractAgentItems(selectedAgent, agentDetail.data).map((item, i) => (
                            <div key={i} className="flex gap-1">
                              <span className="text-[7px] font-mono text-primary shrink-0">&gt;</span>
                              <p className="text-[8px] font-mono text-foreground/70 leading-tight">{item}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Timestamp */}
                    <p className="text-[7px] font-mono text-muted-foreground mt-2 text-right">
                      Last update: {agentDetail.createdAt ? new Date(agentDetail.createdAt).toLocaleString() : "\u2014"}
                    </p>
                  </>
                )}

                {detailLoading && (
                  <p className="text-[8px] font-mono text-muted-foreground animate-pulse">Loading details...</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default AgentStatusPanel;
