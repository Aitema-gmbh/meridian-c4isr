import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { apiFetch } from "@/lib/api";

// Entity dictionary for Iran/US crisis context
const ENTITY_DICT: Array<{ id: string; label: string; group: string; keywords: string[] }> = [
  // Iran
  { id: "IRGC", label: "IRGC", group: "iran", keywords: ["irgc", "irgcn", "revolutionary guard"] },
  { id: "Khamenei", label: "Khamenei", group: "leader", keywords: ["khamenei", "supreme leader"] },
  { id: "Pezeshkian", label: "Pezeshkian", group: "leader", keywords: ["pezeshkian"] },
  { id: "Iran", label: "Iran", group: "iran", keywords: ["iran", "tehran"] },
  // Proxies
  { id: "Hezbollah", label: "Hezbollah", group: "proxy", keywords: ["hezbollah"] },
  { id: "Houthis", label: "Houthis", group: "proxy", keywords: ["houthi", "ansar allah"] },
  { id: "Hamas", label: "Hamas", group: "proxy", keywords: ["hamas"] },
  { id: "PMF", label: "PMF/Hashd", group: "proxy", keywords: ["pmf", "hashd", "popular mobilization"] },
  // US/Western
  { id: "CENTCOM", label: "CENTCOM", group: "us", keywords: ["centcom"] },
  { id: "Pentagon", label: "Pentagon", group: "us", keywords: ["pentagon", "dod", "defense dept"] },
  { id: "USNavy", label: "US Navy", group: "us", keywords: ["5th fleet", "us navy", "navcent", "destroyer", "carrier"] },
  { id: "Trump", label: "Trump", group: "leader", keywords: ["trump", "white house"] },
  // Israel
  { id: "Israel", label: "Israel", group: "us", keywords: ["israel", "idf", "netanyahu", "tel aviv"] },
  // Nuclear
  { id: "Nuclear", label: "Nuclear", group: "nuclear", keywords: ["nuclear", "enrichment", "fordow", "natanz", "centrifuge", "iaea"] },
  // Maritime
  { id: "Hormuz", label: "Hormuz", group: "maritime", keywords: ["hormuz", "strait of hormuz"] },
  { id: "RedSea", label: "Red Sea", group: "maritime", keywords: ["red sea", "bab el-mandeb", "bab al-mandab"] },
  { id: "Suez", label: "Suez", group: "maritime", keywords: ["suez canal"] },
  // Regional
  { id: "Saudi", label: "Saudi", group: "regional", keywords: ["saudi", "riyadh"] },
  { id: "UAE", label: "UAE", group: "regional", keywords: ["uae", "emirates", "dubai"] },
  { id: "Iraq", label: "Iraq", group: "regional", keywords: ["iraq", "baghdad"] },
  { id: "Yemen", label: "Yemen", group: "proxy", keywords: ["yemen", "sanaa"] },
  { id: "Lebanon", label: "Lebanon", group: "proxy", keywords: ["lebanon", "beirut"] },
  { id: "Syria", label: "Syria", group: "regional", keywords: ["syria", "damascus"] },
  // Economic
  { id: "Oil", label: "Oil/Energy", group: "economic", keywords: ["oil", "crude", "tanker", "energy", "opec"] },
  { id: "Sanctions", label: "Sanctions", group: "sanctions", keywords: ["sanction", "ofac", "treasury"] },
  // Cyber
  { id: "Cyber", label: "Cyber", group: "cyber", keywords: ["cyber", "hack", "malware", "apt"] },
  // Military hardware
  { id: "Missiles", label: "Missiles", group: "military", keywords: ["missile", "ballistic", "cruise", "shahed", "drone strike"] },
];

const groupColors: Record<string, string> = {
  iran: "hsl(0, 85%, 55%)",
  proxy: "hsl(0, 60%, 45%)",
  us: "hsl(185, 80%, 50%)",
  leader: "hsl(38, 90%, 55%)",
  sanctions: "hsl(270, 60%, 55%)",
  economic: "hsl(38, 60%, 40%)",
  nuclear: "hsl(120, 70%, 45%)",
  maritime: "hsl(200, 70%, 50%)",
  regional: "hsl(30, 50%, 50%)",
  cyber: "hsl(280, 70%, 60%)",
  military: "hsl(350, 80%, 50%)",
};

interface GraphNode {
  id: string;
  label: string;
  group: string;
  val: number;
}

interface GraphLink {
  source: string;
  target: string;
  value: number;
}

function extractEntities(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const entity of ENTITY_DICT) {
    if (entity.keywords.some(k => lower.includes(k))) {
      found.push(entity.id);
    }
  }
  return found;
}

