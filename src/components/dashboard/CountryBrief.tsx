import { useState, useEffect, memo } from "react";
import { motion } from "framer-motion";
import { apiFetch } from "@/lib/api";

interface CountryScore {
  country_code: string;
  country_name: string;
  cii_score: number;
  signal_breakdown: Record<string, number>;
  trend_24h: number;
  trend_7d: number;
}

interface TrajectoryResult {
  slope: number;
  rSquared: number;
  classification: "improving" | "stable" | "deteriorating";
  confidence: number;
  dataPoints: number;
  projectedNext: number;
}

interface TrajectoryResponse {
  countryTrajectories: Record<string, TrajectoryResult>;
}

const COUNTRIES = [
  { code: "IR", name: "Iran", flag: "\u{1F1EE}\u{1F1F7}" },
  { code: "IL", name: "Israel", flag: "\u{1F1EE}\u{1F1F1}" },
  { code: "SA", name: "Saudi Arabia", flag: "\u{1F1F8}\u{1F1E6}" },
  { code: "AE", name: "UAE", flag: "\u{1F1E6}\u{1F1EA}" },
  { code: "YE", name: "Yemen", flag: "\u{1F1FE}\u{1F1EA}" },
  { code: "IQ", name: "Iraq", flag: "\u{1F1EE}\u{1F1F6}" },
  { code: "QA", name: "Qatar", flag: "\u{1F1F6}\u{1F1E6}" },
  { code: "BH", name: "Bahrain", flag: "\u{1F1E7}\u{1F1ED}" },
  { code: "OM", name: "Oman", flag: "\u{1F1F4}\u{1F1F2}" },
  { code: "KW", name: "Kuwait", flag: "\u{1F1F0}\u{1F1FC}" },
  { code: "SY", name: "Syria", flag: "\u{1F1F8}\u{1F1FE}" },
  { code: "LB", name: "Lebanon", flag: "\u{1F1F1}\u{1F1E7}" },
  { code: "US", name: "United States", flag: "\u{1F1FA}\u{1F1F8}" },
];

const scoreColor = (score: number) => {
  if (score > 70) return "text-crimson";
  if (score > 40) return "text-amber";
  return "text-tactical-green";
};

const scoreStroke = (score: number) => {
  if (score > 70) return "hsl(0 85% 55%)";
  if (score > 40) return "hsl(38 90% 55%)";
  return "hsl(185 80% 50%)";
};

const trendArrow = (trend: number) => {
  if (trend > 3) return <span className="text-crimson">{"\u25B2"}</span>;
  if (trend > 0) return <span className="text-amber">{"\u25B2"}</span>;
  if (trend < -3) return <span className="text-tactical-green">{"\u25BC"}</span>;
  if (trend < 0) return <span className="text-tactical-green">{"\u25BC"}</span>;
  return <span className="text-muted-foreground">{"\u2014"}</span>;
};

