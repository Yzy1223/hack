export interface AgentCandidate {
  model: string;
  evidence: string[];
  specifications: {
    id: string;
    page: number;
    dimensions: string;
    holes: number | null;
    warning: string;
    coefficient: number | null;
  }[];
}
export interface AgentResult {
  observation: string;
  candidates: AgentCandidate[];
}
