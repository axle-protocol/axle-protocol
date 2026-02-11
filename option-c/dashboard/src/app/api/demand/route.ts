import { NextResponse } from 'next/server';
import { fetchAgentsAndTasks, type AgentData, type TaskData } from '@/lib/solana-utils';

// Types
type TrendType = 'up' | 'down' | 'stable';

interface SkillAnalysis {
  skill: string;
  demandCount: number;
  supplyCount: number;
  ratio: number;
  averageRate: number;
  trend: TrendType;
  isRealSkill: boolean;
}

interface AgentDemand {
  agentId: string;
  agentName: string;
  preferredTaskTypes: string[];
  skills: string[];
  hourlyRate: number;
  availability: number;
  lastActive: string;
  isReal: boolean;
}

interface TaskDemand {
  taskType: string;
  requiredSkills: string[];
  averagePay: number;
  urgency: 'low' | 'medium' | 'high';
  demand: number;
  realTasks: number;
}

// Mock skills to supplement real data
const mockSkills = [
  'JavaScript', 'Python', 'React', 'Node.js', 'TypeScript',
  'Rust', 'Web3', 'Smart Contracts', 'API Development',
  'Data Analysis', 'Machine Learning', 'UI/UX', 'Testing', 'DevOps'
];

const mockTaskTypes = [
  'Code Review', 'Frontend Development', 'Backend Development',
  'Smart Contract Audit', 'Data Processing', 'UI Design',
  'Testing & QA', 'Documentation', 'Bug Fixing', 'Optimization'
];

// Generate mock agent data to supplement real agents
function generateMockAgents(count: number, realCapabilities: Set<string>): AgentDemand[] {
  const agents: AgentDemand[] = [];
  const allSkills = [...mockSkills, ...Array.from(realCapabilities)];

  for (let i = 0; i < count; i++) {
    const shuffledSkills = [...allSkills].sort(() => 0.5 - Math.random());
    const shuffledTasks = [...mockTaskTypes].sort(() => 0.5 - Math.random());

    agents.push({
      agentId: `mock-agent-${i + 1}`,
      agentName: `SimAgent ${i + 1}`,
      preferredTaskTypes: shuffledTasks.slice(0, Math.floor(Math.random() * 4) + 2),
      skills: shuffledSkills.slice(0, Math.floor(Math.random() * 6) + 3),
      hourlyRate: Math.floor(Math.random() * 100) + 20,
      availability: Math.floor(Math.random() * 100),
      lastActive: `${Math.floor(Math.random() * 24)}h ago`,
      isReal: false
    });
  }

  return agents;
}

// Convert real agent to demand format
function realAgentToDemand(agent: AgentData): AgentDemand {
  const hoursSinceRegistered = (Date.now() - agent.registeredAt.getTime()) / (1000 * 60 * 60);

  return {
    agentId: agent.pda,
    agentName: agent.nodeId,
    preferredTaskTypes: agent.capabilities.map(cap => {
      // Map capabilities to task types
      if (cap.includes('code') || cap.includes('review')) return 'Code Review';
      if (cap.includes('text') || cap.includes('generation')) return 'Documentation';
      if (cap.includes('image') || cap.includes('analysis')) return 'Data Processing';
      if (cap.includes('scrap')) return 'Data Processing';
      if (cap.includes('translation')) return 'Translation';
      return 'General Task';
    }),
    skills: agent.capabilities,
    hourlyRate: agent.feePerTask / 1000000, // Convert lamports to rough hourly
    availability: agent.isActive ? Math.floor(Math.random() * 40) + 60 : Math.floor(Math.random() * 30),
    lastActive: hoursSinceRegistered < 1 ? 'Just now' :
                hoursSinceRegistered < 24 ? `${Math.floor(hoursSinceRegistered)}h ago` :
                `${Math.floor(hoursSinceRegistered / 24)}d ago`,
    isReal: true
  };
}

// Generate task demand data based on real tasks
function generateTaskDemands(realTasks: TaskData[], realCapabilities: Set<string>): TaskDemand[] {
  const taskDemands: TaskDemand[] = [];
  const allSkills = [...mockSkills, ...Array.from(realCapabilities)];

  // Group real tasks by capability
  const capabilityCounts: Record<string, { count: number; totalReward: number }> = {};
  for (const task of realTasks) {
    const cap = task.requiredCapability;
    if (!capabilityCounts[cap]) {
      capabilityCounts[cap] = { count: 0, totalReward: 0 };
    }
    capabilityCounts[cap].count++;
    capabilityCounts[cap].totalReward += task.reward;
  }

  // Create demands for each task type
  for (const taskType of mockTaskTypes) {
    const shuffledSkills = [...allSkills].sort(() => 0.5 - Math.random());
    const baseDemand = Math.floor(Math.random() * 30) + 5;

    // Find matching real tasks
    let realTaskCount = 0;
    let avgRealPay = 0;
    const capEntries = Object.entries(capabilityCounts);
    for (const [cap, data] of capEntries) {
      if (taskType.toLowerCase().includes(cap.toLowerCase()) ||
          cap.toLowerCase().includes(taskType.toLowerCase().split(' ')[0])) {
        realTaskCount += data.count;
        avgRealPay = data.totalReward / data.count;
      }
    }

    taskDemands.push({
      taskType,
      requiredSkills: shuffledSkills.slice(0, Math.floor(Math.random() * 3) + 2),
      averagePay: avgRealPay > 0 ? avgRealPay * 1e9 : Math.floor(Math.random() * 5000) + 500,
      urgency: (['low', 'medium', 'high'] as const)[Math.floor(Math.random() * 3)],
      demand: baseDemand + realTaskCount * 3,
      realTasks: realTaskCount
    });
  }

  return taskDemands.sort((a, b) => b.demand - a.demand);
}

