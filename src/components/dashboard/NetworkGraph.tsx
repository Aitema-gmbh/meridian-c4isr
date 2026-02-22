import { useEffect, useRef, useCallback } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { MOCK_NETWORK_NODES, MOCK_NETWORK_LINKS } from "@/data/mockData";

const groupColors: Record<string, string> = {
  iran: "hsl(0, 85%, 55%)",
  proxy: "hsl(0, 60%, 45%)",
  us: "hsl(185, 80%, 50%)",
  leader: "hsl(38, 90%, 55%)",
  sanctions: "hsl(270, 60%, 55%)",
  economic: "hsl(38, 60%, 40%)",
};

const NetworkGraph = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);

  const graphData = {
    nodes: MOCK_NETWORK_NODES.map((n) => ({ ...n })),
    links: MOCK_NETWORK_LINKS.map((l) => ({ ...l })),
  };

  const nodeCanvasObject = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const label = node.label;
    const fontSize = Math.max(10 / globalScale, 2);
    ctx.font = `${fontSize}px 'JetBrains Mono'`;
    const color = groupColors[node.group] || "hsl(200, 20%, 50%)";

    // Node
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.val / 3, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.7;
    ctx.fill();
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / globalScale;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Label
    ctx.fillStyle = "hsl(200, 20%, 85%)";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(label, node.x, node.y + node.val / 3 + 2);
  }, []);

  return (
    <div className="panel-tactical flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border bg-panel-header">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-amber animate-pulse-glow" />
          <span className="text-[11px] font-mono uppercase tracking-wider text-amber">
            Intelligence Network Graph
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground">ENTITY ANALYSIS</span>
      </div>

      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        <ForceGraph2D
          ref={graphRef}
          graphData={graphData}
          backgroundColor="hsl(220, 18%, 5%)"
          nodeCanvasObject={nodeCanvasObject}
          linkColor={() => "hsl(220, 15%, 20%)"}
          linkWidth={0.5}
          linkDirectionalParticles={1}
          linkDirectionalParticleWidth={1.5}
          linkDirectionalParticleColor={() => "hsl(185, 80%, 50%)"}
          width={500}
          height={350}
          cooldownTime={3000}
          d3AlphaDecay={0.02}
        />

        {/* Legend */}
        <div className="absolute bottom-2 left-2 bg-background/80 border border-panel-border rounded-sm p-2 flex flex-col gap-1">
          {Object.entries(groupColors).map(([group, color]) => (
            <div key={group} className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-[9px] text-muted-foreground font-mono uppercase">{group}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default NetworkGraph;