// Mini SVG sparkline for CII history
const CiiSparkline = ({ data, color }: { data: number[]; color: string }) => {
  if (data.length < 2) return null;
  const w = 36, h = 12;
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

const trajectoryBadge = (traj?: TrajectoryResult) => {
  if (!traj || traj.dataPoints < 3) return null;
  if (traj.classification === "deteriorating") return <span className="text-crimson text-[8px] font-mono" title={`slope ${traj.slope > 0 ? "+" : ""}${traj.slope}/pt R²=${traj.rSquared}`}>↗</span>;
  if (traj.classification === "improving") return <span className="text-green-400 text-[8px] font-mono" title={`slope ${traj.slope > 0 ? "+" : ""}${traj.slope}/pt R²=${traj.rSquared}`}>↘</span>;
  return <span className="text-muted-foreground text-[7px] font-mono" title={`slope ${traj.slope > 0 ? "+" : ""}${traj.slope}/pt R²=${traj.rSquared}`}>→</span>;
};

const CountryBrief = () => {
  const [scores, setScores] = useState<CountryScore[]>([]);
  const [history, setHistory] = useState<Record<string, number[]>>({});
  const [trajectories, setTrajectories] = useState<Record<string, TrajectoryResult>>({});

  useEffect(() => {
    // Load trajectories
    apiFetch<TrajectoryResponse>("/api/trajectories", { hours: "168" })
      .then(resp => { if (resp.countryTrajectories) setTrajectories(resp.countryTrajectories); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const load = async () => {
      const { scores: rows } = await apiFetch<{ scores: Record<string, unknown>[] }>("/api/country-scores");
      if (rows) {
        // Build history per country (rows come newest-first)
        const historyMap: Record<string, number[]> = {};
        const latest: Record<string, CountryScore> = {};
        for (const r of rows) {
          const code = String(r.country_code);
          if (!historyMap[code]) historyMap[code] = [];
          historyMap[code].push(Number(r.cii_score) || 0);
          if (!latest[code]) {
            latest[code] = {
              country_code: code,
              country_name: String(r.country_name),
              cii_score: Number(r.cii_score) || 0,
              signal_breakdown: (r.signal_breakdown as Record<string, number>) || {},
              trend_24h: Number(r.trend_24h) || 0,
              trend_7d: Number(r.trend_7d) || 0,
            };
          }
        }
        // Reverse so oldest first for sparkline
        for (const code of Object.keys(historyMap)) {
          historyMap[code].reverse();
        }
        setHistory(historyMap);
        const sorted = Object.values(latest).sort((a, b) => b.cii_score - a.cii_score);
        setScores(sorted);
      }
    };
    load();
    const interval = setInterval(load, 120000);
    return () => clearInterval(interval);
  }, []);

  // If no DB scores yet, show placeholder countries
  const displayCountries = scores.length > 0
    ? scores
    : COUNTRIES.map(c => ({ country_code: c.code, country_name: c.name, cii_score: 0, signal_breakdown: {}, trend_24h: 0, trend_7d: 0 }));

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-panel-border bg-panel-header shrink-0">
        <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Country Instability Index</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full">
          <thead>
            <tr className="text-[7px] font-mono text-muted-foreground uppercase">
              <th className="text-left px-2 py-1">Country</th>
              <th className="text-right px-1 py-1">CII</th>
              <th className="text-center px-1 py-1">Trend</th>
              <th className="text-left px-1 py-1">Signals</th>
              <th className="text-center px-1 py-1">24h</th>
              <th className="text-center px-1 py-1">7d</th>
            </tr>
          </thead>
          <tbody>
            {displayCountries.map((c, i) => {
              const country = COUNTRIES.find(cc => cc.code === c.country_code);
              const signals = c.signal_breakdown || {};
              const signalBars = Object.entries(signals)
                .filter(([, v]) => v > 0)
                .sort((a, b) => b[1] - a[1]);
              const histData = history[c.country_code] || [];
              return (
                <motion.tr
                  key={c.country_code}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="border-t border-panel-border/50 hover:bg-secondary/20 transition-colors"
                >
                  <td className="px-2 py-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs">{country?.flag || ""}</span>
                      <span className="text-[9px] font-mono text-foreground/80">{c.country_name}</span>
                    </div>
                  </td>
                  <td className={`text-right px-1 py-1 text-[10px] font-mono font-bold ${scoreColor(c.cii_score)}`}>
                    {c.cii_score > 0 ? c.cii_score : "\u2014"}
                  </td>
                  <td className="px-1 py-1">
                    <CiiSparkline data={histData} color={scoreStroke(c.cii_score)} />
                  </td>
                  <td className="px-1 py-1">
                    <div className="flex gap-0.5">
                      {signalBars.slice(0, 4).map(([key, val]) => (
                        <div
                          key={key}
                          className="h-2 rounded-sm"
                          style={{
                            width: `${Math.max(3, val * 0.8)}px`,
                            backgroundColor: key === "conflict" || key === "maritime" ? "hsl(0 85% 55%)" : key === "cyber" ? "hsl(280 70% 60%)" : key === "social" ? "hsl(185 80% 50%)" : "hsl(38 90% 55%)",
                            opacity: 0.7,
                          }}
                          title={`${key}: ${val}`}
                        />
                      ))}
                    </div>
                  </td>
                  <td className="text-center px-1 py-1 text-[9px] font-mono">{trendArrow(c.trend_24h)}</td>
                  <td className="text-center px-1 py-1 text-[9px] font-mono">{trajectoryBadge(trajectories[c.country_code])}</td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default memo(CountryBrief);
