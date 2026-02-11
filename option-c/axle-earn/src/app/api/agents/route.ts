import { NextResponse } from 'next/server';

// Agent data structure
interface Agent {
  id: string;
  name: string;
  address: string;
  capabilities: string[];
  status: 'online' | 'offline' | 'busy';
  registeredAt: string;
  tasksCompleted: number;
  rating: number;
  lastActive: string;
  avatar?: string;
}

// Mock data for now - will connect to on-chain data later
const mockAgents: Agent[] = [
  {
    id: 'agent-001',
    name: 'CodeReviewer Pro',
    address: '7xKX...8hJm',
    capabilities: ['code-review', 'security-audit', 'documentation'],
    status: 'online',
    registeredAt: '2026-02-08T10:30:00Z',
    tasksCompleted: 47,
    rating: 4.8,
    lastActive: '2m ago',
  },
  {
    id: 'agent-002',
    name: 'DataAnalyzer',
    address: '3pQr...9kLn',
    capabilities: ['data-analysis', 'visualization', 'reporting'],
    status: 'busy',
    registeredAt: '2026-02-07T14:20:00Z',
    tasksCompleted: 23,
    rating: 4.5,
    lastActive: '5m ago',
  },
  {
    id: 'agent-003',
    name: 'ContentWriter AI',
    address: '9mNb...2xPo',
    capabilities: ['content-writing', 'translation', 'seo'],
    status: 'online',
    registeredAt: '2026-02-09T08:15:00Z',
    tasksCompleted: 89,
    rating: 4.9,
    lastActive: '1m ago',
  },
  {
    id: 'agent-004',
    name: 'SmartContract Auditor',
    address: '5vWx...7yZa',
    capabilities: ['smart-contract-audit', 'solana', 'rust'],
    status: 'offline',
    registeredAt: '2026-02-06T22:45:00Z',
    tasksCompleted: 12,
    rating: 4.7,
    lastActive: '2h ago',
  },
  {
    id: 'agent-005',
    name: 'UI/UX Designer Bot',
    address: '2cDe...4fGh',
    capabilities: ['ui-design', 'figma', 'prototyping'],
    status: 'online',
    registeredAt: '2026-02-10T06:00:00Z',
    tasksCompleted: 5,
    rating: 4.3,
    lastActive: '8m ago',
  },
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const capability = searchParams.get('capability');
  
  let filteredAgents = [...mockAgents];
  
  // Filter by status
  if (status && status !== 'all') {
    filteredAgents = filteredAgents.filter(a => a.status === status);
  }
  
  // Filter by capability
  if (capability) {
    filteredAgents = filteredAgents.filter(a => 
      a.capabilities.some(c => c.toLowerCase().includes(capability.toLowerCase()))
    );
  }
  
  // Calculate stats
  const stats = {
    total: mockAgents.length,
    online: mockAgents.filter(a => a.status === 'online').length,
    busy: mockAgents.filter(a => a.status === 'busy').length,
    offline: mockAgents.filter(a => a.status === 'offline').length,
    totalTasksCompleted: mockAgents.reduce((sum, a) => sum + a.tasksCompleted, 0),
    avgRating: (mockAgents.reduce((sum, a) => sum + a.rating, 0) / mockAgents.length).toFixed(1),
  };
  
  // Get all unique capabilities
  const allCapabilities = [...new Set(mockAgents.flatMap(a => a.capabilities))].sort();
  
  return NextResponse.json({
    agents: filteredAgents,
    stats,
    capabilities: allCapabilities,
  });
}
