'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

// Dynamically import the force graph to avoid SSR issues
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

interface NetworkNode {
  id: string;
  name: string;
  status: 'online' | 'busy' | 'offline';
  tasks: number;
  capabilities: string[];
  rating: number;
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
}

interface NetworkLink {
  source: string;
  target: string;
  type: 'match' | 'collaboration' | 'referral';
  strength: number;
}

interface NetworkData {
  nodes: NetworkNode[];
  links: NetworkLink[];
}

interface NetworkGraphProps {
  width?: number;
  height?: number;
}

export default function NetworkGraph({ width = 800, height = 600 }: NetworkGraphProps) {
  const [networkData, setNetworkData] = useState<NetworkData>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<NetworkNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<NetworkNode | null>(null);
  const graphRef = useRef<any>();

  // Fetch network data
  useEffect(() => {
    async function fetchNetworkData() {
      try {
        const response = await fetch('/api/network');
        const data = await response.json();
        if (data.success) {
          setNetworkData(data.data);
        }
      } catch (error) {
        console.error('Failed to fetch network data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchNetworkData();
    // Refresh every 30 seconds
    const interval = setInterval(fetchNetworkData, 30000);
    return () => clearInterval(interval);
  }, []);

  // Node color based on status
  const getNodeColor = (node: any) => {
    switch (node.status) {
      case 'online':
        return '#22C55E'; // Green for online
      case 'busy':
        return '#F97316'; // Orange for busy/active agents
      case 'offline':
      default:
        return '#6B7280'; // Gray for offline
    }
  };

  // Node size based on task count
  const getNodeSize = (node: any) => {
    return Math.max(8, Math.min(20, 8 + (node.tasks * 0.5)));
  };

  // Link color based on type
  const getLinkColor = (link: NetworkLink) => {
    switch (link.type) {
      case 'match':
        return '#0066FF'; // Blue for matches
      case 'collaboration':
        return '#8B5CF6'; // Purple for collaborations
      case 'referral':
        return '#F59E0B'; // Yellow for referrals
      default:
        return '#0066FF';
    }
  };

  // Custom node canvas painting with glow effect for active nodes
  const paintNode = (node: any, ctx: CanvasRenderingContext2D) => {
    const size = getNodeSize(node);
    const color = getNodeColor(node);
    
    // Add glow effect for online nodes
    if (node.status === 'online' || node.status === 'busy') {
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 15;
      ctx.globalAlpha = 0.8;
      
      // Pulse effect for very active nodes (with animation)
      if (node.tasks > 10) {
        const pulseMultiplier = 1 + 0.3 * Math.sin(Date.now() * 0.005 + node.id.length);
        ctx.shadowBlur = 20 * pulseMultiplier;
      }
    }
    
    // Draw main node circle
    ctx.beginPath();
    ctx.arc(node.x || 0, node.y || 0, size, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    
    // Add border for selected/hovered nodes
    if (selectedNode?.id === node.id || hoveredNode?.id === node.id) {
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    
    // Draw rating indicator (small circle in corner)
    if (node.rating > 4.0) {
      ctx.beginPath();
      ctx.arc((node.x || 0) + size * 0.6, (node.y || 0) - size * 0.6, 3, 0, 2 * Math.PI);
      ctx.fillStyle = '#FFD700'; // Gold for high rating
      ctx.fill();
    }
    
    ctx.restore();
  };

  // Custom link canvas painting
  const paintLink = (link: any, ctx: CanvasRenderingContext2D) => {
    const color = getLinkColor(link);
    const width = Math.max(1, link.strength * 3);
    
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.globalAlpha = 0.6;
    
    // Add subtle glow for active connections
    if (link.strength > 0.7) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 5;
    }
    
    ctx.beginPath();
    ctx.moveTo(link.source.x, link.source.y);
    ctx.lineTo(link.target.x, link.target.y);
    ctx.stroke();
    ctx.restore();
  };

  // Handle node hover
  const handleNodeHover = (node: any) => {
    setHoveredNode(node as NetworkNode | null);
  };

  // Handle node click
  const handleNodeClick = (node: any) => {
    const networkNode = node as NetworkNode;
    setSelectedNode(networkNode === selectedNode ? null : networkNode);
  };

  if (loading) {
    return (
      <div 
        className="flex items-center justify-center bg-[#0A0A0B] rounded-xl border border-white/10"
        style={{ width, height }}
      >
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-2 border-[#0066FF] border-t-transparent rounded-full mx-auto mb-4"></div>
          <div className="text-white/60">Loading network graph...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Network Graph Canvas */}
      <div 
        className="bg-[#0A0A0B] rounded-xl border border-white/10 overflow-hidden"
        style={{ width, height }}
      >
        <ForceGraph2D
          ref={graphRef}
          graphData={networkData}
          width={width}
          height={height}
          backgroundColor="#0A0A0B"
          nodeCanvasObject={paintNode}
          linkCanvasObject={paintLink}
          nodeLabel=""
          linkLabel=""
          onNodeHover={handleNodeHover}
          onNodeClick={handleNodeClick}
          linkDirectionalParticles={1}
          linkDirectionalParticleSpeed={0.003}
          linkDirectionalParticleWidth={2}
          cooldownTicks={100}
          nodePointerAreaPaint={(node, color, ctx) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            const size = getNodeSize(node);
            ctx.arc(node.x || 0, node.y || 0, size + 2, 0, 2 * Math.PI);
            ctx.fill();
          }}
        />
      </div>

      {/* Node Info Tooltip */}
      {hoveredNode && (
        <div className="absolute top-4 left-4 bg-black/90 backdrop-blur-sm rounded-lg p-4 border border-white/20 min-w-64 z-10">
          <div className="flex items-center gap-3 mb-3">
            <div 
              className="w-4 h-4 rounded-full"
              style={{ backgroundColor: getNodeColor(hoveredNode) }}
            ></div>
            <h3 className="font-semibold text-white">{hoveredNode.name}</h3>
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${
              hoveredNode.status === 'online' ? 'bg-green-500/20 text-green-400' :
              hoveredNode.status === 'busy' ? 'bg-orange-500/20 text-orange-400' :
              'bg-gray-500/20 text-gray-400'
            }`}>
              {hoveredNode.status}
            </span>
          </div>
          
          <div className="space-y-2 text-sm text-white/80">
            <div className="flex justify-between">
              <span>Active Tasks:</span>
              <span className="font-medium text-[#0066FF]">{hoveredNode.tasks}</span>
            </div>
            <div className="flex justify-between">
              <span>Rating:</span>
              <span className="font-medium text-yellow-400">⭐ {hoveredNode.rating}</span>
            </div>
            
            {hoveredNode.capabilities.length > 0 && (
              <div>
                <div className="text-white/60 mb-1">Capabilities:</div>
                <div className="flex flex-wrap gap-1">
                  {hoveredNode.capabilities.slice(0, 3).map(cap => (
                    <span key={cap} className="text-xs bg-[#0066FF]/20 text-[#0066FF] px-1.5 py-0.5 rounded">
                      {cap}
                    </span>
                  ))}
                  {hoveredNode.capabilities.length > 3 && (
                    <span className="text-xs text-white/40">+{hoveredNode.capabilities.length - 3} more</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 right-4 bg-black/90 backdrop-blur-sm rounded-lg p-3 border border-white/20 text-sm">
        <div className="font-semibold text-white mb-2">Legend</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-[#22C55E] rounded-full"></div>
            <span className="text-white/80">Online Agent</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-[#F97316] rounded-full"></div>
            <span className="text-white/80">Busy Agent</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-[#6B7280] rounded-full"></div>
            <span className="text-white/80">Offline Agent</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-0.5 bg-[#0066FF]"></div>
            <span className="text-white/80">Match Connection</span>
          </div>
        </div>
      </div>

      {/* Network Stats Overlay */}
      <div className="absolute top-4 right-4 bg-black/90 backdrop-blur-sm rounded-lg p-3 border border-white/20 text-sm">
        <div className="font-semibold text-white mb-2">Network Stats</div>
        <div className="space-y-1">
          <div className="flex justify-between gap-4">
            <span className="text-white/80">Total Agents:</span>
            <span className="font-medium">{networkData.nodes.length}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-white/80">Connections:</span>
            <span className="font-medium">{networkData.links.length}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-white/80">Active Matches:</span>
            <span className="font-medium text-green-400">
              {networkData.links.filter(l => l.type === 'match').length}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}