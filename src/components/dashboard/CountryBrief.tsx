import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";

interface CountryScore {
  country_code: string;
  country_name: string;
  cii_score: number;
  signal_breakdown: Record<string, number>;
  trend_24h: number;
  trend_7d: number;
}

const COUNTRIES = [
  { code: "IR", name: "Iran", flag: "🇮🇷" },
  { code: "IL", name: "Israel", flag: "🇮🇱" },
  { code: "SA", name: "Saudi Arabia", flag: "🇸🇦" },
  { code: "AE", name: "UAE", flag: "🇦🇪" },
  { code: "YE", name: "Yemen", flag: "🇾🇪" },
  { code: "IQ", name: "Iraq", flag: "🇮🇶" },
  { code: "QA", name: "Qatar", flag: "🇶🇦" },
  { code: "BH", name: "Bahrain", flag: "🇧🇭" },
  { code: "OM", name: "Oman", flag: "🇴🇲" },
  { code: "KW", name: "Kuwait", flag: "🇰🇼" },
  { code: "SY", name: "Syria", flag: "🇸🇾" },
  { code: "LB", name: "Lebanon", flag: "🇱🇧" },
  { code: "US", name: "United States", flag: "🇺🇸" },
];

const scoreColor = (score: number) => {
  if (score > 70) return "text-crimson";
  if (score > 40) return "text-amber";
  return "text-tactical-green";
};

const trendArrow = (trend: number) => {
  if (trend > 3) return <span className="text-crimson">▲</span>;
  if (trend > 0) return <span className="text-amber">▲</span>;
  if (trend < -3) return <span className="text-tactical-green">▼</span>;
  if (trend < 0) return <span className="text-tactical-green">▼</span>;
  return <span className="text-muted-foreground">—</span>;
};

const CountryBrief = () => {
  const [scores, setScores] = useState<CountryScore[]>([]);

  useEffect(() => {
    const load = async () => {
      // Get latest score per country
      const { data } = await supabase
        .from("country_scores")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (data) {
        const latest: Record<string, CountryScore> = {};
        for (const r of data as any[]) {
          if (!latest[r.country_code]) {
            latest[r.country_code] = {
              country_code: r.country_code,
              country_name: r.country_name,
              cii_score: Number(r.cii_score) || 0,
              signal_breakdown: r.signal_breakdown || {},
              trend_24h: Number(r.trend_24h) || 0,
              trend_7d: Number(r.trend_7d) || 0,
            };
          }
        }
        // Sort by CII score descending
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
              <th className="text-center px-1 py-1">24h</th>
              <th className="text-center px-1 py-1">7d</th>
            </tr>
          </thead>
          <tbody>
            {displayCountries.map((c, i) => {
              const country = COUNTRIES.find(cc => cc.code === c.country_code);
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
                      <span className="text-xs">{country?.flag || "🏳️"}</span>
                      <span className="text-[9px] font-mono text-foreground/80">{c.country_name}</span>
                    </div>
                  </td>
                  <td className={`text-right px-1 py-1 text-[10px] font-mono font-bold ${scoreColor(c.cii_score)}`}>
                    {c.cii_score > 0 ? c.cii_score : "—"}
                  </td>
                  <td className="text-center px-1 py-1 text-[9px] font-mono">{trendArrow(c.trend_24h)}</td>
                  <td className="text-center px-1 py-1 text-[9px] font-mono">{trendArrow(c.trend_7d)}</td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default CountryBrief;
