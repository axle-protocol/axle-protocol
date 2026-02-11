import { NextRequest, NextResponse } from 'next/server';
import { fetchAgentsAndTasks, type AgentData } from '@/lib/solana-utils';

export interface NetworkNode {
  id: string;
  name: string;
  status: 'online' | 'busy' | 'offline';
  tasks: number;
  capabilities: string[];
  rating: number;
  isReal?: boolean; // Flag to identify real vs mock agents
}

export interface NetworkLink {
  source: string;
  target: string;
  type: 'match' | 'collaboration' | 'referral';
  strength: number;
}

export interface NetworkData {
  nodes: NetworkNode[];
  links: NetworkLink[];
}

// Mock agent names inspired by molten.gg style
const mockAgentNames = [
  'CryptoNinja', 'DefiWizard', 'BlockchainBeast', 'SolanaShark', 'TokenTitan',
  'NftMaster', 'DappBuilder', 'SmartContract', 'YieldFarmer', 'LiquidityKing',
  'GasOptimizer', 'ConsensusKeeper', 'ValidatorPro', 'NodeRunner', 'ChainAnalyst',
  'MetaTrader', 'DexHunter', 'ProtocolGuru', 'BridgeBuilder', 'OraculeMage',
  'StakingLord', 'FlashLoanExpert', 'MevBot', 'ArbitrageAce', 'GovernanceVoter',
  'AuditMaster', 'SecurityPro', 'CodeReviewer', 'DataWrangler', 'AITrainer'
];

const mockCapabilities = [
  'text-generation', 'image-analysis', 'data-scraping', 'code-review', 'translation',
  'smart-contracts', 'defi', 'nfts', 'trading', 'analysis',
  'development', 'security', 'frontend', 'backend', 'blockchain',
  'solana', 'ethereum', 'web3', 'react', 'rust'
];

// Convert real agent to network node
function realAgentToNode(agent: AgentData): NetworkNode {
  // Determine status based on activity
  let status: 'online' | 'busy' | 'offline' = 'offline';
  const hoursSinceRegistered = (Date.now() - agent.registeredAt.getTime()) / (1000 * 60 * 60);
  
  if (agent.isActive) {
    // Active agents are online or busy based on task count
    status = agent.tasksCompleted > 5 ? 'busy' : 'online';
  } else if (hoursSinceRegistered < 24) {
    // Recently registered but not active
    status = 'offline';
  }

  // Calculate rating from reputation (0-1000 -> 3.0-5.0)
  const rating = Math.round((3.0 + (agent.reputation / 1000) * 2.0) * 10) / 10;

  return {
    id: `real-${agent.pda.slice(0, 8)}`,
    name: agent.nodeId,
    status,
    tasks: agent.tasksCompleted,
    capabilities: agent.capabilities.slice(0, 5),
    rating: Math.min(5.0, Math.max(3.0, rating)),
    isReal: true
  };
}

// Generate mock agents to fill the network
function generateMockNodes(count: number, existingIds: Set<string>): NetworkNode[] {
  const nodes: NetworkNode[] = [];
  let nameIndex = 0;

  for (let i = 0; i < count && nameIndex < mockAgentNames.length; i++) {
    const id = `mock-agent-${i + 1}`;
    if (existingIds.has(id)) continue;

    // Weighted status distribution
    const rand = Math.random();
    let status: 'online' | 'busy' | 'offline';
    if (rand < 0.35) status = 'online';
    else if (rand < 0.65) status = 'busy';
    else status = 'offline';

    // Task count based on status
    const baseTasks = status === 'online' ? 15 : status === 'busy' ? 25 : 2;
    const taskVariation = Math.floor(Math.random() * 20);

    // Random capabilities (2-5)
    const shuffledCaps = [...mockCapabilities].sort(() => 0.5 - Math.random());
    const capCount = Math.floor(Math.random() * 4) + 2;

    nodes.push({
      id,
      name: mockAgentNames[nameIndex],
      status,
      tasks: Math.max(0, baseTasks + taskVariation),
      capabilities: shuffledCaps.slice(0, capCount),
      rating: Math.round((3.0 + Math.random() * 2.0) * 10) / 10,
      isReal: false
    });

    nameIndex++;
  }

  return nodes;
}

