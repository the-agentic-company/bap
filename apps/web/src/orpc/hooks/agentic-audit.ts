import { useMutation } from "@tanstack/react-query";
import { client } from "../client";

export function useStartAgenticAudit() {
  return useMutation({
    mutationFn: (input: { email: string; linkedinUrl: string }) => client.agenticAudit.start(input),
  });
}

export function useScrapeAuditCompanyWebsite() {
  return useMutation({
    mutationFn: (input: { email: string }) => client.agenticAudit.scrapeCompanyWebsite(input),
  });
}

export function useScrapeAuditLinkedIn() {
  return useMutation({
    mutationFn: (input: { linkedinUrl: string }) => client.agenticAudit.scrapeLinkedIn(input),
  });
}

export function useRecommendAgenticAudit() {
  return useMutation({
    mutationFn: (input: {
      email: string;
      linkedinUrl: string;
      companyUrl: string;
      linkedin: Awaited<ReturnType<typeof client.agenticAudit.scrapeLinkedIn>>["linkedin"];
      website: Awaited<ReturnType<typeof client.agenticAudit.scrapeCompanyWebsite>>["website"];
      integrationRecommendations?: Awaited<
        ReturnType<typeof client.agenticAudit.toolSurvey>
      >["integrationRecommendations"];
      toolSurveyError?: string | null;
    }) => client.agenticAudit.recommend(input),
  });
}

export function useRecommendAgenticAuditToolSurvey() {
  return useMutation({
    mutationFn: (input: {
      email: string;
      linkedinUrl: string;
      companyUrl: string;
      linkedin: Awaited<ReturnType<typeof client.agenticAudit.scrapeLinkedIn>>["linkedin"];
      website: Awaited<ReturnType<typeof client.agenticAudit.scrapeCompanyWebsite>>["website"];
    }) => client.agenticAudit.toolSurvey(input),
  });
}