// Analyze skills based on real + mock data
function analyzeSkills(agents: AgentDemand[], taskDemands: TaskDemand[]): SkillAnalysis[] {
  const skillMap = new Map<string, { demand: number; supply: number; isReal: boolean }>();

  // Count skill supply from agents
  for (const agent of agents) {
    for (const skill of agent.skills) {
      const existing = skillMap.get(skill) || { demand: 0, supply: 0, isReal: agent.isReal };
      existing.supply++;
      if (agent.isReal) existing.isReal = true;
      skillMap.set(skill, existing);
    }
  }

  // Count skill demand from tasks
  for (const task of taskDemands) {
    for (const skill of task.requiredSkills) {
      const existing = skillMap.get(skill) || { demand: 0, supply: 0, isReal: false };
      existing.demand += task.demand;
      skillMap.set(skill, existing);
    }
  }

  // Convert to array and analyze
  const analysis: SkillAnalysis[] = [];
  const entries = Array.from(skillMap.entries());
  for (const [skill, data] of entries) {
    const ratio = data.supply > 0 ? data.demand / data.supply : data.demand;

    let trend: TrendType = 'stable';
    if (ratio > 2.5) trend = 'up';
    else if (ratio < 0.8) trend = 'down';

    analysis.push({
      skill,
      demandCount: data.demand,
      supplyCount: data.supply,
      ratio: Math.round(ratio * 100) / 100,
      averageRate: Math.floor(Math.random() * 80) + 30,
      trend,
      isRealSkill: data.isReal
    });
  }

  return analysis.sort((a, b) => b.demandCount - a.demandCount);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');

    // Fetch real data from Solana
    let realAgents: AgentData[] = [];
    let realTasks: TaskData[] = [];
    try {
      const data = await fetchAgentsAndTasks();
      realAgents = data.agents;
      realTasks = data.tasks;
    } catch (error) {
      console.error('Failed to fetch real data:', error);
    }

    // Extract real capabilities
    const realCapabilities = new Set<string>();
    for (const agent of realAgents) {
      for (const cap of agent.capabilities) {
        realCapabilities.add(cap);
      }
    }
    for (const task of realTasks) {
      realCapabilities.add(task.requiredCapability);
    }

    // Convert real agents to demand format
    const realAgentDemands = realAgents.map(realAgentToDemand);

    // Generate mock agents to supplement
    const mockAgentCount = Math.max(0, 25 - realAgents.length);
    const mockAgents = generateMockAgents(mockAgentCount, realCapabilities);

    // Combine all agents
    const allAgents = [...realAgentDemands, ...mockAgents];

    // Generate task demands
    const taskDemands = generateTaskDemands(realTasks, realCapabilities);

    // Analyze skills
    const skillAnalysis = analyzeSkills(allAgents, taskDemands);

    // Return specific analysis based on query parameter
    switch (type) {
      case 'skills':
        return NextResponse.json({
          success: true,
          data: skillAnalysis,
          meta: {
            realSkillCount: skillAnalysis.filter(s => s.isRealSkill).length,
            totalSkills: skillAnalysis.length
          }
        });

      case 'tasks':
        return NextResponse.json({
          success: true,
          data: taskDemands,
          meta: {
            realTaskTypes: taskDemands.filter(t => t.realTasks > 0).length,
            totalTaskTypes: taskDemands.length
          }
        });

      case 'agents':
        return NextResponse.json({
          success: true,
          data: allAgents,
          meta: {
            realAgents: realAgentDemands.length,
            simulatedAgents: mockAgents.length
          }
        });

      default: {
        // Return comprehensive analysis
        const agentPreferences: Record<string, number> = {};
        allAgents.forEach(agent => {
          agent.preferredTaskTypes.forEach(taskType => {
            agentPreferences[taskType] = (agentPreferences[taskType] || 0) + 1;
          });
        });

        const skillSupply: Record<string, number> = {};
        allAgents.forEach(agent => {
          agent.skills.forEach(skill => {
            skillSupply[skill] = (skillSupply[skill] || 0) + 1;
          });
        });

        // Calculate real vs mock ratio
        const realRatio = realAgents.length / Math.max(1, allAgents.length);

        return NextResponse.json({
          success: true,
          data: {
            summary: {
              totalAgents: allAgents.length,
              realAgents: realAgents.length,
              totalOpenTasks: taskDemands.reduce((sum, task) => sum + task.demand, 0),
              realTasks: realTasks.length,
              topSkills: skillAnalysis.slice(0, 5),
              avgSupplyDemandRatio: skillAnalysis.reduce((sum, skill) => sum + skill.ratio, 0) / Math.max(1, skillAnalysis.length),
              highDemandTasks: taskDemands.filter(task => task.demand > 20).length,
              networkActivity: realRatio > 0.1 ? 'high' : realRatio > 0 ? 'moderate' : 'simulated'
            },
            skillAnalysis,
            taskDemands,
            agentPreferences,
            skillSupply
          },
          meta: {
            realAgents: realAgents.length,
            realTasks: realTasks.length,
            realCapabilities: Array.from(realCapabilities)
          }
        });
      }
    }
  } catch (error) {
    console.error('Error fetching demand analysis:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch demand analysis'
    }, { status: 500 });
  }
}
