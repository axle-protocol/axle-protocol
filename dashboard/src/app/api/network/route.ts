import { NextRequest, NextResponse } from 'next/server';

export interface NetworkNode {
  id: string;
  name: string;
  status: 'online' | 'busy' | 'offline';
  tasks: number;
  capabilities: string[];
  rating: number;
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
const agentNames = [
  'CryptoNinja', 'DefiWizard', 'BlockchainBeast', 'SolanaShark', 'TokenTitan',
  'NftMaster', 'DappBuilder', 'SmartContract', 'YieldFarmer', 'LiquidityKing',
  'GasOptimizer', 'ConsensusKeeper', 'ValidatorPro', 'NodeRunner', 'ChainAnalyst',
  'MetaTrader', 'DexHunter', 'ProtocolGuru', 'BridgeBuilder', 'OraculeMage',
  'StakingLord', 'FlashLoanExpert', 'MevBot', 'ArbitrageAce', 'GovernanceVoter'
];

const capabilities = [
  'Smart Contracts', 'DeFi', 'NFTs', 'Trading', 'Analysis',
  'Development', 'Security', 'Frontend', 'Backend', 'Blockchain',
  'Solana', 'Ethereum', 'Web3', 'React', 'Node.js',
  'Rust', 'TypeScript', 'Python', 'Go', 'Design'
];

// Generate mock network data
function generateNetworkData(): NetworkData {
  const nodeCount = 25; // Good balance for visualization
  const nodes: NetworkNode[] = [];
  const links: NetworkLink[] = [];

  // Generate nodes
  for (let i = 0; i < nodeCount; i++) {
    const statusWeights = [
      { status: 'online', weight: 0.4 },
      { status: 'busy', weight: 0.35 },
      { status: 'offline', weight: 0.25 }
    ] as const;

    const randomStatus = () => {
      const random = Math.random();
      let cumulative = 0;
      for (const { status, weight } of statusWeights) {
        cumulative += weight;
        if (random <= cumulative) return status;
      }
      return 'offline';
    };

    const status = randomStatus();
    const baseTasks = status === 'online' ? 15 : status === 'busy' ? 25 : 2;
    const taskVariation = Math.floor(Math.random() * 20);

    nodes.push({
      id: `agent-${i + 1}`,
      name: agentNames[i] || `Agent${i + 1}`,
      status,
      tasks: Math.max(0, baseTasks + taskVariation),
      capabilities: capabilities
        .sort(() => 0.5 - Math.random())
        .slice(0, Math.floor(Math.random() * 5) + 2),
      rating: Math.round((3.0 + Math.random() * 2.0) * 10) / 10 // 3.0 to 5.0
    });
  }

  // Generate links (connections between agents)
  const linkTypes: Array<{ type: NetworkLink['type'], weight: number }> = [
    { type: 'match', weight: 0.6 },
    { type: 'collaboration', weight: 0.3 },
    { type: 'referral', weight: 0.1 }
  ];

  // Create a reasonable number of connections (not too sparse, not too dense)
  const linkCount = Math.floor(nodeCount * 1.5); // ~1.5 links per node on average

  const usedConnections = new Set<string>();

  for (let i = 0; i < linkCount; i++) {
    let source: NetworkNode;
    let target: NetworkNode;
    let connectionId: string;
    
    // Try to find a unique connection
    let attempts = 0;
    do {
      source = nodes[Math.floor(Math.random() * nodes.length)];
      target = nodes[Math.floor(Math.random() * nodes.length)];
      connectionId = [source.id, target.id].sort().join('-');
      attempts++;
    } while ((source.id === target.id || usedConnections.has(connectionId)) && attempts < 50);

    if (source.id !== target.id && !usedConnections.has(connectionId)) {
      usedConnections.add(connectionId);

      // Higher chance of connections between online/busy agents
      const sourceActivity = source.status === 'offline' ? 0.3 : 1.0;
      const targetActivity = target.status === 'offline' ? 0.3 : 1.0;
      const strength = Math.random() * sourceActivity * targetActivity;

      // Choose link type based on weights
      const random = Math.random();
      let cumulative = 0;
      let selectedType: NetworkLink['type'] = 'match';
      
      for (const { type, weight } of linkTypes) {
        cumulative += weight;
        if (random <= cumulative) {
          selectedType = type;
          break;
        }
      }

      links.push({
        source: source.id,
        target: target.id,
        type: selectedType,
        strength: Math.round(strength * 100) / 100
      });
    }
  }

  return { nodes, links };
}

// Cache the data for a short time to avoid regenerating on every request
let cachedData: NetworkData | null = null;
let lastGenerated = 0;
const CACHE_DURATION = 30000; // 30 seconds

export async function GET(request: NextRequest) {
  try {
    const now = Date.now();
    
    // Regenerate data if cache is expired
    if (!cachedData || (now - lastGenerated) > CACHE_DURATION) {
      cachedData = generateNetworkData();
      lastGenerated = now;
    }

    return NextResponse.json({
      success: true,
      data: cachedData,
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

// Optional: Add POST endpoint for real-time updates
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // In a real implementation, this would update the actual network state
    // For now, we'll just invalidate the cache
    cachedData = null;
    
    return NextResponse.json({
      success: true,
      message: 'Network data updated'
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to update network data' },
      { status: 500 }
    );
  }
}