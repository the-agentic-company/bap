export type AuditIntegrationRecommendation = {
  id: string;
  name: string;
  url: string;
  icon?: string;
  reason: string;
  importanceScore: number;
  toolType: string;
  toolUse: string;
  whyLikely: string;
  commonTools: Array<{
    name: string;
    url: string;
  }>;
  customTools?: string[];
  connected: boolean;
  selected: boolean;
};