function buildGraphFromReports(reports: Record<string, unknown>[]): { nodes: GraphNode[]; links: GraphLink[] } {
  const entityCounts: Record<string, number> = {};
  const coOccurrence: Record<string, number> = {};

  for (const report of reports) {
    // Collect all text from this report
    const texts: string[] = [];
    if (report.summary) texts.push(String(report.summary));

    const data = report.data as Record<string, unknown> | undefined;
    if (data) {
      // Articles from various agents
      const articles = (data.articles || data.items || []) as Array<{ title?: string; content?: string }>;
      for (const a of articles) {
        if (a.title) texts.push(a.title);
        if (a.content) texts.push(String(a.content).slice(0, 200));
      }
      // Analysis narrative
      if (data.analysis_narrative) texts.push(String(data.analysis_narrative));
      if (data.analysis) texts.push(String(data.analysis));
      if (data.narrative) texts.push(String(data.narrative));
    }

    const combined = texts.join(" ");
    const entities = extractEntities(combined);
    const unique = [...new Set(entities)];

    // Count entities
    for (const e of unique) {
      entityCounts[e] = (entityCounts[e] || 0) + 1;
    }

    // Co-occurrence: every pair in the same report
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const key = [unique[i], unique[j]].sort().join("||");
        coOccurrence[key] = (coOccurrence[key] || 0) + 1;
      }
    }
  }

  // Build nodes — only entities mentioned at least once
  const nodes: GraphNode[] = [];
  for (const entity of ENTITY_DICT) {
    const count = entityCounts[entity.id];
    if (count) {
      nodes.push({
        id: entity.id,
        label: entity.label,
        group: entity.group,
        val: Math.min(6 + count * 2.5, 25),
      });
    }
  }

  // Build links — co-occurrences with minimum threshold
  const links: GraphLink[] = [];
  const nodeIds = new Set(nodes.map(n => n.id));
  for (const [key, count] of Object.entries(coOccurrence)) {
    if (count < 1) continue;
    const [source, target] = key.split("||");
    if (nodeIds.has(source) && nodeIds.has(target)) {
      links.push({ source, target, value: count });
    }
  }

  return { nodes, links };
}

const NetworkGraph = () => {
  const graphRef = useRef<any>(null);
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] });
  const [nodeCount, setNodeCount] = useState(0);
  const [linkCount, setLinkCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        // Try API-based entity graph first
        const apiData = await apiFetch<{
          nodes: Array<{ id: number; label: string; group: string; mentions: number; val: number }>;
          links: Array<{ source: number; target: number; strength: number; count: number }>;
        }>("/api/entities", { hours: "48" }).catch(() => null);

        if (apiData?.nodes && apiData.nodes.length > 0) {
          setGraphData({
            nodes: apiData.nodes.map(n => ({ id: String(n.id), label: n.label, group: n.group, val: n.val })),
            links: apiData.links.map(l => ({ source: String(l.source), target: String(l.target), value: l.strength })),
          });
          setNodeCount(apiData.nodes.length);
          setLinkCount(apiData.links.length);
        } else {
          // Fallback to client-side extraction (existing logic)
          const data = await apiFetch<{ reports: Record<string, unknown>[] }>("/api/agent-reports", { hours: "6" });
          if (data?.reports) {
            const { nodes, links } = buildGraphFromReports(data.reports);
            setGraphData({ nodes: nodes.map(n => ({ ...n })), links: links.map(l => ({ ...l })) });
            setNodeCount(nodes.length);
            setLinkCount(links.length);
          }
        }
      } catch (e) {
        console.error("NetworkGraph fetch error:", e);
      } finally {
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 120000);
    return () => clearInterval(interval);
  }, []);

  const nodeCanvasObject = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const label = node.label;
    const fontSize = Math.max(10 / globalScale, 2);
    ctx.font = `${fontSize}px 'JetBrains Mono'`;
    const color = groupColors[node.group] || "hsl(200, 20%, 50%)";
    const r = node.val / 3;

    // Glow for high-val nodes
    if (node.val > 15) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 3, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.15;
      ctx.fill();
    }

    // Node
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.75;
    ctx.fill();
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / globalScale;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Label
    ctx.fillStyle = "hsl(200, 20%, 85%)";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(label, node.x, node.y + r + 2);
  }, []);

  const linkCanvasObject = useCallback((link: any, ctx: CanvasRenderingContext2D) => {
    const source = link.source;
    const target = link.target;
    if (!source?.x || !target?.x) return;

    ctx.beginPath();
    ctx.moveTo(source.x, source.y);
    ctx.lineTo(target.x, target.y);
    const w = Math.min(link.value || 1, 4);
    ctx.lineWidth = w * 0.4;
    ctx.strokeStyle = `hsla(220, 15%, 30%, ${Math.min(0.15 + (link.value || 1) * 0.1, 0.6)})`;
    ctx.stroke();
  }, []);

  // Legend — only show groups that have nodes
  const activeGroups = useMemo(() => {
    const groups = new Set(graphData.nodes.map(n => n.group));
    return Object.entries(groupColors).filter(([g]) => groups.has(g));
  }, [graphData.nodes]);

  return (
    <div className="panel-tactical flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border bg-panel-header">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-amber animate-pulse-glow" />
          <span className="text-[11px] font-mono uppercase tracking-wider text-amber">
            Entity Network
          </span>
        </div>
        <span className="text-[9px] font-mono text-muted-foreground">
          {loading ? "LOADING..." : `${nodeCount}N ${linkCount}L`}
        </span>
      </div>

      <div className="flex-1 relative overflow-hidden">
        {graphData.nodes.length > 0 ? (
          <ForceGraph2D
            ref={graphRef}
            graphData={graphData}
            backgroundColor="hsl(220, 18%, 5%)"
            nodeCanvasObject={nodeCanvasObject}
            linkCanvasObjectMode={() => "replace"}
            linkCanvasObject={linkCanvasObject}
            linkDirectionalParticles={(link: any) => (link.value || 1) > 2 ? 1 : 0}
            linkDirectionalParticleWidth={1.5}
            linkDirectionalParticleColor={() => "hsl(185, 80%, 50%)"}
            width={500}
            height={350}
            cooldownTime={3000}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
          />
        ) : !loading ? (
          <div className="flex items-center justify-center h-full text-[10px] font-mono text-muted-foreground">
            No entity data available
          </div>
        ) : null}

        {/* Legend */}
        {activeGroups.length > 0 && (
          <div className="absolute bottom-2 left-2 bg-background/80 border border-panel-border rounded-sm p-1.5 flex flex-col gap-0.5">
            {activeGroups.map(([group, color]) => (
              <div key={group} className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-[7px] text-muted-foreground font-mono uppercase">{group}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(NetworkGraph);