// Generate network links between nodes
function generateLinks(nodes: NetworkNode[]): NetworkLink[] {
  const links: NetworkLink[] = [];
  const usedConnections = new Set<string>();
  
  // Create links between real agents and mock agents (representing marketplace activity)
  const realNodes = nodes.filter(n => n.isReal);
  const mockNodes = nodes.filter(n => !n.isReal);

  // Real-to-mock connections (show marketplace reach)
  for (const realNode of realNodes) {
    // Each real agent connects to 2-5 mock agents
    const connectionCount = Math.floor(Math.random() * 4) + 2;
    const shuffledMocks = [...mockNodes].sort(() => 0.5 - Math.random());
    
    for (let i = 0; i < Math.min(connectionCount, shuffledMocks.length); i++) {
      const target = shuffledMocks[i];
      const connectionId = [realNode.id, target.id].sort().join('-');
      
      if (!usedConnections.has(connectionId)) {
        usedConnections.add(connectionId);
        
        // Match type based on capability overlap
        const hasOverlap = realNode.capabilities.some(c => 
          target.capabilities.includes(c)
        );
        
        links.push({
          source: realNode.id,
          target: target.id,
          type: hasOverlap ? 'match' : 'collaboration',
          strength: Math.random() * 0.6 + 0.4 // 0.4-1.0
        });
      }
    }
  }

  // Mock-to-mock connections (background network activity)
  const mockLinkCount = Math.floor(mockNodes.length * 1.2);
  
  for (let i = 0; i < mockLinkCount; i++) {
    const source = mockNodes[Math.floor(Math.random() * mockNodes.length)];
    const target = mockNodes[Math.floor(Math.random() * mockNodes.length)];
    
    if (source.id === target.id) continue;
    
    const connectionId = [source.id, target.id].sort().join('-');
    if (usedConnections.has(connectionId)) continue;
    
    usedConnections.add(connectionId);
    
    // Determine link type
    const rand = Math.random();
    let type: NetworkLink['type'];
    if (rand < 0.5) type = 'match';
    else if (rand < 0.8) type = 'collaboration';
    else type = 'referral';

    // Strength based on status activity
    const sourceActivity = source.status === 'offline' ? 0.3 : 1.0;
    const targetActivity = target.status === 'offline' ? 0.3 : 1.0;
    const strength = Math.random() * sourceActivity * targetActivity;

    links.push({
      source: source.id,
      target: target.id,
      type,
      strength: Math.round(strength * 100) / 100
    });
  }

  return links;
}

// Cache
let cachedData: NetworkData | null = null;
let lastGenerated = 0;
const CACHE_DURATION = 30000; // 30 seconds

async function generateNetworkData(): Promise<NetworkData> {
  // Fetch real agents from Solana
  let realAgents: AgentData[] = [];
  try {
    const { agents } = await fetchAgentsAndTasks();
    realAgents = agents;
  } catch (error) {
    console.error('Failed to fetch real agents:', error);
  }

  const nodes: NetworkNode[] = [];
  const existingIds = new Set<string>();

  // Add real agents as nodes (prioritized, displayed prominently)
  for (const agent of realAgents) {
    const node = realAgentToNode(agent);
    nodes.push(node);
    existingIds.add(node.id);
  }

  // Calculate mock count to reach target network size
  const targetNodeCount = 30; // Good balance for visualization
  const mockCount = Math.max(0, targetNodeCount - nodes.length);
  
  // Add mock agents
  const mockNodes = generateMockNodes(mockCount, existingIds);
  nodes.push(...mockNodes);

  // Generate links
  const links = generateLinks(nodes);

  return { nodes, links };
}

export async function GET(request: NextRequest) {
  try {
    const now = Date.now();
    
    // Regenerate data if cache is expired
    if (!cachedData || (now - lastGenerated) > CACHE_DURATION) {
      cachedData = await generateNetworkData();
      lastGenerated = now;
    }

    // Count real vs mock for stats
    const realCount = cachedData.nodes.filter(n => n.isReal).length;
    const mockCount = cachedData.nodes.filter(n => !n.isReal).length;

    return NextResponse.json({
      success: true,
      data: cachedData,
      meta: {
        realAgents: realCount,
        simulatedAgents: mockCount,
        totalNodes: cachedData.nodes.length,
        totalLinks: cachedData.links.length
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Network API error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch network data',
        data: { nodes: [], links: [] }
      },
      { status: 500 }
    );
  }
}

// POST endpoint for cache invalidation
export async function POST(request: NextRequest) {
  try {
    cachedData = null;
    return NextResponse.json({
      success: true,
      message: 'Network data cache invalidated'
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to invalidate cache' },
      { status: 500 }
    );
  }
}
